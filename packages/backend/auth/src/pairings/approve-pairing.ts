import type * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Pairing from "@stash/contracts-domain/pairing";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import * as PairingsRepo from "./pairings-repo.ts";

/** The SHA-256 of a pairing code, as stored. The code is a credential, so only its hash is kept. */
export const hashCode = (code: Pairing.PairingCode) => ApiTokenSecret.hash(Redacted.make(code));

/**
 * The signed-in owner approves an extension's pairing code for a device: the extension may claim
 * one token for it within `pairingTtlMinutes`. `NotFound` for an unknown device, `Conflict` when
 * the code was approved already.
 */
export const approvePairing = Effect.fn("approvePairing")(function* (
  code: Pairing.PairingCode,
  deviceId: Device.DeviceId,
) {
  const tokens = yield* ApiTokensRepo.ApiTokensRepo;
  const pairings = yield* PairingsRepo.PairingsRepo;
  if (!(yield* tokens.deviceExists(deviceId))) {
    return yield* new Errors.NotFound({ resource: "device", id: deviceId });
  }
  const now = yield* DateTime.now;
  const inserted = yield* pairings.insert({
    codeHash: yield* hashCode(code),
    deviceId,
    expiresAt: DateTime.add(now, { minutes: Pairing.pairingTtlMinutes }),
  });
  if (!inserted) return yield* new Errors.Conflict({ message: "This pairing code is used" });
});
