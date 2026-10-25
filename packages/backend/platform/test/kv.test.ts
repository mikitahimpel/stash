import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Kv from "../src/kv.ts";
import * as Testing from "../src/testing.ts";

describe("Kv (in memory)", () => {
  it.effect("gets, puts and deletes", () =>
    Effect.gen(function* () {
      const kv = yield* Kv.Kv;
      expect(yield* kv.get("session:1")).toEqual(Option.none());
      yield* kv.put("session:1", "synthetic-value");
      expect(yield* kv.get("session:1")).toEqual(Option.some("synthetic-value"));
      yield* kv.put("session:1", "replaced");
      expect(yield* kv.get("session:1")).toEqual(Option.some("replaced"));
      yield* kv.delete("session:1");
      expect(yield* kv.get("session:1")).toEqual(Option.none());
    }).pipe(Effect.provide(Testing.layerKv)),
  );

  it.effect("expires keys after expirationTtl on the Effect clock", () =>
    Effect.gen(function* () {
      const kv = yield* Kv.Kv;
      yield* kv.put("oauth-state:1", "x", { expirationTtl: 60 });
      yield* TestClock.adjust("59 seconds");
      expect(yield* kv.get("oauth-state:1")).toEqual(Option.some("x"));
      yield* TestClock.adjust("1 second");
      expect(yield* kv.get("oauth-state:1")).toEqual(Option.none());
    }).pipe(Effect.provide(Testing.layerKv)),
  );
});

describe("Kv (live)", () => {
  it.effect("wraps the binding and maps failures", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const kv = Kv.make({
        get: async (key) => (key === "present" ? "value" : null),
        put: async (key, value, options) => void calls.push({ key, value, options }),
        delete: async (key) => void calls.push({ deleted: key }),
      });
      expect(yield* kv.get("present")).toEqual(Option.some("value"));
      expect(yield* kv.get("absent")).toEqual(Option.none());
      yield* kv.put("k", "v", { expirationTtl: 120 });
      yield* kv.delete("k");
      expect(calls).toEqual([
        { key: "k", value: "v", options: { expirationTtl: 120 } },
        { deleted: "k" },
      ]);

      const failing = Kv.make({
        get: () => Promise.reject(new Error("kv down")),
        put: () => Promise.reject(new Error("kv down")),
        delete: () => Promise.reject(new Error("kv down")),
      });
      expect(yield* Effect.flip(failing.put("k", "v"))).toMatchObject({
        _tag: "KvError",
        operation: "put",
        key: "k",
      });
    }),
  );
});
