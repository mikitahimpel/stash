import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as CreateInvite from "@stash/backend-users/create-invite";
import * as InvitesRepo from "@stash/backend-users/invites-repo";
import * as UsersRepo from "@stash/backend-users/users-repo";
import * as AuthGroup from "@stash/contracts-api/auth";
import * as Security from "@stash/contracts-api/security";
import * as SignInGroup from "@stash/contracts-api/sign-in";
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
import * as ApiTokenSecret from "../src/api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../src/api-tokens/api-tokens-repo.ts";
import * as AuthorizationLive from "../src/authorization/authorization-live.ts";
import * as AuthHandlers from "../src/device-flow/auth-handlers.ts";
import * as DeviceFlowsStore from "../src/device-flow/device-flows-store.ts";
import * as DeviceStartRateLimiter from "../src/device-flow/device-start-rate-limiter.ts";
import * as GithubClient from "../src/device-flow/github-client.ts";
import * as GoogleClient from "../src/google/google-client.ts";
import * as GoogleFlowsStore from "../src/google/google-flows-store.ts";
import * as GoogleSignIn from "../src/google/google-sign-in.ts";
import * as PasskeyChallenges from "../src/passkeys/passkey-challenges.ts";
import * as PasskeysRepo from "../src/passkeys/passkeys-repo.ts";
import * as SessionVerifierLive from "../src/sessions/session-verifier-live.ts";
import * as SessionsRepo from "../src/sessions/sessions-repo.ts";
import * as ReturnPath from "../src/sign-in/return-path.ts";
import * as SignInHandlers from "../src/sign-in/sign-in-handlers.ts";
import * as SignInRateLimiter from "../src/sign-in/sign-in-rate-limiter.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";
import * as SoftAuthenticator from "./soft-authenticator.ts";

// Passkeys and Sign in with Google (#178), through the real `auth` and `signIn` handlers and the
// `Authorization` middleware, on an in-memory D1 and KV. The authenticator is a software one
// (`soft-authenticator.ts`), Google is a fake OpenID provider behind a fake `HttpClient` that
// signs its ID tokens with a key made for the test, and GitHub is faked the same way. Every
// account, address and secret is synthetic.

const webOrigin = "https://web.example.com";
const allowedLogin = "example-user";
const idp = "https://idp.example.com";

// The fake Google: the codes it issued, with the claims of each ID token.
const signingKeys = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const otherKeys = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const publicJwk = await crypto.subtle.exportKey("jwk", signingKeys.publicKey);

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

