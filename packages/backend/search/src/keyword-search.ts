import type * as D1Database from "@stash/backend-platform/d1-database";
import * as Effect from "effect/Effect";
import * as SearchRepo from "./search-repo.ts";

/**
 * Turns free text into a safe FTS5 query: each word becomes a quoted prefix term (`"econ"*`), and
 * terms are OR-ed so bm25 ranks links matching more of them higher. User input never reaches FTS5
 * as syntax. Empty when the text has no words.
 */
export const toFtsQuery = (text: string): string =>
  (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map((word) => `"${word}"*`).join(" OR ");

/** Links whose title, summary or text match the words of `q`, best first by bm25. */
export const keywordSearch = (
  q: string,
  filters: SearchRepo.SearchFilters,
  limit: number,
): Effect.Effect<
  ReadonlyArray<SearchRepo.RankedLink>,
  D1Database.DatabaseError,
  SearchRepo.SearchRepo
> => {
  const match = toFtsQuery(q);
  return match === ""
    ? Effect.succeed([])
    : SearchRepo.SearchRepo.use((repo) => repo.keyword(match, filters, limit)).pipe(
        Effect.withSpan("keywordSearch"),
      );
};
