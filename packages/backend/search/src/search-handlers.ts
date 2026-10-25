import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as SearchService from "./search-service.ts";

// Search failures are defects here: the endpoint declares no error for them, so they answer 500.
// Hybrid search already falls back to keyword results when the semantic side fails.

/** The `search` group of the `StashApi`. Needs `SearchService` and the `Authorization` middleware. */
export const layer = HttpApiBuilder.group(Api.StashApi, "search", (handlers) =>
  Effect.gen(function* () {
    const service = yield* SearchService.SearchService;
    return handlers.handle("search", ({ query: { q, mode, ...filters } }) =>
      service.search(mode === undefined ? { q, filters } : { q, mode, filters }).pipe(Effect.orDie),
    );
  }),
);
