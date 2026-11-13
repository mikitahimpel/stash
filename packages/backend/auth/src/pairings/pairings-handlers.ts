import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import * as ApprovePairing from "./approve-pairing.ts";
import * as ClaimPairing from "./claim-pairing.ts";
import * as PairingsRepo from "./pairings-repo.ts";

// Database failures are defects here: the endpoints declare no error for them, so they answer 500.

/**
 * The `pairings` group of the `StashApi`. Needs `ApiTokensRepo`, `PairingsRepo` and the
 * `Authorization` middleware (for `approve`; `claim` is open).
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "pairings", (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<
      ApiTokensRepo.ApiTokensRepo | PairingsRepo.PairingsRepo
    >();
    return handlers
      .handle("approve", ({ payload }) =>
        ApprovePairing.approvePairing(payload.code, payload.deviceId).pipe(
          Effect.provideContext(context),
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      )
      .handle("claim", ({ payload }) =>
        ClaimPairing.claimPairing(payload.code).pipe(
          Effect.provideContext(context),
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      );
  }),
);
