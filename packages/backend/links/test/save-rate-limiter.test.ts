import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as SaveRateLimiter from "../src/save/save-rate-limiter.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

const consume = SaveRateLimiter.SaveRateLimiter.use((limiter) => limiter.consume);

describe("SaveRateLimiter", () => {
  it.effect("allows `limit` saves per window, then fails with the seconds left", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("10 seconds");
      for (let i = 0; i < 3; i++) yield* consume;
      const error = yield* consume.pipe(Effect.flip);
      expect(error).toEqual(new Errors.RateLimited({ retryAfterSeconds: 50 }));
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 3, windowSeconds: 60 }))),
  );

  it.effect("starts a fresh count in the next window", () =>
    Effect.gen(function* () {
      for (let i = 0; i < 3; i++) yield* consume;
      yield* consume.pipe(Effect.flip);
      yield* TestClock.adjust("60 seconds");
      yield* consume;
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 3, windowSeconds: 60 }))),
  );

  it.effect("counts each user separately: one user's saves never use up another's window", () =>
    Effect.gen(function* () {
      for (let i = 0; i < 3; i++) yield* consume;
      expect((yield* consume.pipe(Effect.flip))._tag).toBe("RateLimited");
      for (let i = 0; i < 3; i++) yield* consume.pipe(Testing.as(Testing.member));
      expect((yield* consume.pipe(Testing.as(Testing.member), Effect.flip))._tag).toBe(
        "RateLimited",
      );
      yield* consume.pipe(Testing.as(Testing.otherMember));
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 3, windowSeconds: 60 }))),
  );
});
