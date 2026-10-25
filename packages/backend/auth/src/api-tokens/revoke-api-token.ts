import type * as ApiToken from "@stash/contracts-domain/api-token";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ApiTokensRepo from "./api-tokens-repo.ts";

/**
 * Revokes a token. It keeps being listed with `revokedAt` set. Revoking it again keeps the first
 * `revokedAt`.
 */
export const revokeApiToken = Effect.fn("revokeApiToken")(function* (id: ApiToken.ApiTokenId) {
  const repo = yield* ApiTokensRepo.ApiTokensRepo;
  const revoked = yield* repo.revoke(id, yield* DateTime.now);
  return yield* Effect.fromOption(revoked).pipe(
    Effect.mapError(() => new Errors.NotFound({ resource: "token", id })),
  );
});
