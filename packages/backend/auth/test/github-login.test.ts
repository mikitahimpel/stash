import { beforeEach, describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Kv from "@stash/backend-platform/kv";
import * as CreateInvite from "@stash/backend-users/create-invite";
import * as InvitesRepo from "@stash/backend-users/invites-repo";
import * as RemoveMember from "@stash/backend-users/remove-member";
import * as UsersRepo from "@stash/backend-users/users-repo";
import * as Testing from "@stash/backend-platform/testing";
import * as AuthGroup from "@stash/contracts-api/auth";
import * as Security from "@stash/contracts-api/security";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as ApiTokensRepo from "../src/api-tokens/api-tokens-repo.ts";
import * as AuthorizationLive from "../src/authorization/authorization-live.ts";
import * as AuthHandlers from "../src/device-flow/auth-handlers.ts";
import * as DeviceFlowsStore from "../src/device-flow/device-flows-store.ts";
import * as DeviceStartRateLimiter from "../src/device-flow/device-start-rate-limiter.ts";
import * as GithubClient from "../src/device-flow/github-client.ts";
import * as StartSession from "../src/sessions/start-session.ts";
import * as SessionVerifierLive from "../src/sessions/session-verifier-live.ts";
import * as SessionsRepo from "../src/sessions/sessions-repo.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

// The GitHub Device Flow login and the sessions it starts, through the real `auth` handlers and
// `Authorization` middleware on an in-memory D1 and KV. GitHub is a fake `HttpClient`: no request
// leaves the process. All logins, codes and tokens are synthetic.

const allowedLogin = "example-user";
const webOrigin = "https://web.example.com";

/** The device flow the fake GitHub starts. */
const deviceCode = {
  device_code: "synthetic-device-code",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

/** What the fake GitHub received. */
const githubRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];

/** The fake access token endpoint's answers, one per poll, in order. */
const tokenAnswers: Array<Record<string, unknown>> = [];

/** An access token the fake GitHub issues for `login`. */
const tokenFor = (login: string) => `synthetic-github-token-for-${login}`;

const authorized = (login: string) => ({ access_token: tokenFor(login), token_type: "bearer" });

const json = (request: HttpClientRequest.HttpClientRequest, body: unknown, status = 200) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

/** The numeric id the fake GitHub gives an account. A test can move a login to another id. */
const githubIds = new Map<string, number>();
const githubId = (login: string): number => {
  const known = githubIds.get(login.toLowerCase());
  if (known !== undefined) return known;
  const next = 5000 + githubIds.size;
  githubIds.set(login.toLowerCase(), next);
  return next;
};

/** A fake github.com and api.github.com. */
const layerFakeGithub = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request, url) => {
    const body =
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
    githubRequests.push({ url: url.toString(), headers: { ...request.headers }, body });
    if (url.toString() === GithubClient.deviceCodeEndpoint) return json(request, deviceCode);
    if (url.toString() === GithubClient.accessTokenEndpoint) {
      return json(request, tokenAnswers.shift() ?? { error: "authorization_pending" });
    }
    if (url.toString() === GithubClient.userEndpoint) {
      const login = request.headers["authorization"]?.replace(
        /^Bearer synthetic-github-token-for-/,
        "",
      );
      return login === undefined
        ? json(request, { message: "Bad credentials" }, 401)
        : json(request, { login, id: githubId(login) });
    }
    return json(request, { message: "Not Found" }, 404);
  }),
);

/** The KV namespace's contents, so tests can assert what was stored. */
const kvStore = new Map<string, string>();

/** KV over `kvStore`. Expiry is not emulated: the device flows store checks `expiresAt` itself. */
const layerInspectableKv = Layer.sync(Kv.Kv)(() =>
  Kv.make({
    get: async (key) => kvStore.get(key) ?? null,
    put: async (key, value) => void kvStore.set(key, value),
    delete: async (key) => void kvStore.delete(key),
  }),
);

/** Only the `auth` group, with the same group definition the `StashApi` uses. */
const AuthApi = HttpApi.make("stash").add(AuthGroup.AuthGroup);

const app = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers.layer),
  Layer.provide(AuthorizationLive.layer),
  Layer.provide(SessionVerifierLive.layer),
  Layer.provide(GithubClient.layer),
  Layer.provide(layerFakeGithub),
  Layer.provide(Testing.layerGithubConfig),
  Layer.provide(
    Layer.mergeAll(
      ApiTokensRepo.layer,
      SessionsRepo.layer,
      UsersRepo.layer,
      InvitesRepo.layer,
      DeviceFlowsStore.layer,
      DeviceStartRateLimiter.layer({ limit: 3, windowSeconds: 60 }),
    ),
  ),
  Layer.provide(layerInspectableKv),
  Layer.provide(Testing.layerStashConfig({ allowedGithubLogin: allowedLogin, webOrigin })),
);

