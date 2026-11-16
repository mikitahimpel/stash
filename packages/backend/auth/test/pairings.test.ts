import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Errors from "@stash/contracts-domain/errors";
import * as Pairing from "@stash/contracts-domain/pairing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as ApiTokenSecret from "../src/api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../src/api-tokens/api-tokens-repo.ts";
import * as ApprovePairing from "../src/pairings/approve-pairing.ts";
import * as ClaimPairing from "../src/pairings/claim-pairing.ts";
import * as PairingsRepo from "../src/pairings/pairings-repo.ts";
import * as AuthTestLayer from "./auth-test-layer.ts";

const TestLayer = Layer.mergeAll(ApiTokensRepo.layer, PairingsRepo.layer).pipe(
  Layer.provideMerge(AuthTestLayer.layerDatabase),
);

// Synthetic codes, as an extension would make them.
const code = Pairing.PairingCode.make("synthetic-pairing-code-0000000000000000000");
const otherCode = Pairing.PairingCode.make("synthetic-pairing-code-1111111111111111111");

const notFound = new Errors.NotFound({ resource: "pairing", id: "code" });

describe("extension pairing", () => {
  it.effect("claims a device token once after the owner approves", () =>
    Effect.gen(function* () {
      expect(yield* ClaimPairing.claimPairing(code).pipe(Effect.flip)).toEqual(notFound);

      const device = yield* ApprovePairing.approvePairing(code, "Synthetic Zen");
      expect(device).toMatchObject({ name: "Synthetic Zen", kind: "zen" });
      const created = yield* ClaimPairing.claimPairing(code);
      expect(created.deviceId).toBe(device.id);
      expect(Redacted.value(created.token)).toMatch(/^stash_/);

      expect(yield* ClaimPairing.claimPairing(code).pipe(Effect.flip)).toEqual(notFound);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("stores only the hash of the code", () =>
    Effect.gen(function* () {
      yield* ApprovePairing.approvePairing(code, "Synthetic Zen");
      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT code_hash FROM device_pairings`),
      );
      expect(rows).toEqual([{ code_hash: yield* ApiTokenSecret.hash(Redacted.make(code)) }]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lapses after the pairing TTL", () =>
    Effect.gen(function* () {
      yield* ApprovePairing.approvePairing(code, "Synthetic Zen");
      yield* TestClock.adjust(`${Pairing.pairingTtlMinutes} minutes`);
      expect(yield* ClaimPairing.claimPairing(code).pipe(Effect.flip)).toEqual(notFound);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects a code approved twice, registering no second device", () =>
    Effect.gen(function* () {
      const countDevices = D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT id FROM devices`),
      ).pipe(Effect.map((rows) => rows.length));
      yield* ApprovePairing.approvePairing(code, "Synthetic Zen");
      const before = yield* countDevices;
      const again = yield* ApprovePairing.approvePairing(code, "Synthetic Zen").pipe(Effect.flip);
      expect(again._tag).toBe("Conflict");
      expect(yield* countDevices).toBe(before);
      // Another code still works.
      yield* ApprovePairing.approvePairing(otherCode, "Synthetic Zen 2");
      expect(yield* countDevices).toBe(before + 1);
    }).pipe(Effect.provide(TestLayer)),
  );
});
