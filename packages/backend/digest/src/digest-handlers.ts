import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import type * as DigestsRepo from "./digests-repo.ts";
import * as GetLatestDigest from "./get-latest-digest.ts";

// Database failures are defects here: the endpoint declares no error for them, so they answer 500.

/** The `digest` group of the `StashApi`. Needs `DigestsRepo` and the `Authorization` middleware. */
export const layer = HttpApiBuilder.group(Api.StashApi, "digest", (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<DigestsRepo.DigestsRepo>();
    return handlers.handle("latest", () =>
      GetLatestDigest.getLatestDigest.pipe(
        Effect.provideContext(context),
        Effect.catchTag("DatabaseError", Effect.die),
      ),
    );
  }),
);
