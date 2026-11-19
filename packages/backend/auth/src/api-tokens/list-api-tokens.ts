import * as Effect from "effect/Effect";
import * as ApiTokensRepo from "./api-tokens-repo.ts";

/** Every token of the current user, revoked ones included, without secrets or hashes. */
export const listApiTokens = ApiTokensRepo.ApiTokensRepo.use((repo) => repo.list).pipe(
  Effect.withSpan("listApiTokens"),
);
