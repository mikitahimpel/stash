import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import * as Pairing from "@stash/contracts-domain/pairing";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

export const ApprovePairing = Schema.Struct({
  code: Pairing.PairingCode,
  /** The name of the Zen device the extension will act as. Approving registers it. */
  name: Device.DeviceName,
});
export type ApprovePairing = typeof ApprovePairing.Type;

export const ClaimPairing = Schema.Struct({
  code: Pairing.PairingCode,
});
export type ClaimPairing = typeof ClaimPairing.Type;

/**
 * Pairs the extension without copying a token. The extension makes a one-time code and opens the
 * web app's `/connect/extension?code=…`. The signed-in owner approves there (`approve`, guarded),
 * which registers the extension's Zen device and binds the code to it for `pairingTtlMinutes`, in
 * one transaction: a code approved twice answers `Conflict` and registers nothing. The extension polls `claim` with the
 * code. `claim` is open, because the extension has no credential yet: the code is the credential.
 * It answers `NotFound` (404) until the code is approved, then a new device token exactly once.
 */
export class PairingsGroup extends HttpApiGroup.make("pairings")
  .add(
    HttpApiEndpoint.post("approve", "/pairings", {
      payload: ApprovePairing,
      success: Device.Device.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.Conflict,
    }).middleware(Security.Authorization),
  )
  .add(
    HttpApiEndpoint.post("claim", "/pairings/claim", {
      payload: ClaimPairing,
      success: ApiToken.CreatedApiToken.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.NotFound,
    }),
  ) {}