/** Serves requests in the test's own runtime, so `TestClock` drives polling and expiry. */
const withServer = <A, E, R>(test: (send: Send) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(app);
    const send: Send = (request) =>
      handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromClientRequest(request),
        ),
        Effect.scoped,
        // As the router does when serving: errors such as a failed query decode answer by cause.
        Effect.catchCause((cause) => Effect.map(HttpServerError.causeResponse(cause), ([r]) => r)),
        Effect.map((response) => HttpServerResponse.toWeb(response)),
      );
    return yield* test(send);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        AuthTestLayer.layerDatabase,
        HttpServer.layerServices,
        // What removing a member reaches besides the database.
        Testing.layerVectors,
        Testing.layerBlobs,
        Testing.layerLinkEvents,
      ),
    ),
  );

type Send = (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Response>;

const base = "http://localhost";

const get = (path: string, cookies: Record<string, string> = {}) =>
  HttpClientRequest.get(`${base}${path}`).pipe(
    HttpClientRequest.setHeader(
      "cookie",
      Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    ),
  );

const startFlow = (ip = "192.0.2.1") =>
  HttpClientRequest.post(`${base}/auth/device/start`).pipe(
    HttpClientRequest.setHeader(AuthHandlers.clientIpHeader, ip),
  );

const pollFlow = (flowId: string, invite?: string) =>
  HttpClientRequest.post(`${base}/auth/device/poll`).pipe(
    HttpClientRequest.bodyJsonUnsafe(invite === undefined ? { flowId } : { flowId, invite }),
  );

/** `name=value` and the attributes of each `Set-Cookie`, by cookie name. */
const setCookies = (response: Response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((header) => {
      const [pair = "", ...attributes] = header.split(/;\s*/);
      const [name = "", value = ""] = pair.split("=");
      return [name, { value, attributes }];
    }),
  );

const body = (response: Response): Effect.Effect<any> => Effect.promise(() => response.json());

/** Starts a flow and returns its id. */
const started = (send: Send) =>
  Effect.gen(function* () {
    const response = yield* send(startFlow());
    expect(response.status).toBe(200);
    return (yield* body(response)).flowId as string;
  });

const tokenPolls = () => githubRequests.filter((r) => r.url === GithubClient.accessTokenEndpoint);

/** Signs in the allowlisted login directly and returns the session cookie value. */
const signIn = StartSession.startSession(Testing.owner.id, allowedLogin).pipe(
  Effect.map((session) => Redacted.value(session.token)),
  Effect.provide(SessionsRepo.layer),
);

const sessionRows = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  return yield* db.all(D1Database.sql`SELECT id, github_login, user_id FROM sessions`);
});

/** Every value in every table of the test database, as one string. */
const databaseDump = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const tables = yield* db.all(D1Database.sql`SELECT name FROM sqlite_schema WHERE type = 'table'`);
  const rows = yield* Effect.forEach(tables, (table) =>
    db.all(D1Database.statement(`SELECT * FROM "${String(table["name"])}"`)),
  );
  return JSON.stringify(rows);
});

const kvDump = () => JSON.stringify([...kvStore.entries()]);

/** The device flows still in KV. */
const storedFlows = () => [...kvStore.keys()].filter((key) => key.startsWith("device-flow:"));

beforeEach(() => {
  githubIds.clear();
  githubRequests.length = 0;
  tokenAnswers.length = 0;
  kvStore.clear();
});

