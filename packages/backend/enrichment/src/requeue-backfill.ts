import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import type * as D1Database from "@stash/backend-platform/d1-database";
import * as Effect from "effect/Effect";
import * as EnrichPolicy from "./enrich-policy.ts";
import * as EnrichmentRepo from "./enrichment-repo.ts";

// The second step of the hourly requeue (#155). Links enriched before enrichment read preview
// images and authors have neither, and nothing would ever read them again. This step takes a few
// such links an hour and sends each through the queue with `task: "metadata"`, so the consumer
// only fills the missing fields (see `backfill-metadata.ts`).
//
// It is rate limited (`limit` links a run) and it ends. A finished backfill stamps the link with
// the current `EnrichPolicy.metadataVersion`, so each link is read once per version, whether or
// not its site had an image or an author. A link whose backfill keeps failing is sent at most
// `EnrichPolicy.maxRequeues` times, the same count and cap `requeue-pending.ts` uses, and on the
// last of them nothing is fetched. When no link is left, the step sends nothing.

export interface Options {
  /** At most this many links per run. `sendBatch` takes 100 messages. */
  readonly limit: number;
}

export const defaultOptions: Options = { limit: 25 };

/** Enqueues metadata backfills. Returns how many. */
export const requeueBackfill = (
  options: Options = defaultOptions,
): Effect.Effect<
  number,
  D1Database.DatabaseError | EnrichmentQueue.EnrichmentQueueError,
  EnrichmentRepo.EnrichmentRepo | EnrichmentQueue.EnrichmentQueue
> =>
  Effect.gen(function* () {
    const repo = yield* EnrichmentRepo.EnrichmentRepo;
    const queue = yield* EnrichmentQueue.EnrichmentQueue;
    const { maxRequeues } = yield* EnrichPolicy.EnrichPolicy;
    const ids = yield* repo.takeBackfill({
      metadataVersion: EnrichPolicy.metadataVersion,
      limit: options.limit,
      maxRequeues,
    });
    yield* queue.sendBatch(ids.map((linkId) => ({ linkId, task: "metadata" as const })));
    if (ids.length > 0) yield* Effect.log(`enrichment: queued ${ids.length} metadata backfills`);
    return ids.length;
  }).pipe(Effect.withSpan("requeueBackfill"));