const signJwt = async (claims: Record<string, unknown>, keys = signingKeys) => {
  const head = b64(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(new Uint8Array(signature))}`;
};

interface IssuedCode {
  readonly claims: Record<string, unknown>;
  readonly keys?: CryptoKeyPair;
}
const issued = new Map<string, IssuedCode>();
const tokenRequests: Array<Record<string, string>> = [];

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

const layerFakeProviders = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request, url) => {
    const form =
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
    const href = url.toString();
    if (href === `${idp}/jwks`) return json(request, { keys: [{ ...publicJwk, kid: "test-key" }] });
    if (href === `${idp}/token`) {
      const params = Object.fromEntries(new URLSearchParams(form));
      tokenRequests.push(params);
      const code = issued.get(params["code"] ?? "");
      if (code === undefined) return json(request, { error: "invalid_grant" }, 400);
      return Effect.promise(() => signJwt(code.claims, code.keys)).pipe(
        Effect.flatMap((idToken) => json(request, { id_token: idToken, access_token: "x" })),
      );
    }
    // GitHub, for linking: one authorized device flow for the login `synthetic-gh`.
    if (href === GithubClient.deviceCodeEndpoint) {
      return json(request, {
        device_code: "synthetic-device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      });
    }
    if (href === GithubClient.accessTokenEndpoint) {
      return json(request, { access_token: "synthetic-github-token", token_type: "bearer" });
    }
    if (href === GithubClient.userEndpoint)
      return json(request, { login: "synthetic-gh", id: 7007 });
    return json(request, { message: "Not Found" }, 404);
  }),
);

const TestApi = HttpApi.make("stash").add(AuthGroup.AuthGroup).add(SignInGroup.SignInGroup);

const app = (options: { readonly google?: boolean; readonly limit?: number } = {}) =>
  HttpApiBuilder.layer(TestApi).pipe(
    Layer.provide(Layer.mergeAll(AuthHandlers.layer, SignInHandlers.layer)),
    Layer.provide(AuthorizationLive.layer),
    Layer.provide(SessionVerifierLive.layer),
    Layer.provide(Layer.mergeAll(GithubClient.layer, GoogleClient.layer)),
    Layer.provide(layerFakeProviders),
    Layer.provide(
      Layer.mergeAll(
        Testing.layerGithubConfig,
        options.google === false ? Testing.layerGoogleNotConfigured : Testing.layerGoogleConfig(),
      ),
    ),
    Layer.provide(
      Layer.mergeAll(
        ApiTokensRepo.layer,
        SessionsRepo.layer,
        UsersRepo.layer,
        InvitesRepo.layer,
        PasskeysRepo.layer,
        PasskeyChallenges.layer,
        GoogleFlowsStore.layer,
        DeviceFlowsStore.layer,
        DeviceStartRateLimiter.layer(),
        SignInRateLimiter.layer({ limit: options.limit ?? 100, windowSeconds: 60 }),
      ),
    ),
    Layer.provide(Testing.layerKv),
    Layer.provide(Testing.layerStashConfig({ allowedGithubLogin: allowedLogin, webOrigin })),
  );

type Send = (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Response>;

const withServer = <A, E, R>(
  test: (send: Send) => Effect.Effect<A, E, R>,
  options?: Parameters<typeof app>[0],
) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(app(options));
    const send: Send = (request) =>
      handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromClientRequest(request),
        ),
        Effect.scoped,
        Effect.catchCause((cause) => Effect.map(HttpServerError.causeResponse(cause), ([r]) => r)),
        Effect.map((response) => HttpServerResponse.toWeb(response)),
      );
    return yield* test(send);
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(AuthTestLayer.layerDatabase, HttpServer.layerServices)),
  );

const base = "http://localhost";

const post = (path: string, payload: unknown = {}, cookies: Record<string, string> = {}) =>
  HttpClientRequest.post(`${base}${path}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(payload),
    HttpClientRequest.setHeader("cookie", cookieHeader(cookies)),
  );
const get = (path: string, cookies: Record<string, string> = {}) =>
  HttpClientRequest.get(`${base}${path}`).pipe(
    HttpClientRequest.setHeader("cookie", cookieHeader(cookies)),
  );
const del = (path: string, cookies: Record<string, string> = {}) =>
  HttpClientRequest.delete(`${base}${path}`).pipe(
    HttpClientRequest.setHeader("cookie", cookieHeader(cookies)),
  );
const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

const setCookies = (response: Response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((header) => {
      const [pair = "", ...attributes] = header.split(/;\s*/);
      const at = pair.indexOf("=");
      return [pair.slice(0, at), { value: pair.slice(at + 1), attributes }];
    }),
  );

const body = (response: Response): Effect.Effect<any> => Effect.promise(() => response.json());

