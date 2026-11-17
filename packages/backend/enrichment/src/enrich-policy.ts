import * as Context from "effect/Context";
import * as Schedule from "effect/Schedule";

/**
 * How the classifier and the embedder retry, and when enrichment stops trying. Override it with
 * `Effect.provideService(EnrichPolicy, ...)`; tests use a schedule without delays.
 */
export interface Policy {
  /** The delays between attempts. Only retryable failures are retried. */
  readonly retrySchedule: Schedule.Schedule<unknown, unknown>;
  /** Retries after the first attempt. */
  readonly retries: number;
  /**
   * How many times the hourly cron sends a pending link to the queue again (see
   * `requeue-pending.ts`). On the last of them the content is not fetched: the link is classified
   * from its URL and title, the path a 404 takes. After it the link is left alone.
   */
  readonly maxRequeues: number;
}

export const defaultPolicy: Policy = {
  retrySchedule: Schedule.exponential("1 second").pipe(Schedule.jittered),
  retries: 2,
  maxRequeues: 5,
};

export const EnrichPolicy = Context.Reference<Policy>("@stash/backend-enrichment/EnrichPolicy", {
  defaultValue: () => defaultPolicy,
});
