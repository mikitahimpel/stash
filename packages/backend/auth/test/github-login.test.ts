import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as AuthGroup from "@stash/contracts-api/auth";
import * as Security from "@stash/contracts-api/security";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
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
import * as StartSession from "../src/sessions/start-session.ts";
import * as SessionVerifierLive from "../src/sessions/session-verifier-live.ts";
import * as SessionsRepo from "../src/sessions/sessions-repo.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

// Sessions through the real `auth` handlers and `Authorization` middleware on an in-memory D1.
// Sessions are started directly until the GitHub Device Flow login lands (#115). All logins and
// tokens are synthetic.

const allowedLogin = "example-user";
const webOrigin = "https://web.example.com";

/** Only the `auth` group, with the same group definition the `StashApi` uses. */
const AuthApi = HttpApi.make("stash").add(AuthGroup.AuthGroup);

const app = HttpApiBuilder.layer(AuthApi).pipe(
  Layer.provide(AuthHandlers.layer),
  Layer.provide(AuthorizationLive.layer),
  Layer.provide(SessionVerifierLive.layer),
  Layer.provide(Layer.mergeAll(ApiTokensRepo.layer, SessionsRepo.layer)),
  Layer.provide(Testing.layerStashConfig({ allowedGithubLogin: allowedLogin, webOrigin })),
);

/** Serves requests in the test's own runtime, so `TestClock` drives session expiry. */
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

/** Signs in the allowlisted login directly and returns the session cookie value. */
const signIn = StartSession.startSession(allowedLogin).pipe(
  Effect.map((session) => Redacted.value(session.token)),
  Effect.provide(SessionsRepo.layer),
);

const sessionRows = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  return yield* db.all(D1Database.sql`SELECT id, github_login FROM sessions`);
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
