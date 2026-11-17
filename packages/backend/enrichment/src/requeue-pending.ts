import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import type * as D1Database from "@stash/backend-platform/d1-database";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as EnrichPolicy from "./enrich-policy.ts";
import * as EnrichmentRepo from "./enrichment-repo.ts";

// The safety net of the enrichment queue. A link is pending while it is neither enriched nor
// marked failed. Normally its message is on the queue, but a message can be lost (it ran out of
// deliveries during an outage), and a migration can put links back into the pending state to have
// them enriched again (`0006-link-image-and-repair.sql` does). This step, run by a cron, sends a
// message for each such link. Enrichment is idempotent, so a duplicate message is skipped.
//
// It does not go on forever. Each send is counted on the link, and a link is sent at most
// `EnrichPolicy.maxRequeues` times. On the last one `enrichLink` does not fetch the content, so a
// dead site or a blocked oEmbed cannot fail it: the link is classified from its URL and title and
// is done. A link that fails even then (the classifier or the storage is down) is left pending
// and is not sent again.

export interface Options {
  /** Links saved more recently are left alone: their first message is still on its way. */
  readonly minAge: Duration.Input;
  /** At most this many links per run. `sendBatch` takes 100 messages. */
  readonly limit: number;
}

export const defaultOptions: Options = { minAge: "15 minutes", limit: 100 };

/** Enqueues pending links again. Returns how many. */
export const requeuePending = (
  options: Options = defaultOptions,
): Effect.Effect<
  number,
  D1Database.DatabaseError | EnrichmentQueue.EnrichmentQueueError,
  EnrichmentRepo.EnrichmentRepo | EnrichmentQueue.EnrichmentQueue
> =>
  Effect.gen(function* () {
    const repo = yield* EnrichmentRepo.EnrichmentRepo;
    const queue = yield* EnrichmentQueue.EnrichmentQueue;
    const now = yield* DateTime.now;
    const before = DateTime.formatIso(DateTime.subtractDuration(now, options.minAge));
    const { maxRequeues } = yield* EnrichPolicy.EnrichPolicy;
    const ids = yield* repo.takePending({ before, limit: options.limit, maxRequeues });
    yield* queue.sendBatch(ids.map((linkId) => ({ linkId })));
    if (ids.length > 0) yield* Effect.log(`enrichment: requeued ${ids.length} pending links`);
    return ids.length;
  }).pipe(Effect.withSpan("requeuePending"));
