/**
 * The mac-agent process: every interval, read the iCloud tabs and post the changed snapshots.
 *
 * Env:
 * - `STASH_API_URL`: base URL of the Stash API.
 * - `STASH_DEVICE_TOKEN`: the API token of this agent's device, a `pass://` reference resolved by
 *   `pp run`. Never commit it.
 * - `STASH_POLL_INTERVAL`: time between runs, for example `5 minutes` (the default).
 * - `STASH_CLOUD_TABS_DB`, `STASH_STATE_FILE`: optional path overrides, see `cloud-tabs-reader.ts`
 *   and `device-map.ts`.
 *
 * A failed run is logged and the loop keeps going; the next run retries.
 */
import { NodeFileSystem, NodeHttpClient, NodeRuntime } from "@effect/platform-node";
import { Config, Duration, Effect, Layer, Schedule } from "effect";
import * as CloudTabsReader from "./cloud-tabs-reader.ts";
import * as DeviceMap from "./device-map.ts";
import * as PostSnapshots from "./post-snapshots.ts";

/** One run: read every iCloud device and post what changed. Never fails; errors are logged. */
export const tick = Effect.gen(function* () {
  const devices = yield* CloudTabsReader.CloudTabsReader.use((reader) => reader.read);
  const result = yield* PostSnapshots.SnapshotPoster.use((poster) => poster.post(devices));
  yield* Effect.logInfo("Posted iCloud tabs").pipe(
    Effect.annotateLogs({
      devices: devices.length,
      registered: result.registered.length,
      posted: result.posted.length,
      skipped: result.skipped.length,
    }),
  );
  return result;
}).pipe(
  Effect.tapCause((cause) => Effect.logError("Posting iCloud tabs failed", cause)),
  Effect.option,
);

/** Runs {@link tick} now and then once per `interval`, forever. */
export const loop = (interval: Duration.Input) =>
  tick.pipe(Effect.repeat(Schedule.spaced(interval)));

const ApiConfig = Config.all({
  baseUrl: Config.String("STASH_API_URL"),
  deviceToken: Config.Redacted("STASH_DEVICE_TOKEN"),
});

const PollInterval = Config.Duration("STASH_POLL_INTERVAL").pipe(
  Config.withDefault(Duration.minutes(5)),
);

const PosterLive = PostSnapshots.layer.pipe(
  Layer.provide(
    Layer.unwrap(Effect.map(ApiConfig, PostSnapshots.clientLayer)).pipe(
      Layer.provide(NodeHttpClient.layerUndici),
    ),
  ),
  Layer.provide(DeviceMap.layerConfig.pipe(Layer.provide(NodeFileSystem.layer))),
);

const program = Effect.gen(function* () {
  const interval = yield* PollInterval;
  yield* Effect.logInfo("mac-agent started").pipe(
    Effect.annotateLogs({ interval: Duration.format(interval) }),
  );
  return yield* loop(interval);
});

if (import.meta.main) {
  program.pipe(
    Effect.provide(Layer.mergeAll(PosterLive, CloudTabsReader.layerConfig)),
    NodeRuntime.runMain,
  );
}
