import { describe, expect, it } from "@effect/vitest";
import * as Errors from "@stash/contracts-domain/errors";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as SaveRateLimiter from "../src/save/save-rate-limiter.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

const consume = (principal: Parameters<SaveRateLimiter.SaveRateLimiter["Service"]["consume"]>[0]) =>
  SaveRateLimiter.SaveRateLimiter.use((limiter) => limiter.consume(principal));

describe("SaveRateLimiter", () => {
  it.effect("allows `limit` saves per window, then fails with the seconds left", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("10 seconds");
      for (let i = 0; i < 3; i++) yield* consume(LinksTestLayer.device);
      const error = yield* consume(LinksTestLayer.device).pipe(Effect.flip);
      expect(error).toEqual(new Errors.RateLimited({ retryAfterSeconds: 50 }));
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 3, windowSeconds: 60 }))),
  );

  it.effect("starts a fresh count in the next window", () =>
    Effect.gen(function* () {
      for (let i = 0; i < 3; i++) yield* consume(LinksTestLayer.device);
      yield* consume(LinksTestLayer.device).pipe(Effect.flip);
      yield* TestClock.adjust("60 seconds");
      yield* consume(LinksTestLayer.device);
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 3, windowSeconds: 60 }))),
  );

  it.effect("counts each principal separately", () =>
    Effect.gen(function* () {
      const other = { kind: "device", deviceId: Device.DeviceId.make("device-ios-1") } as const;
      for (let i = 0; i < 3; i++) yield* consume(LinksTestLayer.device);
      yield* consume(other);
      yield* consume(LinksTestLayer.user);
      expect((yield* consume(LinksTestLayer.device).pipe(Effect.flip))._tag).toBe("RateLimited");
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 3, windowSeconds: 60 }))),
  );
});
