import * as AutoArchiveTabs from "@stash/backend-digest/auto-archive-tabs";
import * as BuildWeeklyDigest from "@stash/backend-digest/build-weekly-digest";
import type * as DigestsRepo from "@stash/backend-digest/digests-repo";
import type * as LinksRepo from "@stash/backend-links/links-repo";
import type * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import type * as StashConfig from "@stash/backend-platform/stash-config";
import type * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import type * as DevicesRepo from "@stash/backend-tabs/devices-repo";
import type * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The Cron Triggers of the `Api` Worker. Keep them in sync with `crons` in the root
// `alchemy.run.ts`. Cron expressions are in UTC.

/** Every day at 03:00: archive and close stale Zen tabs. */
export const autoArchiveCron = "0 3 * * *";
/** Every Monday at 06:00: the digest of the week that ended at midnight. */
export const weeklyDigestCron = "0 6 * * 1";

/** Runs the jobs for one cron trigger. */
export class ScheduledJobs extends Context.Service<
  ScheduledJobs,
  { readonly run: (cron: string) => Effect.Effect<void, unknown> }
>()("@stash/api/ScheduledJobs") {}

/** Logs the trigger and does nothing else. */
export const layerNoop: Layer.Layer<ScheduledJobs> = Layer.succeed(ScheduledJobs)({
  run: (cron) => Effect.log(`scheduled: ${cron} has no jobs`),
});

/** The services the digest jobs need. */
export type Requirements =
  | StashConfig.StashConfig
  | OpenTabsRepo.OpenTabsRepo
  | CommandsRepo.CommandsRepo
  | DevicesRepo.DevicesRepo
  | LinksRepo.LinksRepo
  | EnrichmentQueue.EnrichmentQueue
  | DigestsRepo.DigestsRepo;

const jobs: Record<string, Effect.Effect<unknown, unknown, Requirements>> = {
  [autoArchiveCron]: AutoArchiveTabs.autoArchiveTabs(),
  [weeklyDigestCron]: BuildWeeklyDigest.buildWeeklyDigest(),
};

/** Dispatches each trigger to its job by cron expression. An unknown expression only logs. */
export const layer: Layer.Layer<ScheduledJobs, never, Requirements> = Layer.effect(ScheduledJobs)(
  Effect.gen(function* () {
    const context = yield* Effect.context<Requirements>();
    return {
      run: (cron) => {
        const job = jobs[cron];
        return job === undefined
          ? Effect.logWarning(`scheduled: no job for cron ${cron}`)
          : Effect.log(`scheduled: ${cron}`).pipe(
              Effect.andThen(job),
              Effect.asVoid,
              Effect.provideContext(context),
            );
      },
    };
  }),
);

export const handleScheduled = (cron: string): Effect.Effect<void, unknown, ScheduledJobs> =>
  ScheduledJobs.use((jobs) => jobs.run(cron));