describe("device flow login", () => {
  it.effect("start returns the user code and keeps the device code on the server", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const response = yield* send(startFlow());
        const started = yield* body(response);
        expect(started).toEqual({
          flowId: expect.any(String),
          userCode: "ABCD-1234",
          verificationUri: "https://github.com/login/device",
          expiresIn: 900,
          interval: 5,
        });
        expect(JSON.stringify(started)).not.toContain("synthetic-device-code");
        expect(kvStore.get(DeviceFlowsStore.key(started.flowId))).toContain(
          "synthetic-device-code",
        );

        const [request] = githubRequests;
        expect(request?.url).toBe(GithubClient.deviceCodeEndpoint);
        expect(Object.fromEntries(new URLSearchParams(request?.body))).toEqual({
          client_id: "synthetic-client-id",
          scope: "read:user",
        });
      }),
    ),
  );

  it.effect("pending, then slow_down, then complete signs in an allowlisted login", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const flowId = yield* started(send);
        tokenAnswers.push(
          { error: "authorization_pending" },
          { error: "slow_down", interval: 10 },
          // GitHub logins are case-insensitive.
          authorized("Example-User"),
        );

        // Polled before the interval: answered here, GitHub is not asked.
        expect(yield* body(yield* send(pollFlow(flowId)))).toEqual({ status: "slow_down" });
        expect(tokenPolls()).toHaveLength(0);

        yield* TestClock.adjust(Duration.seconds(5));
        expect(yield* body(yield* send(pollFlow(flowId)))).toEqual({ status: "pending" });

        yield* TestClock.adjust(Duration.seconds(5));
        expect(yield* body(yield* send(pollFlow(flowId)))).toEqual({ status: "slow_down" });

        // GitHub raised the interval to 10 seconds: 5 seconds later is still too early.
        yield* TestClock.adjust(Duration.seconds(5));
        expect(yield* body(yield* send(pollFlow(flowId)))).toEqual({ status: "slow_down" });
        expect(tokenPolls()).toHaveLength(2);

        yield* TestClock.adjust(Duration.seconds(5));
        const complete = yield* send(pollFlow(flowId));
        expect(complete.status).toBe(200);
        expect(yield* body(complete)).toEqual({ status: "complete", me: { kind: "user" } });
        expect(tokenPolls()).toHaveLength(3);
        for (const poll of tokenPolls()) {
          expect(Object.fromEntries(new URLSearchParams(poll.body))).toEqual({
            client_id: "synthetic-client-id",
            device_code: "synthetic-device-code",
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          });
        }

        const cookie = setCookies(complete)[Security.sessionCookieName];
        expect(cookie?.attributes).toEqual(
          expect.arrayContaining(["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]),
        );
        expect(cookie?.attributes).toContain(
          `Max-Age=${Duration.toSeconds(StartSession.sessionTtl)}`,
        );
        const session = cookie?.value ?? "";
        expect(
          (yield* send(get("/auth/me", { [Security.sessionCookieName]: session }))).status,
        ).toBe(200);
        expect(yield* sessionRows).toEqual([
          { id: expect.any(String), github_login: "Example-User", user_id: Testing.owner.id },
        ]);

        // The flow is gone, and the GitHub access token was never stored.
        expect(storedFlows()).toEqual([]);
        expect(kvDump()).not.toContain(tokenFor("Example-User"));
        expect(yield* databaseDump).not.toContain(tokenFor("Example-User"));
        expect(yield* databaseDump).not.toContain(session);

        // The flow cannot complete twice.
        yield* TestClock.adjust(Duration.seconds(10));
        expect((yield* send(pollFlow(flowId))).status).toBe(410);
      }),
    ),
  );

  it.effect("a login that is not allowlisted gets not_allowed and no session", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const flowId = yield* started(send);
        tokenAnswers.push(authorized("someone-else"));
        yield* TestClock.adjust(Duration.seconds(5));

        const response = yield* send(pollFlow(flowId));
        expect(response.status).toBe(403);
        expect(yield* body(response)).toEqual({
          _tag: "LoginNotAllowed",
          message: "This GitHub account has no Stash account. Ask the owner for an invite.",
        });
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(yield* sessionRows).toEqual([]);
        expect(storedFlows()).toEqual([]);
        expect(kvDump()).not.toContain(tokenFor("someone-else"));
        expect(yield* databaseDump).not.toContain(tokenFor("someone-else"));
      }),
    ),
  );

  it.effect("expired_token answers DeviceFlowExpired and forgets the flow", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const flowId = yield* started(send);
        tokenAnswers.push({ error: "expired_token" });
        yield* TestClock.adjust(Duration.seconds(5));

        const response = yield* send(pollFlow(flowId));
        expect(response.status).toBe(410);
        expect((yield* body(response))._tag).toBe("DeviceFlowExpired");
        expect(storedFlows()).toEqual([]);
      }),
    ),
  );

  it.effect("a flow past its expiry or an unknown flow answers DeviceFlowExpired", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const flowId = yield* started(send);
        yield* TestClock.adjust(Duration.seconds(900));
        const expired = yield* send(pollFlow(flowId));
        expect(expired.status).toBe(410);
        expect((yield* body(expired))._tag).toBe("DeviceFlowExpired");

        const unknown = yield* send(pollFlow("unknown-flow"));
        expect(unknown.status).toBe(410);
        expect(tokenPolls()).toHaveLength(0);
      }),
    ),
  );

  it.effect("access_denied answers DeviceFlowDenied and forgets the flow", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const flowId = yield* started(send);
        tokenAnswers.push({ error: "access_denied" });
        yield* TestClock.adjust(Duration.seconds(5));

        const response = yield* send(pollFlow(flowId));
        expect(response.status).toBe(403);
        expect((yield* body(response))._tag).toBe("DeviceFlowDenied");
        expect(yield* sessionRows).toEqual([]);
        expect(storedFlows()).toEqual([]);
      }),
    ),
  );

  it.effect("start is rate limited per client IP", () =>
    withServer((send) =>
      Effect.gen(function* () {
        for (let i = 0; i < 3; i++) expect((yield* send(startFlow())).status).toBe(200);
        const limited = yield* send(startFlow());
        expect(limited.status).toBe(429);
        expect((yield* body(limited))._tag).toBe("RateLimited");
        expect((yield* send(startFlow("192.0.2.2"))).status).toBe(200);

        yield* TestClock.adjust(Duration.seconds(60));
        expect((yield* send(startFlow())).status).toBe(200);
      }),
    ),
  );
});

