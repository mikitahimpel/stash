import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Network from "../src/network.ts";
import * as Testing from "../src/testing.ts";

// Lets the forked stream subscribe before the test changes state.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Network (live)", () => {
  it.effect("reads navigator.onLine and follows online/offline events", () => {
    const target = new EventTarget();
    const nav = { onLine: false };
    vi.stubGlobal("window", target);
    vi.stubGlobal("navigator", nav);
    return Effect.gen(function* () {
      const network = yield* Network.Network;
      expect(yield* network.isOnline).toBe(false);

      const fiber = yield* network.changes.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      target.dispatchEvent(new Event("online"));
      target.dispatchEvent(new Event("online"));
      target.dispatchEvent(new Event("offline"));
      expect(yield* Fiber.join(fiber)).toEqual([false, true, false]);

      nav.onLine = true;
      expect(yield* network.isOnline).toBe(true);
    }).pipe(Effect.provide(Network.layer));
  });
});

describe("Network (in memory)", () => {
  it.effect("emits the current state and every change", () =>
    Effect.gen(function* () {
      const network = yield* Network.Network;
      const test = yield* Testing.TestNetwork;
      const fiber = yield* network.changes.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* settle;
      yield* test.setOnline(false);
      yield* settle;
      yield* test.setOnline(false);
      yield* settle;
      yield* test.setOnline(true);
      expect(yield* Fiber.join(fiber)).toEqual([true, false, true]);
      expect(yield* network.isOnline).toBe(true);
    }).pipe(Effect.provide(Testing.layerNetwork())),
  );

  it.effect("can start offline", () =>
    Effect.gen(function* () {
      const network = yield* Network.Network;
      expect(yield* network.isOnline).toBe(false);
    }).pipe(Effect.provide(Testing.layerNetwork({ online: false }))),
  );
});
