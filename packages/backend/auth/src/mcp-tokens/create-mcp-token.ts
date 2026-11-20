import * as Security from "@stash/contracts-api/security";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as SessionVerifier from "../authorization/session-verifier.ts";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import type * as GithubClient from "../device-flow/github-client.ts";
import * as SignIn from "../sessions/sign-in.ts";

/**
 * Mints a user token named `Claude (MCP)` for the Stash user of the GitHub account the MCP server
 * just verified, so Claude reads and writes that user's stash and nobody else's. Each
 * authorization gets its own token, listed and revocable in the user's Settings. Only the hash is
 * stored. `LoginNotAllowed` for an account without a user: this is where it is decided, and
 * nobody signs up here (that takes an invite, in the web app).
 */
export const createMcpToken = Effect.fn("createMcpToken")(function* (
  account: GithubClient.GithubUser,
) {
  const user = yield* SignIn.resolveUser(account);
  if (Option.isNone(user)) {
    return yield* new Errors.LoginNotAllowed({ message: "This GitHub login is not allowed" });
  }
  return yield* mintFor(user.value);
});

/**
 * The same token for the user of a web session: the MCP sign-in on the site's own host, after a
 * passkey, Google or GitHub sign-in in the web app. `Unauthorized` for a session that is unknown,
 * expired or no longer allowed.
 */
export const createMcpTokenForSession = Effect.fn("createMcpTokenForSession")(function* (
  session: Redacted.Redacted<string>,
) {
  const verifier = yield* SessionVerifier.SessionVerifier;
  const { user } = yield* verifier.verify(session);
  const created = yield* mintFor(user);
  return { ...created, userId: user.id };
});

const mintFor = Effect.fn("mintMcpToken")(function* (user: Security.CurrentUser["Service"]) {
  const repo = yield* ApiTokensRepo.ApiTokensRepo;
  const token = yield* ApiTokenSecret.generate;
  const info = yield* repo
    .insertUser({
      id: ApiToken.ApiTokenId.make(crypto.randomUUID()),
      name: ApiToken.mcpTokenName,
      hash: yield* ApiTokenSecret.hash(token),
      createdAt: yield* DateTime.now,
    })
    .pipe(Effect.provideService(Security.CurrentUser, user));
  return { ...info, token } satisfies ApiToken.CreatedApiToken;
});
