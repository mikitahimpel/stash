/**
 * Tells when Safari wrote the iCloud Tabs database, so the agent posts a change at once instead
 * of on its next poll.
 *
 * It watches the database's directory (`fs.watch`, FSEvents on macOS) rather than the file:
 * SQLite writes the `-wal` and `-shm` files beside it, and Safari may replace the file itself,
 * which would end a watch on the old one. Only events for `CloudTabs.db` and its companions
 * count. A watch that fails (the directory is unreadable without Full Disk Access) logs once and
 * ends the stream; the slow poll in `main.ts` goes on.
 */
import { Config, Context, Effect, FileSystem, Layer, Stream } from "effect";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import * as CloudTabsReader from "./cloud-tabs-reader.ts";

export class CloudTabsWatcher extends Context.Service<
  CloudTabsWatcher,
  {
    /** One element per write to the database. Bursts are not coalesced. */
    readonly changes: Stream.Stream<void>;
  }
>()("@stash/mac-agent/CloudTabsWatcher") {}

/** Whether a file of the watched directory is the database or one of SQLite's files for it. */
export const isDatabaseFile = (dbPath: string, path: string): boolean =>
  basename(path).startsWith(basename(dbPath));

export const make = (dbPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return CloudTabsWatcher.of({
      changes: fs.watch(dirname(dbPath)).pipe(
        Stream.filter((event) => isDatabaseFile(dbPath, event.path)),
        Stream.as(undefined),
        Stream.catchCause((cause) =>
          Stream.fromEffect(
            Effect.logWarning("Watching iCloud Tabs failed; polling only", cause),
          ).pipe(Stream.drain),
        ),
      ),
    });
  });

export const layer = (
  dbPath: string,
): Layer.Layer<CloudTabsWatcher, never, FileSystem.FileSystem> =>
  Layer.effect(CloudTabsWatcher, make(dbPath));

/** Watches the path from `STASH_CLOUD_TABS_DB`, as the reader reads it. */
export const layerConfig: Layer.Layer<CloudTabsWatcher, Config.ConfigError, FileSystem.FileSystem> =
  Layer.effect(
    CloudTabsWatcher,
    Effect.gen(function* () {
      const path = yield* Config.String(CloudTabsReader.pathEnvVar).pipe(
        Config.withDefault(CloudTabsReader.defaultPath(homedir())),
      );
      return yield* make(path);
    }),
  );
