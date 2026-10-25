import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as SessionToken from "./session-token.ts";
import * as SessionsRepo from "./sessions-repo.ts";

/** Deletes the session of a cookie value. Unknown sessions are ignored. */
export const endSession = Effect.fn("endSession")(function* (token: Redacted.Redacted<string>) {
  const repo = yield* SessionsRepo.SessionsRepo;
  yield* repo.remove(yield* SessionToken.hash(token));
});