const sessionOf = (response: Response) => {
  const cookie = setCookies(response)[Security.sessionCookieName];
  expect(cookie?.attributes).toEqual(
    expect.arrayContaining(["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]),
  );
  return { [Security.sessionCookieName]: cookie!.value };
};

const newInvite = CreateInvite.createInvite.pipe(Effect.map((invite) => invite.token));

/** Signs up a new member from an invite with a new passkey of `authenticator`. */
const signUpWithPasskey = (
  send: Send,
  authenticator: ReturnType<typeof SoftAuthenticator.make>,
  invite: string,
) =>
  Effect.gen(function* () {
    const options = yield* send(post("/auth/passkey/sign-up/options", { invite }));
    expect(options.status).toBe(200);
    const challenge = yield* body(options);
    const credential = yield* Effect.promise(() =>
      authenticator.create(challenge.options, webOrigin),
    );
    return yield* send(
      post("/auth/passkey/sign-up", {
        challengeId: challenge.challengeId,
        invite,
        credential,
        displayName: "Synthetic Member",
      }),
    );
  });

const signInWithPasskey = (
  send: Send,
  authenticator: ReturnType<typeof SoftAuthenticator.make>,
  origin = webOrigin,
) =>
  Effect.gen(function* () {
    const challenge = yield* body(yield* send(post("/auth/passkey/options")));
    expect(challenge.options.rpId).toBe("web.example.com");
    // Discoverable credentials: no list of passkeys to choose from.
    expect(challenge.options.allowCredentials ?? []).toEqual([]);
    const credential = yield* Effect.promise(() => authenticator.get(challenge.options, origin));
    return {
      challenge,
      credential,
      response: yield* send(
        post("/auth/passkey/sign-in", { challengeId: challenge.challengeId, credential }),
      ),
    };
  });

describe("passkeys", () => {
  it.live("sign up from an invite, then sign in with the same passkey and no user name", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const authenticator = SoftAuthenticator.make();
        const invite = yield* newInvite;
        const signedUp = yield* signUpWithPasskey(send, authenticator, invite);
        expect(signedUp.status).toBe(200);
        expect(yield* body(signedUp)).toEqual({ me: { kind: "user" } });
        const cookies = sessionOf(signedUp);

        const db = yield* D1Database.Database;
        const [member] = yield* db.all(
          D1Database.sql`SELECT id, display_name, role FROM users WHERE display_name = 'Synthetic Member'`,
        );
        expect(member).toMatchObject({ role: "member" });
        // The passkey's user handle is the member's id; only the public key is stored.
        expect(authenticator.passkeys[0]!.userHandle).toBe(b64(String(member!["id"])));
        const [stored] = yield* db.all(D1Database.sql`SELECT * FROM passkeys`);
        expect(stored).toMatchObject({ user_id: member!["id"], synced: 1, name: "Synced passkey" });
        const [used] = yield* db.all(D1Database.sql`SELECT accepted_by FROM invites`);
        expect(used).toEqual({ accepted_by: member!["id"] });

        const me = yield* send(get("/auth/methods", cookies));
        expect((yield* body(me)).passkeys).toHaveLength(1);

        const { response } = yield* signInWithPasskey(send, authenticator);
        expect(response.status).toBe(200);
        const again = sessionOf(response);
        expect((yield* send(get("/auth/me", again))).status).toBe(200);
        const sessions = yield* db.all(
          D1Database.sql`SELECT method, github_login, user_id FROM sessions`,
        );
        expect(sessions).toEqual([
          { method: "passkey", github_login: "", user_id: member!["id"] },
          { method: "passkey", github_login: "", user_id: member!["id"] },
        ]);
        const [touched] = yield* db.all(D1Database.sql`SELECT last_used_at FROM passkeys`);
        expect(touched!["last_used_at"]).not.toBeNull();
      }),
    ),
  );

  it.live("refuses an unknown passkey, a used challenge, another origin and a closed invite", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const stranger = SoftAuthenticator.make();
        const invite = yield* newInvite;
        // A passkey this stash never registered.
        yield* Effect.promise(() =>
          stranger.create(
            { rp: { id: "web.example.com" }, user: { id: "eA" }, challenge: "AA" },
            webOrigin,
          ),
        );
        expect((yield* signInWithPasskey(send, stranger)).response.status).toBe(403);

        const member = SoftAuthenticator.make();
        expect((yield* signUpWithPasskey(send, member, invite)).status).toBe(200);
        // The invite is used up now.
        expect((yield* send(post("/auth/passkey/sign-up/options", { invite }))).status).toBe(404);

        // A phishing page on another origin: the browser signs that origin, the api refuses it.
        expect(
          (yield* signInWithPasskey(send, member, "https://evil.example.org")).response.status,
        ).toBe(403);

        // An answer is good once.
        const { challenge, credential, response } = yield* signInWithPasskey(send, member);
        expect(response.status).toBe(200);
        const replay = yield* send(
          post("/auth/passkey/sign-in", { challengeId: challenge.challengeId, credential }),
        );
        expect(replay.status).toBe(403);

        // A sign-in challenge does not sign anyone up, and the other way round.
        const signInChallenge = yield* body(yield* send(post("/auth/passkey/options")));
        const other = yield* newInvite;
        const created = yield* Effect.promise(() =>
          SoftAuthenticator.make().create(
            { ...signInChallenge.options, rp: { id: "web.example.com" }, user: { id: "eA" } },
            webOrigin,
          ),
        );
        const mixed = yield* send(
          post("/auth/passkey/sign-up", {
            challengeId: signInChallenge.challengeId,
            invite: other,
            credential: created,
          }),
        );
        expect(mixed.status).toBe(403);
      }),
    ),
  );

  it.live("adds and removes passkeys from Settings, but never the last way to sign in", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const phone = SoftAuthenticator.make();
        const laptop = SoftAuthenticator.make({ synced: false, counts: true });
        const cookies = sessionOf(yield* signUpWithPasskey(send, phone, yield* newInvite));

        const options = yield* body(yield* send(post("/auth/passkeys/options", {}, cookies)));
        // The passkey they have is excluded, so the same authenticator is not added twice.
        expect(options.options.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([
          phone.passkeys[0]!.id,
        ]);
        const credential = yield* Effect.promise(() => laptop.create(options.options, webOrigin));
        const added = yield* send(
          post(
            "/auth/passkeys",
            { challengeId: options.challengeId, credential, name: "Work laptop" },
            cookies,
          ),
        );
        expect(added.status).toBe(201);
        expect(yield* body(added)).toMatchObject({ name: "Work laptop", synced: false });

        // The laptop signs in too, and its counter is kept.
        expect((yield* signInWithPasskey(send, laptop)).response.status).toBe(200);
        const db = yield* D1Database.Database;
        const counters = yield* db.all(
          D1Database.sql`SELECT name, counter FROM passkeys ORDER BY name`,
        );
        expect(counters).toEqual([
          { name: "Synced passkey", counter: 0 },
          { name: "Work laptop", counter: 1 },
        ]);

        const listed = (yield* body(yield* send(get("/auth/methods", cookies)))).passkeys;
        expect(listed).toHaveLength(2);
        expect((yield* send(del(`/auth/passkeys/${phone.passkeys[0]!.id}`, cookies))).status).toBe(
          204,
        );
        const last = yield* send(del(`/auth/passkeys/${laptop.passkeys[0]!.id}`, cookies));
        expect(last.status).toBe(409);
        // Another user's passkey (here: one that does not exist) is not found.
        expect((yield* send(del("/auth/passkeys/AAAAAAAAAAAAAAAAAAAAAA", cookies))).status).toBe(
          404,
        );
      }),
    ),
  );

  it.live("manages sign-in methods only with a web session, never with an API token", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const db = yield* D1Database.Database;
        const token = Redacted.make("stash_synthetic-device-token");
        yield* db.run(
          D1Database.sql`INSERT INTO api_tokens (id, user_id, device_id, hash)
            VALUES ('t1', ${Testing.owner.id}, ${AuthTestLayer.deviceId},
              ${yield* ApiTokenSecret.hash(token)})`,
        );
        const withToken = get("/auth/methods").pipe(
          HttpClientRequest.bearerToken(Redacted.value(token)),
        );
        expect((yield* send(withToken)).status).toBe(403);
        const adding = post("/auth/passkeys/options").pipe(
          HttpClientRequest.bearerToken(Redacted.value(token)),
        );
        expect((yield* send(adding)).status).toBe(403);
        const anonymous = yield* send(get("/auth/methods"));
        expect(anonymous.status).toBe(401);
      }),
    ),
  );

  it.live("rate limits the open passkey endpoints per client address", () =>
    withServer(
      (send) =>
        Effect.gen(function* () {
          const from = (ip: string) =>
            post("/auth/passkey/options").pipe(
              HttpClientRequest.setHeader(AuthHandlers.clientIpHeader, ip),
            );
          expect((yield* send(from("192.0.2.1"))).status).toBe(200);
          expect((yield* send(from("192.0.2.1"))).status).toBe(200);
          expect((yield* send(from("192.0.2.1"))).status).toBe(429);
          expect((yield* send(from("192.0.2.2"))).status).toBe(200);
        }),
      { limit: 2 },
    ),
  );
});

