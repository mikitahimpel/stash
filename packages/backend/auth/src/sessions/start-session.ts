import type * as User from "@stash/contracts-domain/user";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as SessionToken from "./session-token.ts";
import * as SessionsRepo from "./sessions-repo.ts";

/** How long a web session lasts. The cookie's `Max-Age` matches it. */
export const sessionTtl = Duration.days(30);

/**
 * Creates a session for a user who just signed in with the GitHub login. The token is returned
 * once and never stored.
 */
export const startSession = Effect.fn("startSession")(function* (
  userId: User.UserId,
  githubLogin: string,
) {
  const repo = yield* SessionsRepo.SessionsRepo;
  const token = yield* SessionToken.generate;
  const createdAt = yield* DateTime.now;
  const expiresAt = DateTime.addDuration(createdAt, sessionTtl);
  yield* repo.insert({
    id: yield* SessionToken.hash(token),
    userId,
    githubLogin,
    createdAt,
    expiresAt,
  });
  return { token, expiresAt };
});
