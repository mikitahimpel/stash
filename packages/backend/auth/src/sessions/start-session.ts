import type * as User from "@stash/contracts-domain/user";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as SessionToken from "./session-token.ts";
import * as SessionsRepo from "./sessions-repo.ts";

/** How long a web session lasts. The cookie's `Max-Age` matches it. */
export const sessionTtl = Duration.days(30);

/** How a user just signed in. Only GitHub has a login to keep. */
export type Method =
  | { readonly method: "github"; readonly githubLogin: string }
  | { readonly method: "passkey" | "google" };

/**
 * Creates a session for a user who just signed in (with GitHub, a passkey or Google). The token is
 * returned once and never stored.
 */
export const startSession = Effect.fn("startSession")(function* (userId: User.UserId, how: Method) {
  const repo = yield* SessionsRepo.SessionsRepo;
  const token = yield* SessionToken.generate;
  const createdAt = yield* DateTime.now;
  const expiresAt = DateTime.addDuration(createdAt, sessionTtl);
  yield* repo.insert({
    id: yield* SessionToken.hash(token),
    userId,
    method: how.method,
    githubLogin: how.method === "github" ? how.githubLogin : "",
    createdAt,
    expiresAt,
  });
  return { token, expiresAt };
});
