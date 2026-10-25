import type * as Ai from "@stash/backend-platform/ai";
import type * as D1Database from "@stash/backend-platform/d1-database";
import type * as Vectors from "@stash/backend-platform/vectors";
import * as Effect from "effect/Effect";
import * as KeywordSearch from "./keyword-search.ts";
import type * as SearchRepo from "./search-repo.ts";
import * as SemanticSearch from "./semantic-search.ts";

/** The usual reciprocal rank fusion constant. It damps how much the very top ranks dominate. */
export const rrfK = 60;

/**
 * Reciprocal rank fusion: each link scores the sum of `1 / (k + rank)` over the rankings it appears
 * in (rank starts at 1). Raw scores are ignored, so bm25 and cosine need no normalizing. Ties break
 * by link id, so the order is deterministic.
 */
export const fuse = (
  rankings: ReadonlyArray<ReadonlyArray<SearchRepo.RankedLink>>,
  k: number = rrfK,
): ReadonlyArray<SearchRepo.RankedLink> => {
  const scores = new Map<SearchRepo.RankedLink["linkId"], number>();
  for (const ranking of rankings) {
    ranking.forEach(({ linkId }, index) => {
      scores.set(linkId, (scores.get(linkId) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores]
    .map(([linkId, score]) => ({ linkId, score }))
    .sort((a, b) => b.score - a.score || (a.linkId < b.linkId ? -1 : a.linkId > b.linkId ? 1 : 0));
};

/**
 * Keyword and semantic search fused with `fuse`. If the semantic side fails (Workers AI or
 * Vectorize unavailable), it logs a warning and answers with keyword results alone.
 */
export const hybridSearch = (
  q: string,
  filters: SearchRepo.SearchFilters,
  limit: number,
): Effect.Effect<
  ReadonlyArray<SearchRepo.RankedLink>,
  D1Database.DatabaseError,
  SearchRepo.SearchRepo | Ai.Ai | Vectors.Vectors
> =>
  Effect.all(
    [
      KeywordSearch.keywordSearch(q, filters, SemanticSearch.candidates),
      SemanticSearch.semanticSearch(q, filters, SemanticSearch.candidates).pipe(
        Effect.catchTags({
          AiError: (error) => fallback(error),
          VectorsError: (error) => fallback(error),
        }),
      ),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((rankings) => fuse(rankings).slice(0, limit)),
    Effect.withSpan("hybridSearch"),
  );

const fallback = (error: Ai.AiError | Vectors.VectorsError) =>
  Effect.logWarning("semantic search failed; answering with keyword results", error._tag).pipe(
    Effect.as<ReadonlyArray<SearchRepo.RankedLink>>([]),
  );