describe("sessions", () => {
  it.effect("an expired session answers 401 and is deleted", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const session = yield* signIn;
        const me = () => send(get("/auth/me", { [Security.sessionCookieName]: session }));

        yield* TestClock.adjust(Duration.subtract(Duration.days(30), Duration.seconds(1)));
        expect((yield* me()).status).toBe(200);

        yield* TestClock.adjust(Duration.seconds(1));
        const expired = yield* me();
        expect(expired.status).toBe(401);
        expect(yield* body(expired)).toEqual({ _tag: "Unauthorized", message: "Session expired" });
        expect(yield* sessionRows).toEqual([]);
      }),
    ),
  );

  it.effect("rejects a session whose login is no longer allowlisted", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const session = yield* signIn;
        const db = yield* D1Database.Database;
        yield* db.run(D1Database.sql`UPDATE sessions SET github_login = ${"someone-else"}`);
        const me = yield* send(get("/auth/me", { [Security.sessionCookieName]: session }));
        expect(me.status).toBe(401);
      }),
    ),
  );

  it.effect("logout deletes the session and expires the cookie", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const session = yield* signIn;
        const cookies = { [Security.sessionCookieName]: session };

        const response = yield* send(
          HttpClientRequest.post(`${base}/auth/logout`).pipe(
            HttpClientRequest.setHeader("cookie", `${Security.sessionCookieName}=${session}`),
          ),
        );
        expect(response.status).toBe(204);
        expect(setCookies(response)[Security.sessionCookieName]?.attributes).toContain("Max-Age=0");
        expect(yield* sessionRows).toEqual([]);
        expect((yield* send(get("/auth/me", cookies))).status).toBe(401);
      }),
    ),
  );

  it.effect("/auth/me and logout require a credential", () =>
    withServer((send) =>
      Effect.gen(function* () {
        expect((yield* send(get("/auth/me"))).status).toBe(401);
        expect((yield* send(HttpClientRequest.post(`${base}/auth/logout`))).status).toBe(401);
      }),
    ),
  );
});

