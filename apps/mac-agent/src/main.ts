/**
 * The mac-agent process: whenever Safari writes its iCloud Tabs database (watched, debounced), read
 * the iCloud tabs and post the changed snapshots. A slow poll is the fallback for a missed or
 * failed watch.
 *
 * Env:
 * - `STASH_API_URL`: base URL of the Stash API.
 * - `STASH_DEVICE_TOKEN`: the API token of this agent's device, a `pass://` reference resolved by
 *   `pp run`. Never commit it.
 * - `STASH_POLL_INTERVAL`: time between runs without a database write, for example `15 minutes`
 *   (the default).
 * - `STASH_CLOUD_TABS_DB`, `STASH_STATE_FILE`: optional path overrides, see `cloud-tabs-reader.ts`
 *   and `device-map.ts`.
 *
 * A failed run is logged and the loop keeps going; the next run retries.
 */
import { NodeFileSystem, NodeHttpClient, NodeRuntime } from "@effect/platform-node";
import { Config, Duration, Effect, Layer, Stream } from "effect";
import * as CloudTabsReader from "./cloud-tabs-reader.ts";
import * as CloudTabsWatcher from "./cloud-tabs-watcher.ts";
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

/** How long the database must be quiet after a write before the agent reads it. */
export const defaultDebounce: Duration.Input = "2 seconds";

/**
 * Runs {@link tick} now, then after every burst of `changes` (once they pause for `debounce`) and
 * once per `interval`, forever, one run at a time.
 */
export const loop = (
  interval: Duration.Input,
  changes: Stream.Stream<void> = Stream.empty,
  debounce: Duration.Input = defaultDebounce,
) =>
  Stream.mergeAll(
    [
      Stream.make(undefined),
      Stream.tick(interval).pipe(Stream.drop(1)),
      changes.pipe(Stream.debounce(debounce)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Stream.runForEach(() => tick),
    Effect.andThen(Effect.never),
  );

/** {@link loop} on the database's own changes. */
export const watchLoop = (interval: Duration.Input) =>
  CloudTabsWatcher.CloudTabsWatcher.use((watcher) => loop(interval, watcher.changes));

const ApiConfig = Config.all({
  baseUrl: Config.String("STASH_API_URL"),
  deviceToken: Config.Redacted("STASH_DEVICE_TOKEN"),
});

const PollInterval = Config.Duration("STASH_POLL_INTERVAL").pipe(
  Config.withDefault(Duration.minutes(15)),
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
  return yield* watchLoop(interval);
});

if (import.meta.main) {
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        PosterLive,
        CloudTabsReader.layerConfig,
        CloudTabsWatcher.layerConfig.pipe(Layer.provide(NodeFileSystem.layer)),
      ),
    ),
    NodeRuntime.runMain,
  );
}
