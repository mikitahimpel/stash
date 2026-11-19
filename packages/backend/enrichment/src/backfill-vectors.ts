import type * as D1Database from "@stash/backend-platform/d1-database";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as EnrichPolicy from "./enrich-policy.ts";
import * as EnrichmentRepo from "./enrichment-repo.ts";

// The third step of the hourly requeue (#177). Semantic search filters the index on the metadata
// `userId`, and the vectors stored before there were users have none. This step gives it to
// them: it reads a link's stored vector back from the index and writes the same values again with
// the user's id, then stamps `links.vector_version`. No model is called, so it costs no AI quota.
//
// It runs per user, takes at most `limit` links a run, and ends: a stamped link is not taken
// again. A link whose vector is missing from the index (it never got one) is stamped too, since
// there is nothing to write. The Vectorize metadata index on `userId` must exist before the first
// write (the `VectorsUserIndex` resource in `alchemy.run.ts`, created by the same deploy);
// Vectorize indexes a vector's metadata only when the vector is written after the index exists.
// A failure (Vectorize or D1 is down) stamps nothing for that chunk, and the next run redoes it.

export interface Options {
  /** At most this many links per user and run. */
  readonly limit: number;
  /** Vectors written and links stamped per round. */
  readonly chunkSize: number;
}

export const defaultOptions: Options = { limit: 1_000, chunkSize: 100 };

const chunks = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Writes the current user's id onto their links' vectors. Returns how many links it stamped. */
export const backfillVectors = (
  options: Options = defaultOptions,
): Effect.Effect<
  number,
  D1Database.DatabaseError | Vectors.VectorsError,
  EnrichmentRepo.EnrichmentRepo | Vectors.Vectors | Security.CurrentUser
> =>
  Effect.gen(function* () {
    const user = yield* Security.CurrentUser;
    const repo = yield* EnrichmentRepo.EnrichmentRepo;
    const vectors = yield* Vectors.Vectors;
    const ids = yield* repo.findVectorBackfill({
      vectorVersion: EnrichPolicy.vectorVersion,
      limit: options.limit,
    });
    for (const chunk of chunks(ids, options.chunkSize)) {
      const stored: Array<Vectors.Vector> = [];
      for (const part of chunks(chunk, Vectors.maxGetIds)) {
        stored.push(...(yield* vectors.getByIds(part)));
      }
      yield* vectors.upsert(
        stored.map((vector) => ({
          id: vector.id,
          values: vector.values,
          metadata: { ...vector.metadata, [Vectors.userIdKey]: user.id },
        })),
      );
      yield* repo.stampVectors(chunk, EnrichPolicy.vectorVersion);
    }
    if (ids.length > 0) {
      yield* Effect.log(`enrichment: wrote the user onto ${ids.length} vectors of ${user.id}`);
    }
    return ids.length;
  }).pipe(Effect.withSpan("backfillVectors"));
