import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as UsersRepo from "./users-repo.ts";

/**
 * Runs `job` once for every user, as that user (`CurrentUser`), one after another: how a cron
 * does per-user work, since every query needs a user. A user whose run fails is logged by id and
 * does not stop the others. Returns the results of the runs that succeeded.
 */
export const forEachUser = <A, E, R>(
  name: string,
  job: Effect.Effect<A, E, R>,
): Effect.Effect<ReadonlyArray<A>, never, Exclude<R, Security.CurrentUser> | UsersRepo.UsersRepo> =>
  Effect.gen(function* () {
    const repo = yield* UsersRepo.UsersRepo;
    const users = yield* repo.listAll.pipe(Effect.orDie);
    const results: Array<A> = [];
    for (const user of users) {
      yield* job.pipe(
        Effect.provideService(Security.CurrentUser, user),
        Effect.matchCauseEffect({
          onSuccess: (result) => Effect.sync(() => void results.push(result)),
          onFailure: (cause) => Effect.logError(`${name}: failed for user ${user.id}`, cause),
        }),
      );
    }
    return results;
  });
