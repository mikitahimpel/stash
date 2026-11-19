import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import type * as Pairing from "@stash/contracts-domain/pairing";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as CreateApiToken from "../api-tokens/create-api-token.ts";
import * as ApprovePairing from "./approve-pairing.ts";
import * as PairingsRepo from "./pairings-repo.ts";

/**
 * The extension claims the device token for an approved pairing code. It works once: the approval
 * is marked claimed as the token is minted (and kept, so the code can't be approved again). `NotFound` while the code is not approved (the extension
 * polls), after it lapsed, and after it was claimed. The error never says which, so the endpoint
 * tells a guesser nothing.
 */
export const claimPairing = Effect.fn("claimPairing")(function* (code: Pairing.PairingCode) {
  const pairings = yield* PairingsRepo.PairingsRepo;
  const taken = yield* pairings.take(yield* ApprovePairing.hashCode(code), yield* DateTime.now);
  if (Option.isNone(taken)) {
    return yield* new Errors.NotFound({ resource: "pairing", id: "code" });
  }
  // The token is the device's, so it acts for the user who approved the code.
  return yield* CreateApiToken.createApiToken(taken.value.deviceId).pipe(
    Effect.provideService(Security.CurrentUser, taken.value.user),
  );
});
