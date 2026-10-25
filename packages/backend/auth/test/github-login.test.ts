import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as AuthGroup from "@stash/contracts-api/auth";
import * as Security from "@stash/contracts-api/security";
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
import * as AuthHandlers from "../src/github-oauth/auth-handlers.ts";
import * as GithubClient from "../src/github-oauth/github-client.ts";
import * as OAuthState from "../src/github-oauth/oauth-state.ts";
import * as SessionToken from "../src/sessions/session-token.ts";
import * as SessionVerifierLive from "../src/sessions/session-verifier-live.ts";
import * as SessionsRepo from "../src/sessions/sessions-repo.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

// The whole OAuth flow through the real `auth` handlers, `Authorization` middleware and sessions on
// an in-memory D1. GitHub is a fake `HttpClient`: no request leaves the process. All logins, codes
// and tokens are synthetic.

const allowedLogin = "example-user";
const webOrigin = "https://web.example.com";

/** Callback codes the fake GitHub accepts, and the login each one signs in as. */
const codes: Record<string, string> = {
  "code-allowed": allowedLogin,
  "code-allowed-other-case": "Example-User",
  "code-other": "someone-else",
};

/** What the fake GitHub received. */
const githubRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];

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

/** A fake github.com and api.github.com. */
const layerFakeGithub = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request, url) => {
    const body =
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
    githubRequests.push({ url: url.toString(), headers: { ...request.headers }, body });
    if (url.toString() === GithubClient.accessTokenEndpoint) {
      const login = codes[new URLSearchParams(body).get("code") ?? ""];
      return login === undefined
        ? json(request, { error: "bad_verification_code" })
        : json(request, { access_token: `synthetic-token-for-${login}`, token_type: "bearer" });
    }
    if (url.toString() === GithubClient.userEndpoint) {
      const token = request.headers["authorization"]?.replace(/^Bearer synthetic-token-for-/, "");
      return token === undefined
        ? json(request, { message: "Bad credentials" }, 401)
        : json(request, { login: token });
    }
    return json(request, { message: "Not Found" }, 404);
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
  Layer.provide(Testing.layerGithubOAuthConfig),
  Layer.provide(Layer.mergeAll(ApiTokensRepo.layer, SessionsRepo.layer)),
  Layer.provide(Testing.layerStashConfig({ allowedGithubLogin: allowedLogin, webOrigin })),
);

/** Serves requests in the test's own runtime, so `TestClock` drives session expiry. */
const withServer = <A, E, R>(test: (send: Send) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    githubRequests.length = 0;
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
    Effect.provide(Layer.mergeAll(AuthTestLayer.layerDatabase, HttpServer.layerServices)),
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

/** `name=value` and the attributes of each `Set-Cookie`, by cookie name. */
const setCookies = (response: Response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((header) => {
      const [pair = "", ...attributes] = header.split(/;\s*/);
      const [name = "", value = ""] = pair.split("=");
      return [name, { value, attributes }];
    }),
  );

const body = (response: Response) => Effect.promise(() => response.json());

/** Starts a login and returns the state from the GitHub redirect and its cookie. */
const startLogin = (send: Send) =>
  Effect.gen(function* () {
    const response = yield* send(get("/auth/github/login"));
    const location = new URL(response.headers.get("location") ?? "");
    const state = location.searchParams.get("state") ?? "";
    return { response, location, state };
  });

/** Runs the whole flow with a callback code and returns the callback's response. */
const loginWith = (send: Send, code: string) =>
  Effect.gen(function* () {
    const { state } = yield* startLogin(send);
    return yield* send(
      get(`/auth/github/callback?code=${code}&state=${state}`, {
        [OAuthState.cookieName]: state,
      }),
    );
  });

const sessionCookieOf = (response: Response) =>
  setCookies(response)[Security.sessionCookieName]?.value ?? "";

const sessionRows = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  return yield* db.all(D1Database.sql`SELECT id, github_login FROM sessions`);
});

describe("GET /auth/github/login", () => {
  it.effect("redirects to GitHub with a state that is also set as a short-lived cookie", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const { response, location, state } = yield* startLogin(send);
        expect(response.status).toBe(302);
        expect(`${location.origin}${location.pathname}`).toBe(GithubClient.authorizeEndpoint);
        expect(location.searchParams.get("client_id")).toBe("synthetic-client-id");
        expect(location.searchParams.get("redirect_uri")).toBe(`${base}/auth/github/callback`);
        expect(state.length).toBeGreaterThanOrEqual(32);

        const cookie = setCookies(response)[OAuthState.cookieName];
        expect(cookie?.value).toBe(state);
        expect(cookie?.attributes).toEqual(
          expect.arrayContaining([
            "Max-Age=600",
            "Path=/auth/github",
            "HttpOnly",
            "Secure",
            "SameSite=Lax",
          ]),
        );
        // The secret never leaves the server in the redirect.
        expect(location.toString()).not.toContain("synthetic-client-secret");
      }),
    ),
  );
});

