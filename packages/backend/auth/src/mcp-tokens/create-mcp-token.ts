import * as StashConfig from "@stash/backend-platform/stash-config";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import * as GithubClient from "../device-flow/github-client.ts";

/**
 * Mints a user token named `Claude (MCP)` for the GitHub login the MCP server just verified. Each
 * authorization gets its own token, listed and revocable in Settings. Only the hash is stored.
 * The login must be the allowlisted one, even though the MCP server checked it already.
 */
export const createMcpToken = Effect.fn("createMcpToken")(function* (login: string) {
  const config = yield* StashConfig.StashConfig;
  if (!GithubClient.sameLogin(login, config.allowedGithubLogin)) {
    return yield* new Errors.LoginNotAllowed({ message: "This GitHub login is not allowed" });
  }
  const repo = yield* ApiTokensRepo.ApiTokensRepo;
  const token = yield* ApiTokenSecret.generate;
  const info = yield* repo.insertUser({
    id: ApiToken.ApiTokenId.make(crypto.randomUUID()),
    name: ApiToken.mcpTokenName,
    githubLogin: login,
    hash: yield* ApiTokenSecret.hash(token),
    createdAt: yield* DateTime.now,
  });
  return { ...info, token } satisfies ApiToken.CreatedApiToken;
});
