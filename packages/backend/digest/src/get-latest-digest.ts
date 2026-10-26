import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as DigestsRepo from "./digests-repo.ts";

/** The latest digest, or `NotFound` until the first one is built. */
export const getLatestDigest = Effect.gen(function* () {
  const repo = yield* DigestsRepo.DigestsRepo;
  return yield* Option.match(yield* repo.latest, {
    onNone: () => Effect.fail(new Errors.NotFound({ resource: "digest", id: "latest" })),
    onSome: Effect.succeed,
  });
}).pipe(Effect.withSpan("getLatestDigest"));