describe("GET /auth/github/callback", () => {
  it.effect("signs in the allowlisted login: session in D1, secure cookie, redirect to web", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const response = yield* loginWith(send, "code-allowed");
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(`${webOrigin}/`);

        const cookies = setCookies(response);
        const session = cookies[Security.sessionCookieName];
        expect(session?.value.length).toBeGreaterThanOrEqual(43);
        expect(session?.attributes).toEqual(
          expect.arrayContaining([
            `Max-Age=${Duration.toSeconds(Duration.days(30))}`,
            "Path=/",
            "HttpOnly",
            "Secure",
            "SameSite=Lax",
          ]),
        );
        // The state cookie is single use.
        expect(cookies[OAuthState.cookieName]?.attributes).toContain("Max-Age=0");

        // D1 holds the hash of the token, never the token.
        const hash = yield* SessionToken.hash(Redacted.make(session?.value ?? ""));
        expect(yield* sessionRows).toEqual([{ id: hash, github_login: allowedLogin }]);

        // GitHub got the client secret in the exchange body, and a User-Agent on every call.
        expect(githubRequests.map((request) => request.url)).toEqual([
          GithubClient.accessTokenEndpoint,
          GithubClient.userEndpoint,
        ]);
        expect(new URLSearchParams(githubRequests[0]?.body).get("client_secret")).toBe(
          "synthetic-client-secret",
        );
        expect(githubRequests.every((request) => request.headers["user-agent"] === "stash")).toBe(
          true,
        );

        const me = yield* send(
          get("/auth/me", { [Security.sessionCookieName]: session?.value ?? "" }),
        );
        expect(me.status).toBe(200);
        expect(yield* body(me)).toEqual({ kind: "user" });
      }),
    ),
  );

  it.effect("matches the allowlisted login case-insensitively", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const response = yield* loginWith(send, "code-allowed-other-case");
        expect(response.status).toBe(302);
        const me = yield* send(
          get("/auth/me", { [Security.sessionCookieName]: sessionCookieOf(response) }),
        );
        expect(me.status).toBe(200);
      }),
    ),
  );

  it.effect("answers 403 to any other login and starts no session", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const response = yield* loginWith(send, "code-other");
        expect(response.status).toBe(403);
        expect(yield* body(response)).toMatchObject({ _tag: "Forbidden" });
        expect(setCookies(response)[Security.sessionCookieName]).toBeUndefined();
        expect(yield* sessionRows).toEqual([]);
      }),
    ),
  );

  it.effect("answers 400 to a bad, missing or cookieless state without calling GitHub", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const { state } = yield* startLogin(send);
        const callback = (query: string, cookies: Record<string, string>) =>
          send(get(`/auth/github/callback?${query}`, cookies));

        const wrong = yield* callback(`code=code-allowed&state=${state}x`, {
          [OAuthState.cookieName]: state,
        });
        expect(wrong.status).toBe(400);
        expect(yield* body(wrong)).toMatchObject({ _tag: "ValidationError" });

        const noCookie = yield* callback(`code=code-allowed&state=${state}`, {});
        expect(noCookie.status).toBe(400);

        const noState = yield* callback("code=code-allowed", { [OAuthState.cookieName]: state });
        expect(noState.status).toBe(400);

        expect(githubRequests).toEqual([]);
        expect(yield* sessionRows).toEqual([]);
      }),
    ),
  );

  it.effect("answers 401 when GitHub rejects the code", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const response = yield* loginWith(send, "code-unknown");
        expect(response.status).toBe(401);
        expect(yield* body(response)).toMatchObject({ _tag: "Unauthorized" });
        expect(yield* sessionRows).toEqual([]);
      }),
    ),
  );
});

describe("sessions", () => {
  it.effect("an expired session answers 401 and is deleted", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const session = sessionCookieOf(yield* loginWith(send, "code-allowed"));
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
        const session = sessionCookieOf(yield* loginWith(send, "code-allowed"));
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
        const session = sessionCookieOf(yield* loginWith(send, "code-allowed"));
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
