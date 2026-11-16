import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Pairing from "@stash/contracts-domain/pairing";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";
import * as PairingsRepo from "./pairings-repo.ts";

/** The SHA-256 of a pairing code, as stored. The code is a credential, so only its hash is kept. */
export const hashCode = (code: Pairing.PairingCode) => ApiTokenSecret.hash(Redacted.make(code));

/**
 * The signed-in owner approves an extension's pairing code: registers the extension's Zen device
 * named `name` and lets the extension claim one token for it within `pairingTtlMinutes`.
 * `Conflict`, with nothing registered, when the code was approved already.
 */
export const approvePairing = Effect.fn("approvePairing")(function* (
  code: Pairing.PairingCode,
  name: string,
) {
  const pairings = yield* PairingsRepo.PairingsRepo;
  const now = yield* DateTime.now;
  const device: Device.Device = {
    id: Device.DeviceId.make(crypto.randomUUID()),
    name,
    kind: "zen",
    createdAt: now,
  };
  const approved = yield* pairings.approve({
    codeHash: yield* hashCode(code),
    device,
    expiresAt: DateTime.add(now, { minutes: Pairing.pairingTtlMinutes }),
  });
  if (!approved) return yield* new Errors.Conflict({ message: "This pairing code is used" });
  return device;
});
