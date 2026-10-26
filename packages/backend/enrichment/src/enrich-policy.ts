import * as Context from "effect/Context";
import * as Schedule from "effect/Schedule";

/**
 * How the classifier and the embedder retry. Override it with
 * `Effect.provideService(EnrichPolicy, ...)`; tests use a schedule without delays.
 */
export interface Policy {
  /** The delays between attempts. Only retryable failures are retried. */
  readonly retrySchedule: Schedule.Schedule<unknown, unknown>;
  /** Retries after the first attempt. */
  readonly retries: number;
}

export const defaultPolicy: Policy = {
  retrySchedule: Schedule.exponential("1 second").pipe(Schedule.jittered),
  retries: 2,
};

export const EnrichPolicy = Context.Reference<Policy>("@stash/backend-enrichment/EnrichPolicy", {
  defaultValue: () => defaultPolicy,
});
