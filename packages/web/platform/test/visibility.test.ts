import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Testing from "../src/testing.ts";
import * as Visibility from "../src/visibility.ts";

// Lets the forked stream subscribe before the test changes state.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Visibility (live)", () => {
  it.effect("reads document.visibilityState and follows visibilitychange", () => {
    const doc = Object.assign(new EventTarget(), {
      visibilityState: "visible" as Visibility.VisibilityState,
    });
    const change = (state: Visibility.VisibilityState) => {
      doc.visibilityState = state;
      doc.dispatchEvent(new Event("visibilitychange"));
    };
    vi.stubGlobal("document", doc);
    return Effect.gen(function* () {
      const visibility = yield* Visibility.Visibility;
      expect(yield* visibility.current).toBe("visible");

      const fiber = yield* visibility.changes.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      change("hidden");
      change("hidden");
      change("visible");
      expect(yield* Fiber.join(fiber)).toEqual(["visible", "hidden", "visible"]);
    }).pipe(Effect.provide(Visibility.layer));
  });
});

describe("Visibility (in memory)", () => {
  it.effect("emits the current state and every change", () =>
    Effect.gen(function* () {
      const visibility = yield* Visibility.Visibility;
      const test = yield* Testing.TestVisibility;
      expect(yield* visibility.current).toBe("hidden");
      const fiber = yield* visibility.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      yield* test.setState("visible");
      expect(yield* Fiber.join(fiber)).toEqual(["hidden", "visible"]);
    }).pipe(Effect.provide(Testing.layerVisibility({ state: "hidden" }))),
  );
});