// Signing up (#177): a GitHub account that is not the owner gets in only with an invite, once.
describe("device flow login with an invite", () => {
  /** Runs a whole flow for `login` and answers the final poll. */
  const signInAs = (send: Send, login: string, invite?: string) =>
    Effect.gen(function* () {
      const flowId = yield* started(send);
      tokenAnswers.push(authorized(login));
      yield* TestClock.adjust(Duration.seconds(5));
      return yield* send(pollFlow(flowId, invite));
    });

  const sessionOf = (response: Response) =>
    setCookies(response)[Security.sessionCookieName]?.value ?? "";

  const users = Effect.gen(function* () {
    const db = yield* D1Database.Database;
    return yield* db.all(
      D1Database.sql`SELECT id, display_name, role, daily_ai_quota FROM users
        WHERE id NOT IN (${Testing.owner.id}, ${Testing.member.id}, ${Testing.otherMember.id})`,
    );
  });

  it.effect("a new account with an invite becomes a member with its own session", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const invite = yield* CreateInvite.createInvite;
        const response = yield* signInAs(send, "new-member", invite.token);
        expect(response.status).toBe(200);
        expect(yield* body(response)).toEqual({ status: "complete", me: { kind: "user" } });

        const [created] = yield* users;
        expect(created).toMatchObject({
          display_name: "new-member",
          role: "member",
          daily_ai_quota: 200,
        });
        const [session] = yield* sessionRows;
        expect(session).toMatchObject({ github_login: "new-member", user_id: created?.["id"] });
        expect(session?.["user_id"]).not.toBe(Testing.owner.id);
        expect(
          (yield* send(get("/auth/me", { [Security.sessionCookieName]: sessionOf(response) })))
            .status,
        ).toBe(200);

        // The invite is used up, and the token is nowhere in the database.
        const [stored] = yield* InvitesRepo.InvitesRepo.use((repo) => repo.list);
        expect(stored?.acceptedAt).not.toBeNull();
        expect(stored?.acceptedBy).toBe(created?.["id"]);
        expect(yield* databaseDump).not.toContain(invite.token);
      }),
    ),
  );

  it.effect("an invite works once: a second account gets nothing with it", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const invite = yield* CreateInvite.createInvite;
        expect((yield* signInAs(send, "first-guest", invite.token)).status).toBe(200);
        const second = yield* signInAs(send, "second-guest", invite.token);
        expect(second.status).toBe(403);
        expect((yield* body(second))._tag).toBe("LoginNotAllowed");
        expect(yield* users).toHaveLength(1);
        expect(yield* sessionRows).toHaveLength(1);
      }),
    ),
  );

  it.effect("no invite, an unknown, a revoked or an expired one signs nobody up", () =>
    withServer((send) =>
      Effect.gen(function* () {
        expect((yield* signInAs(send, "guest-a")).status).toBe(403);
        expect((yield* signInAs(send, "guest-a", "x".repeat(43))).status).toBe(403);

        const revoked = yield* CreateInvite.createInvite;
        yield* InvitesRepo.InvitesRepo.use((repo) =>
          Effect.flatMap(DateTime.now, (now) => repo.revoke(revoked.id, now)),
        );
        expect((yield* signInAs(send, "guest-a", revoked.token)).status).toBe(403);

        const expired = yield* CreateInvite.createInvite;
        yield* TestClock.adjust(Duration.days(7));
        expect((yield* signInAs(send, "guest-a", expired.token)).status).toBe(403);

        expect(yield* users).toEqual([]);
        expect(yield* sessionRows).toEqual([]);
      }),
    ),
  );

  it.effect("a member signs in again without an invite, even after renaming their login", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const invite = yield* CreateInvite.createInvite;
        yield* signInAs(send, "old-name", invite.token);
        const id = githubId("old-name");
        // The same GitHub account under a new login is the same member.
        githubIds.set("new-name", id);
        expect((yield* signInAs(send, "new-name")).status).toBe(200);
        expect(yield* users).toHaveLength(1);
        // Someone else who takes the old login is a stranger.
        githubIds.set("old-name", 99_999);
        expect((yield* signInAs(send, "old-name")).status).toBe(403);
        expect(yield* users).toHaveLength(1);
      }),
    ),
  );

  it.effect("the owner signs in as the owner and leaves an invite unused", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const invite = yield* CreateInvite.createInvite;
        expect((yield* signInAs(send, allowedLogin, invite.token)).status).toBe(200);
        expect(yield* users).toEqual([]);
        expect((yield* sessionRows)[0]).toMatchObject({ user_id: Testing.owner.id });
        const [stored] = yield* InvitesRepo.InvitesRepo.use((repo) => repo.list);
        expect(stored?.acceptedAt).toBeNull();
      }),
    ),
  );

  it.effect("a removed member is signed out and cannot sign in again", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const invite = yield* CreateInvite.createInvite;
        const joined = yield* signInAs(send, "leaving-member", invite.token);
        const session = sessionOf(joined);
        const [member] = yield* users;
        yield* RemoveMember.purgeUser(member?.["id"] as never);

        expect(
          (yield* send(get("/auth/me", { [Security.sessionCookieName]: session }))).status,
        ).toBe(401);
        expect((yield* signInAs(send, "leaving-member")).status).toBe(403);
        // The used invite does not sign them up again either.
        expect((yield* signInAs(send, "leaving-member", invite.token)).status).toBe(403);
        expect(yield* users).toEqual([]);
      }),
    ),
  );
});
