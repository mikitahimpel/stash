import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ApiTokensRepo from "./api-tokens-repo.ts";
import * as CreateApiToken from "./create-api-token.ts";
import * as ListApiTokens from "./list-api-tokens.ts";
import * as RevokeApiToken from "./revoke-api-token.ts";

// Database failures are defects here: the endpoints declare no error for them, so they answer 500.

/** The `tokens` group of the `StashApi`. Needs `ApiTokensRepo` and the `Authorization` middleware. */
export const layer = HttpApiBuilder.group(Api.StashApi, "tokens", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* ApiTokensRepo.ApiTokensRepo;
    const withRepo = Effect.provideService(ApiTokensRepo.ApiTokensRepo, repo);
    return handlers
      .handle("list", () => ListApiTokens.listApiTokens.pipe(withRepo, Effect.orDie))
      .handle("create", ({ payload }) =>
        CreateApiToken.createApiToken(payload.deviceId).pipe(
          withRepo,
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      )
      .handle("revoke", ({ params }) =>
        RevokeApiToken.revokeApiToken(params.id).pipe(
          withRepo,
          Effect.catchTag("DatabaseError", Effect.die),
          Effect.asVoid,
        ),
      );
  }),
);
