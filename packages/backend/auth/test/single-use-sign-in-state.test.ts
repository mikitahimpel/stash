import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as GoogleFlowsStore from "../src/google/google-flows-store.ts";
import * as PasskeyChallenges from "../src/passkeys/passkey-challenges.ts";

// The challenge of a passkey ceremony and the state of a Google sign-in work exactly once, also
// when two answers race for them, and not after they expire.

const layer = Layer.mergeAll(PasskeyChallenges.layer, GoogleFlowsStore.layer).pipe(
  Layer.provideMerge(Testing.layerDatabase),
);

const flow: GoogleFlowsStore.StoredGoogleFlow = {
  verifier: "synthetic-verifier",
  nonce: "synthetic-nonce",
  bindingHash: "synthetic-binding-hash",
  redirect: "/links",
};
const state = "synthetic-state-0123456789abcdef";

describe("passkey challenges", () => {
  it.effect("are taken once, by one of many racing answers", () =>
    Effect.gen(function* () {
      const challenges = yield* PasskeyChallenges.PasskeyChallenges;
      const id = yield* challenges.put({ kind: "sign-in", challenge: "synthetic-challenge" });
      const taken = yield* Effect.all(
        Array.from({ length: 8 }, () => challenges.take(id)),
        { concurrency: "unbounded" },
      );
      expect(taken.filter(Option.isSome)).toHaveLength(1);
      expect(Option.isNone(yield* challenges.take(id))).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("are gone after 5 minutes, and the expired ones are cleared", () =>
    Effect.gen(function* () {
      const challenges = yield* PasskeyChallenges.PasskeyChallenges;
      const late = yield* challenges.put({ kind: "sign-in", challenge: "synthetic-late" });
      const kept = yield* challenges.put({ kind: "sign-in", challenge: "synthetic-kept" });
      yield* TestClock.adjust(`${PasskeyChallenges.ttlSeconds} seconds`);
      expect(Option.isNone(yield* challenges.take(late))).toBe(true);
      expect(Option.isNone(yield* challenges.take(kept))).toBe(true);

      yield* challenges.put({ kind: "sign-in", challenge: "synthetic-old" });
      yield* TestClock.adjust(`${PasskeyChallenges.ttlSeconds + 1} seconds`);
      yield* challenges.put({ kind: "sign-in", challenge: "synthetic-new" });
      const db = yield* D1Database.Database;
      expect(yield* db.all(D1Database.sql`SELECT COUNT(*) AS n FROM passkey_challenges`)).toEqual([
        { n: 1 },
      ]);
    }).pipe(Effect.provide(layer)),
  );
});

describe("Google flows", () => {
  it.effect("are taken once, by one of many racing callbacks", () =>
    Effect.gen(function* () {
      const flows = yield* GoogleFlowsStore.GoogleFlowsStore;
      yield* flows.put(state, flow);
      const taken = yield* Effect.all(
        Array.from({ length: 8 }, () => flows.take(state)),
        { concurrency: "unbounded" },
      );
      expect(taken.filter(Option.isSome)).toEqual([Option.some(flow)]);
      expect(Option.isNone(yield* flows.take(state))).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("are gone after 10 minutes", () =>
    Effect.gen(function* () {
      const flows = yield* GoogleFlowsStore.GoogleFlowsStore;
      yield* flows.put(state, flow);
      yield* TestClock.adjust(`${GoogleFlowsStore.ttlSeconds} seconds`);
      expect(Option.isNone(yield* flows.take(state))).toBe(true);
    }).pipe(Effect.provide(layer)),
  );
});
