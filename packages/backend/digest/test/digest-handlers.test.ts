import { describe, expect, it } from "@effect/vitest";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiTest from "effect/http-api/HttpApiTest";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as BuildWeeklyDigest from "../src/build-weekly-digest.ts";
import * as DigestHandlers from "../src/digest-handlers.ts";
import * as DigestTestLayer from "./digest-test-layer.ts";

// End to end through the contracts `StashApi`: the `digest` group on an in-memory D1.
// `Authorization` is stubbed: the synthetic token is the user, and anything else is `Unauthorized`.

const unauthorized = new Errors.Unauthorized({ message: "Invalid token" });

const layerAuthorizationStub = Layer.succeed(Security.Authorization)({
  bearer: (handler, { credential }) =>
    Redacted.value(credential) === "token-user"
      ? Effect.provideService(handler, Security.CurrentPrincipal, { kind: "user" })
      : Effect.fail(unauthorized),
  session: () => Effect.fail(unauthorized),
});

const server = DigestHandlers.layer.pipe(
  Layer.provideMerge(layerAuthorizationStub),
  Layer.provideMerge(DigestTestLayer.layer()),
  Layer.merge(HttpServer.layerServices),
);

const clientAs = (token?: string) =>
  HttpApiTest.groups(Api.StashApi, ["digest"]).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
        next(token === undefined ? request : HttpClientRequest.bearerToken(request, token)),
      ),
    ),
  );

describe("digest handlers", () => {
  it.effect("answers 404 until a digest is built, then the latest one", () =>
    Effect.gen(function* () {
      const { digest } = yield* clientAs("token-user");
      expect(yield* digest.latest().pipe(Effect.flip)).toBeInstanceOf(Errors.NotFound);

      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-16T06:00:00Z")));
      const built = yield* BuildWeeklyDigest.buildWeeklyDigest();
      expect(yield* digest.latest()).toEqual(built);
    }).pipe(Effect.provide(server)),
  );

  it.effect("answers 401 without a valid credential", () =>
    Effect.gen(function* () {
      const { digest } = yield* clientAs("token-unknown");
      expect(yield* digest.latest().pipe(Effect.flip)).toBeInstanceOf(Errors.Unauthorized);
    }).pipe(Effect.provide(server)),
  );
});
