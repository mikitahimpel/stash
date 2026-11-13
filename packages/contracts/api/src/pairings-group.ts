import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import * as Pairing from "@stash/contracts-domain/pairing";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

export const ApprovePairing = Schema.Struct({
  code: Pairing.PairingCode,
  /** The device the extension will act as, registered by the web page just before. */
  deviceId: Device.DeviceId,
});
export type ApprovePairing = typeof ApprovePairing.Type;

export const ClaimPairing = Schema.Struct({
  code: Pairing.PairingCode,
});
export type ClaimPairing = typeof ClaimPairing.Type;

/**
 * Pairs the extension without copying a token. The extension makes a one-time code and opens the
 * web app's `/connect/extension?code=…`. The signed-in owner approves there (`approve`, guarded),
 * which binds the code to a device for `pairingTtlMinutes`. The extension polls `claim` with the
 * code. `claim` is open, because the extension has no credential yet: the code is the credential.
 * It answers `NotFound` (404) until the code is approved, then a new device token exactly once.
 */
export class PairingsGroup extends HttpApiGroup.make("pairings")
  .add(
    HttpApiEndpoint.post("approve", "/pairings", {
      payload: ApprovePairing,
      success: HttpApiSchema.NoContent,
      error: [ErrorStatuses.NotFound, ErrorStatuses.Conflict],
    }).middleware(Security.Authorization),
  )
  .add(
    HttpApiEndpoint.post("claim", "/pairings/claim", {
      payload: ClaimPairing,
      success: ApiToken.CreatedApiToken.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.NotFound,
    }),
  ) {}
