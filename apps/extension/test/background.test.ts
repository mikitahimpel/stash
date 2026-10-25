import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Background from "../entrypoints/background.ts";

describe("background", () => {
  it.effect("builds its layer on the platform services", () =>
    Effect.scoped(Effect.asVoid(Effect.provide(Effect.void, Background.layer))).pipe(
      Effect.provide(Testing.layer),
    ),
  );

  it.effect("keeps running until interrupted", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Background.main(Testing.layer));
      yield* Effect.yieldNow;
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(fiber);
    }),
  );
});