/** Runs the browser's part of a Google sign-in: start, Google's redirect, the callback. */
const googleFlow = (
  send: Send,
  start: Response,
  claims: (nonce: string) => Record<string, unknown>,
  options: { readonly keys?: CryptoKeyPair; readonly binding?: string | null } = {},
) =>
  Effect.gen(function* () {
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location")!);
    const binding = setCookies(start)[GoogleSignIn.bindingCookieName]!.value;
    const state = location.searchParams.get("state")!;
    const nonce = location.searchParams.get("nonce")!;
    const code = `code-${crypto.randomUUID()}`;
    issued.set(code, { claims: claims(nonce), ...(options.keys ? { keys: options.keys } : {}) });
    const cookies: Record<string, string> =
      options.binding === null
        ? {}
        : { [GoogleSignIn.bindingCookieName]: options.binding ?? binding };
    return yield* send(
      get(
        `/auth/google/callback?${new URLSearchParams({ code, state, scope: "openid email" })}`,
        cookies,
      ),
    );
  });

const now = () => Math.floor(Date.now() / 1000);
const googleClaims =
  (sub: string, email = "person@example.com") =>
  (nonce: string) => ({
    iss: idp,
    aud: "synthetic-google-client-id",
    sub,
    email,
    email_verified: true,
    iat: now(),
    exp: now() + 3600,
    nonce,
  });

