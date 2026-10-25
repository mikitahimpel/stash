import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Runs the jobs for one cron trigger. The digest feature provides the real layer. */
export class ScheduledJobs extends Context.Service<
  ScheduledJobs,
  { readonly run: (cron: string) => Effect.Effect<void, unknown> }
>()("@stash/api/ScheduledJobs") {}

/** Logs the trigger and does nothing else, until the digest jobs land. */
export const layerNoop: Layer.Layer<ScheduledJobs> = Layer.succeed(ScheduledJobs)({
  run: (cron) => Effect.log(`scheduled: ${cron} has no jobs yet`),
});

export const handleScheduled = (cron: string): Effect.Effect<void, unknown, ScheduledJobs> =>
  ScheduledJobs.use((jobs) => jobs.run(cron));
