import * as Ai from "@stash/backend-platform/ai";
import type * as D1Database from "@stash/backend-platform/d1-database";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Security from "@stash/contracts-api/security";
import type * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as SearchRepo from "./search-repo.ts";

/**
 * How many nearest vectors to fetch. Vectorize caps `topK` at 20 when it returns metadata, which
 * the `Vectors` service always asks for.
 */
export const candidates = 20;

/**
 * The current user's links whose embedding is closest to the embedding of `q`, by cosine
 * similarity. Vectors are keyed by link id and carry their user (`Vectors.userIdKey`): the index
 * is asked only for this user's vectors, and D1 checks the answer again (`filterIds`), so a vector
 * can never surface another user's link. Filters apply in D1 to the nearest `candidates`, because tags and status change after
 * a link is embedded; ids with no link (stale vectors) are dropped. Vectorize always answers its
 * `topK` nearest, however far, so matches with no positive similarity are dropped too.
 */
export const semanticSearch = (
  q: string,
  filters: SearchRepo.SearchFilters,
  limit: number,
): Effect.Effect<
  ReadonlyArray<SearchRepo.RankedLink>,
  D1Database.DatabaseError | Ai.AiError | Vectors.VectorsError,
  SearchRepo.SearchRepo | Ai.Ai | Vectors.Vectors | Security.CurrentUser
> =>
  Effect.gen(function* () {
    const user = yield* Security.CurrentUser;
    const [embedding] = yield* Ai.Ai.use((ai) => ai.embed([q]));
    if (embedding === undefined) return [];
    const matches = yield* Vectors.Vectors.use((vectors) =>
      vectors.query(embedding, { topK: candidates, filter: { [Vectors.userIdKey]: user.id } }),
    );
    const kept = yield* SearchRepo.SearchRepo.use((repo) =>
      repo.filterIds(
        matches.map((match) => match.id),
        filters,
      ),
    );
    const byId = new Map<string, Link.LinkId>(kept.map((id) => [id, id]));
    return matches
      .flatMap((match) => {
        const linkId = byId.get(match.id);
        return linkId === undefined || match.score <= 0 ? [] : [{ linkId, score: match.score }];
      })
      .slice(0, limit);
  }).pipe(Effect.withSpan("semanticSearch"));