const locationOf = (response: Response) => {
  expect(response.status).toBe(302);
  return response.headers.get("location")!;
};

describe("Sign in with Google", () => {
  it.live("starts an authorization code flow with PKCE, state and nonce on the web origin", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const start = yield* send(get("/auth/google/start?redirect=%2Fsettings"));
        const location = new URL(locationOf(start));
        expect(location.origin + location.pathname).toBe(`${idp}/authorize`);
        const params = Object.fromEntries(location.searchParams);
        expect(params).toMatchObject({
          response_type: "code",
          client_id: "synthetic-google-client-id",
          redirect_uri: "https://web.example.com/api/auth/google/callback",
          scope: "openid email",
          code_challenge_method: "S256",
        });
        expect(params["state"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(params["nonce"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(params["code_challenge"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(setCookies(start)[GoogleSignIn.bindingCookieName]?.attributes).toEqual(
          expect.arrayContaining(["HttpOnly", "Secure", "SameSite=Lax"]),
        );
        // Nothing secret reaches the browser but the binding cookie.
        expect(location.toString()).not.toContain("synthetic-google-client-secret");
      }),
    ),
  );

  it.live("signs a new member up with an invite, and signs them in by `sub` afterwards", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const invite = yield* newInvite;
        const first = yield* googleFlow(
          send,
          yield* send(get(`/auth/google/start?invite=${invite}&redirect=%2Flinks`)),
          googleClaims("google-sub-1"),
        );
        expect(locationOf(first)).toBe("/links");
        const cookies = sessionOf(first);
        expect(setCookies(first)[GoogleSignIn.bindingCookieName]?.attributes).toContain(
          "Max-Age=0",
        );
        // The code went to Google's token endpoint with the PKCE verifier and the secret.
        expect(tokenRequests.at(-1)).toMatchObject({
          grant_type: "authorization_code",
          client_id: "synthetic-google-client-id",
          client_secret: "synthetic-google-client-secret",
          redirect_uri: "https://web.example.com/api/auth/google/callback",
          code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        });
        const methods = yield* body(yield* send(get("/auth/methods", cookies)));
        expect(methods.accounts).toEqual([
          expect.objectContaining({
            id: "google:google-sub-1",
            provider: "google",
            label: "person@example.com",
            fixed: false,
          }),
        ]);

        // The address changed since: `sub` still finds the member, with no invite.
        const second = yield* googleFlow(
          send,
          yield* send(get("/auth/google/start")),
          googleClaims("google-sub-1", "renamed@example.com"),
        );
        expect(locationOf(second)).toBe("/");
        const db = yield* D1Database.Database;
        const users = yield* db.all(D1Database.sql`SELECT COUNT(*) AS n FROM users`);
        expect(users).toEqual([{ n: 4 }]);
      }),
    ),
  );

  it.live("refuses an account without an invite, another browser, a bad token and a cancel", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const start = () => send(get("/auth/google/start"));
        const noInvite = yield* googleFlow(send, yield* start(), googleClaims("google-sub-2"));
        expect(locationOf(noInvite)).toBe("/login?signin=google_not_allowed");
        expect(setCookies(noInvite)[Security.sessionCookieName]).toBeUndefined();

        // The callback in a browser that did not start the flow (login CSRF).
        const elsewhere = yield* googleFlow(send, yield* start(), googleClaims("google-sub-2"), {
          binding: null,
        });
        expect(locationOf(elsewhere)).toBe("/login?signin=google_expired");
        const forged = yield* googleFlow(send, yield* start(), googleClaims("google-sub-2"), {
          binding: "forged",
        });
        expect(locationOf(forged)).toBe("/login?signin=google_expired");

        // ID tokens that must not be trusted.
        const invite = yield* newInvite;
        const withInvite = () => send(get(`/auth/google/start?invite=${invite}`));
        const bad = [
          { claims: googleClaims("g"), keys: otherKeys },
          { claims: (n: string) => ({ ...googleClaims("g")(n), aud: "another-client" }) },
          { claims: (n: string) => ({ ...googleClaims("g")(n), iss: "https://evil.example.org" }) },
          { claims: (n: string) => ({ ...googleClaims("g")(n), exp: now() - 3600 }) },
          { claims: (n: string) => ({ ...googleClaims("g")(n), nonce: `${n}x` }) },
        ];
        for (const { claims, keys } of bad) {
          const response = yield* googleFlow(
            send,
            yield* withInvite(),
            claims,
            keys === undefined ? {} : { keys },
          );
          expect(locationOf(response)).toBe(`/invite/${invite}?signin=google_failed`);
          expect(setCookies(response)[Security.sessionCookieName]).toBeUndefined();
        }
        // The invite was never spent on them.
        const db = yield* D1Database.Database;
        expect(yield* db.all(D1Database.sql`SELECT accepted_at FROM invites`)).toEqual([
          { accepted_at: null },
        ]);

        const cancelled = yield* start();
        const state = new URL(locationOf(cancelled)).searchParams.get("state")!;
        const denied = yield* send(
          get(`/auth/google/callback?error=access_denied&state=${state}`, {
            [GoogleSignIn.bindingCookieName]:
              setCookies(cancelled)[GoogleSignIn.bindingCookieName]!.value,
          }),
        );
        expect(locationOf(denied)).toBe("/login?signin=google_denied");
        // A state is good once.
        expect(locationOf(yield* send(get(`/auth/google/callback?code=x&state=${state}`)))).toBe(
          "/login?signin=google_expired",
        );
      }),
    ),
  );

  it.live("links Google to a signed-in user, and never to a second one", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const first = sessionOf(
          yield* signUpWithPasskey(send, SoftAuthenticator.make(), yield* newInvite),
        );
        const link = yield* send(post("/auth/google/link", {}, first));
        expect(link.status).toBe(200);
        const { url } = yield* body(link);
        const start = new Response(null, {
          status: 302,
          headers: { location: url, "set-cookie": link.headers.getSetCookie()[0]! },
        });
        const linked = yield* googleFlow(send, start, googleClaims("google-sub-3"));
        expect(locationOf(linked)).toBe("/settings#security");
        // Linking keeps the session the user has.
        expect(setCookies(linked)[Security.sessionCookieName]).toBeUndefined();
        const methods = yield* body(yield* send(get("/auth/methods", first)));
        expect(methods.accounts.map((a: { id: string }) => a.id)).toEqual(["google:google-sub-3"]);
        // Two ways in now: the Google account can go, then the passkey is the last one.
        expect((yield* send(del("/auth/accounts/google:google-sub-3", first))).status).toBe(204);
        const passkey = methods.passkeys[0].id;
        expect((yield* send(del(`/auth/passkeys/${passkey}`, first))).status).toBe(409);

        const linkAgain = yield* send(post("/auth/google/link", {}, first));
        const again = yield* googleFlow(
          send,
          new Response(null, {
            status: 302,
            headers: {
              location: (yield* body(linkAgain)).url,
              "set-cookie": linkAgain.headers.getSetCookie()[0]!,
            },
          }),
          googleClaims("google-sub-3"),
        );
        expect(locationOf(again)).toBe("/settings#security");

        const second = sessionOf(
          yield* signUpWithPasskey(send, SoftAuthenticator.make(), yield* newInvite),
        );
        const otherLink = yield* send(post("/auth/google/link", {}, second));
        const taken = yield* googleFlow(
          send,
          new Response(null, {
            status: 302,
            headers: {
              location: (yield* body(otherLink)).url,
              "set-cookie": otherLink.headers.getSetCookie()[0]!,
            },
          }),
          googleClaims("google-sub-3"),
        );
        expect(locationOf(taken)).toBe("/settings?signin=google_taken");
      }),
    ),
  );

  it.live("answers providers without Google when it is not configured", () =>
    withServer(
      (send) =>
        Effect.gen(function* () {
          expect(yield* body(yield* send(get("/auth/providers")))).toEqual({
            google: false,
            github: true,
          });
        }),
      { google: false },
    ),
  );
});

