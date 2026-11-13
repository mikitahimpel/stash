import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Device from "@stash/contracts-domain/device";
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

      yield* ApprovePairing.approvePairing(code, AuthTestLayer.deviceId);
      const created = yield* ClaimPairing.claimPairing(code);
      expect(created.deviceId).toBe(AuthTestLayer.deviceId);
      expect(Redacted.value(created.token)).toMatch(/^stash_/);

      expect(yield* ClaimPairing.claimPairing(code).pipe(Effect.flip)).toEqual(notFound);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("stores only the hash of the code", () =>
    Effect.gen(function* () {
      yield* ApprovePairing.approvePairing(code, AuthTestLayer.deviceId);
      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT code_hash FROM device_pairings`),
      );
      expect(rows).toEqual([{ code_hash: yield* ApiTokenSecret.hash(Redacted.make(code)) }]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("lapses after the pairing TTL", () =>
    Effect.gen(function* () {
      yield* ApprovePairing.approvePairing(code, AuthTestLayer.deviceId);
      yield* TestClock.adjust(`${Pairing.pairingTtlMinutes} minutes`);
      expect(yield* ClaimPairing.claimPairing(code).pipe(Effect.flip)).toEqual(notFound);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects an unknown device and a code approved twice", () =>
    Effect.gen(function* () {
      const missing = Device.DeviceId.make("device-missing");
      expect(yield* ApprovePairing.approvePairing(otherCode, missing).pipe(Effect.flip)).toEqual(
        new Errors.NotFound({ resource: "device", id: "device-missing" }),
      );
      yield* ApprovePairing.approvePairing(code, AuthTestLayer.deviceId);
      const again = yield* ApprovePairing.approvePairing(code, AuthTestLayer.deviceId).pipe(
        Effect.flip,
      );
      expect(again._tag).toBe("Conflict");
    }).pipe(Effect.provide(TestLayer)),
  );
});
