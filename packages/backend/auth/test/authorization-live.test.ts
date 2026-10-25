import { describe, expect, it } from "@effect/vitest";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiTest from "effect/http-api/HttpApiTest";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as ApiTokensRepo from "../src/api-tokens/api-tokens-repo.ts";
import * as CreateApiToken from "../src/api-tokens/create-api-token.ts";
import * as RevokeApiToken from "../src/api-tokens/revoke-api-token.ts";
import * as TokensHandlers from "../src/api-tokens/tokens-handlers.ts";
import * as AuthorizationLive from "../src/authorization/authorization-live.ts";
import * as SessionVerifier from "../src/authorization/session-verifier.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

// End to end through the contracts `StashApi`: the real request encoding, routing, `Authorization`
// middleware and `tokens` handlers, on an in-memory D1 and without an HTTP server.

/** Synthetic placeholder for a session cookie, not a real session. */
const validSession = "synthetic-session";

/** Accepts only `validSession`, standing in for the GitHub OAuth sessions. */
const layerSessionStub = Layer.succeed(SessionVerifier.SessionVerifier)({
  verify: (session) =>
    Redacted.value(session) === validSession
      ? Effect.succeed({ kind: "user" as const })
      : Effect.fail(new Errors.Unauthorized({ message: "Unknown session" })),
});

const server = (sessions: Layer.Layer<SessionVerifier.SessionVerifier>) =>
  TokensHandlers.layer.pipe(
    Layer.provideMerge(AuthorizationLive.layer),
    Layer.provide(sessions),
    Layer.provideMerge(ApiTokensRepo.layer),
    Layer.provideMerge(AuthTestLayer.layerDatabase),
    Layer.merge(HttpServer.layerServices),
  );

interface Credentials {
  readonly bearer?: string;
  readonly session?: string;
}

/** A `tokens` client that sends the given credentials. */
const clientWith = (credentials: Credentials) =>
  HttpApiTest.groups(Api.StashApi, ["tokens"]).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) => {
        let req = request;
        if (credentials.bearer !== undefined) {
          req = HttpClientRequest.bearerToken(req, credentials.bearer);
        }
        if (credentials.session !== undefined) {
          req = HttpClientRequest.setHeader(
            req,
            "cookie",
            `${Security.sessionCookieName}=${credentials.session}`,
          );
        }
        return next(req);
      }),
    ),
  );

const listAs = (credentials: Credentials) =>
  Effect.flatMap(clientWith(credentials), (client) => client.tokens.list());

const expectUnauthorized = (credentials: Credentials) =>
  Effect.gen(function* () {
    const error = yield* listAs(credentials).pipe(Effect.flip);
    expect(error).toBeInstanceOf(Errors.Unauthorized);
  });

describe("Authorization (live)", () => {
  describe("bearer token", () => {
    it.effect("authenticates a device by its token", () =>
      Effect.gen(function* () {
        const created = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
        const listed = yield* listAs({ bearer: Redacted.value(created.token) });
        expect(listed.map((token) => token.id)).toEqual([created.id]);
      }).pipe(Effect.provide(server(SessionVerifier.layerDenyAll))),
    );

    it.effect("rejects a revoked token with Unauthorized", () =>
      Effect.gen(function* () {
        const created = yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
        const bearer = Redacted.value(created.token);
        yield* listAs({ bearer });

        yield* RevokeApiToken.revokeApiToken(created.id);
        yield* expectUnauthorized({ bearer });
      }).pipe(Effect.provide(server(SessionVerifier.layerDenyAll))),
    );

    it.effect("rejects an unknown token and a missing one", () =>
      Effect.gen(function* () {
        yield* CreateApiToken.createApiToken(AuthTestLayer.deviceId);
        yield* expectUnauthorized({ bearer: "stash_synthetic-unknown-token" });
        yield* expectUnauthorized({});
      }).pipe(Effect.provide(server(SessionVerifier.layerDenyAll))),
    );
  });

  describe("session cookie", () => {
    it.effect("denies every session by default", () =>
      expectUnauthorized({ session: validSession }).pipe(
        Effect.provide(server(SessionVerifier.layerDenyAll)),
      ),
    );

    it.effect("delegates to the SessionVerifier", () =>
      Effect.gen(function* () {
        expect(yield* listAs({ session: validSession })).toEqual([]);
        yield* expectUnauthorized({ session: "synthetic-other-session" });
      }).pipe(Effect.provide(server(layerSessionStub))),
    );

    it.effect("falls back to the session when the bearer token is invalid", () =>
      Effect.gen(function* () {
        expect(yield* listAs({ bearer: "stash_synthetic-unknown", session: validSession })).toEqual(
          [],
        );
      }).pipe(Effect.provide(server(layerSessionStub))),
    );
  });
});

describe("tokens handlers", () => {
  it.effect("creates, lists and revokes tokens over HTTP", () =>
    Effect.gen(function* () {
      const client = yield* clientWith({ session: validSession });
      const created = yield* client.tokens.create({
        payload: { deviceId: AuthTestLayer.deviceId },
      });
      expect(Redacted.value(created.token)).toMatch(/^stash_/);

      const listed = yield* client.tokens.list();
      expect(listed).toEqual([
        {
          id: created.id,
          deviceId: created.deviceId,
          createdAt: created.createdAt,
          revokedAt: null,
        },
      ]);

      yield* client.tokens.revoke({ params: { id: created.id } });
      const [revoked] = yield* client.tokens.list();
      expect(revoked?.revokedAt).not.toBeNull();

      // The revoked token no longer authenticates.
      yield* expectUnauthorized({ bearer: Redacted.value(created.token) });
    }).pipe(Effect.provide(server(layerSessionStub))),
  );

  it.effect("answers NotFound for an unknown device or token", () =>
    Effect.gen(function* () {
      const client = yield* clientWith({ session: validSession });
      const noDevice = yield* client.tokens
        .create({ payload: { deviceId: "device-missing" as never } })
        .pipe(Effect.flip);
      expect(noDevice).toEqual(new Errors.NotFound({ resource: "device", id: "device-missing" }));

      const noToken = yield* client.tokens
        .revoke({ params: { id: "token-missing" as never } })
        .pipe(Effect.flip);
      expect(noToken).toEqual(new Errors.NotFound({ resource: "token", id: "token-missing" }));
    }).pipe(Effect.provide(server(layerSessionStub))),
  );
});
