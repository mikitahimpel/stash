import type * as Ai from "@stash/backend-platform/ai";
import type * as D1Database from "@stash/backend-platform/d1-database";
import type * as Vectors from "@stash/backend-platform/vectors";
import type * as SearchGroup from "@stash/contracts-api/search";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HybridSearch from "./hybrid-search.ts";
import * as KeywordSearch from "./keyword-search.ts";
import * as SearchRepo from "./search-repo.ts";
import * as SemanticSearch from "./semantic-search.ts";

/** How many hits a search returns unless the request says otherwise. */
export const defaultLimit = 20;

export interface SearchRequest {
  readonly q: string;
  /** Defaults to `hybrid`. */
  readonly mode?: SearchGroup.SearchMode;
  readonly filters?: SearchRepo.SearchFilters;
  /** Defaults to `defaultLimit`. */
  readonly limit?: number;
}

export type SearchError = D1Database.DatabaseError | Ai.AiError | Vectors.VectorsError;

/** Keyword (FTS5), semantic (Vectorize) and hybrid search over links. */
export class SearchService extends Context.Service<
  SearchService,
  {
    /** Hits best first. Scores compare only within one result. */
    readonly search: (
      request: SearchRequest,
    ) => Effect.Effect<SearchGroup.SearchResults, SearchError>;
  }
>()("@stash/backend-search/SearchService") {}

const rank = (
  { q, mode = "hybrid", filters = {} }: SearchRequest,
  limit: number,
): Effect.Effect<
  ReadonlyArray<SearchRepo.RankedLink>,
  SearchError,
  SearchRepo.SearchRepo | Ai.Ai | Vectors.Vectors
> => {
  switch (mode) {
    case "keyword":
      return KeywordSearch.keywordSearch(q, filters, limit);
    case "semantic":
      return SemanticSearch.semanticSearch(q, filters, limit);
    case "hybrid":
      return HybridSearch.hybridSearch(q, filters, limit);
    default:
      return mode satisfies never;
  }
};

export const make = Effect.gen(function* () {
  const context = yield* Effect.context<SearchRepo.SearchRepo | Ai.Ai | Vectors.Vectors>();
  return SearchService.of({
    search: (request) =>
      Effect.gen(function* () {
        const ranked = yield* rank(request, request.limit ?? defaultLimit);
        const links = yield* SearchRepo.SearchRepo.use((repo) =>
          repo.loadLinks(ranked.map(({ linkId }) => linkId)),
        );
        return {
          hits: ranked.flatMap(({ linkId, score }) => {
            const link = links.get(linkId);
            return link === undefined ? [] : [{ link, score }];
          }),
        };
      }).pipe(Effect.provideContext(context), Effect.withSpan("search")),
  });
});

/** The service over `SearchRepo`, Workers AI and Vectorize. */
export const layer: Layer.Layer<
  SearchService,
  never,
  SearchRepo.SearchRepo | Ai.Ai | Vectors.Vectors
> = Layer.effect(SearchService)(make);