describe("linking GitHub", () => {
  it.live("links a member's GitHub account from a device flow, then it signs them in", () =>
    withServer((send) =>
      Effect.gen(function* () {
        const cookies = sessionOf(
          yield* signUpWithPasskey(send, SoftAuthenticator.make(), yield* newInvite),
        );
        const { flowId } = yield* body(yield* send(post("/auth/device/start")));
        // The first poll comes before the interval.
        let status = yield* body(yield* send(post("/auth/github/link", { flowId }, cookies)));
        if (status.status === "slow_down") {
          yield* Effect.sleep("1100 millis");
          status = yield* body(yield* send(post("/auth/github/link", { flowId }, cookies)));
        }
        expect(status).toMatchObject({
          status: "complete",
          account: { id: "github:7007", provider: "github", label: "synthetic-gh" },
        });
        const db = yield* D1Database.Database;
        const [row] = yield* db.all(
          D1Database.sql`SELECT provider, subject, label FROM user_identities`,
        );
        expect(row).toEqual({ provider: "github", subject: "7007", label: "synthetic-gh" });
      }),
    ),
  );
});

describe("return paths", () => {
  it.each([
    ["/settings", "/settings"],
    ["/authorize/session?state=abc", "/authorize/session?state=abc"],
    ["//evil.example.org/x", "/"],
    ["https://evil.example.org", "/"],
    ["/\\evil.example.org", "/"],
    ["/ok\nLocation: x", "/"],
    ["settings", "/"],
    [undefined, "/"],
  ])("%j → %j", (input, expected) => {
    expect(ReturnPath.sanitize(input)).toBe(expected);
  });
});
