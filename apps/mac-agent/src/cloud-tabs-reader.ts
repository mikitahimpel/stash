/**
 * Reads the tabs that other Apple devices (the iPhone) sync to this Mac through iCloud Tabs.
 *
 * Safari keeps them in a SQLite database, `CloudTabs.db`. Its schema is private and undocumented,
 * so the reader only relies on the columns that public write-ups and scripts query:
 *
 * - `cloud_tab_devices`: `device_uuid` (TEXT, primary key), `device_name` (TEXT)
 * - `cloud_tabs`: `device_uuid` (TEXT, joins `cloud_tab_devices`), `title` (TEXT), `url` (TEXT)
 *
 * Other columns (`tab_uuid`, `system_fields`, `position`, `is_pinned`, …) are ignored. The tables
 * carry no per-tab timestamps, so `openedAt` is `null` and `lastSeenAt` is the time of the read.
 *
 * The database is opened read-only with Node's built-in `node:sqlite`: Node >= 24 is already
 * required, and a built-in driver needs no native build or prebuilt binaries (better-sqlite3 does).
 */
import * as Link from "@stash/contracts-domain/link";
import * as Tab from "@stash/contracts-domain/tab";
import { Config, Context, DateTime, Effect, Layer, Schema } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Where Safari keeps the database. Reading it needs Full Disk Access. */
export const defaultPath = (home: string): string =>
  join(home, "Library/Containers/com.apple.Safari/Data/Library/Safari/CloudTabs.db");

/** Env var that overrides {@link defaultPath}. */
export const pathEnvVar = "STASH_CLOUD_TABS_DB";

export class CloudTabsReadError extends Schema.TaggedError<CloudTabsReadError>()(
  "CloudTabsReadError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * The tabs of one iCloud device. `snapshot.deviceId` is the iCloud `device_uuid`, not a Stash
 * device id; the poster maps it to the Stash device it registered for this iCloud device.
 */
export interface CloudDevice {
  readonly name: string | null;
  readonly snapshot: Tab.TabsSnapshot;
}

export class CloudTabsReader extends Context.Service<
  CloudTabsReader,
  {
    /** One entry per iCloud device, including devices with no open tabs. */
    readonly read: Effect.Effect<ReadonlyArray<CloudDevice>, CloudTabsReadError>;
  }
>()("@stash/mac-agent/CloudTabsReader") {}

const DeviceRow = Schema.Struct({
  device_uuid: Schema.String,
  device_name: Schema.NullOr(Schema.String),
});

const TabRow = Schema.Struct({
  device_uuid: Schema.String,
  title: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
});

const Rows = Schema.Struct({
  devices: Schema.Array(DeviceRow),
  tabs: Schema.Array(TabRow),
});

const decodeRows = Schema.decodeUnknownEffect(Rows);
const decodeSnapshot = Schema.decodeUnknownEffect(Tab.TabsSnapshot);
const isUrl = Schema.is(Link.Url);

const query = (path: string) =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => new DatabaseSync(path, { readOnly: true }),
      catch: (error) => new CloudTabsReadError({ path, message: String(error) }),
    }),
    (db) =>
      Effect.try({
        try: () => ({
          devices: db.prepare("SELECT device_uuid, device_name FROM cloud_tab_devices").all(),
          tabs: db.prepare("SELECT device_uuid, title, url FROM cloud_tabs").all(),
        }),
        catch: (error) => new CloudTabsReadError({ path, message: String(error) }),
      }),
    (db) => Effect.sync(() => db.close()),
  );

export const make = (path: string): CloudTabsReader["Service"] => ({
  read: Effect.gen(function* () {
    const rows = yield* query(path).pipe(
      Effect.flatMap(decodeRows),
      Effect.mapError((error) =>
        error instanceof CloudTabsReadError
          ? error
          : new CloudTabsReadError({ path, message: `Unexpected CloudTabs.db rows: ${error}` }),
      ),
    );
    const takenAt = DateTime.formatIso(yield* DateTime.now);

    const names = new Map<string, string | null>();
    for (const device of rows.devices) names.set(device.device_uuid, device.device_name || null);
    // Tabs whose device row is missing still count, just without a name.
    for (const tab of rows.tabs) if (!names.has(tab.device_uuid)) names.set(tab.device_uuid, null);

    return yield* Effect.forEach(names, ([uuid, name]) =>
      decodeSnapshot({
        deviceId: uuid,
        takenAt,
        tabs: rows.tabs
          // Skip tabs Stash can't store (`about:blank`, `file:`, …) instead of failing the device.
          .filter((tab) => tab.device_uuid === uuid && isUrl(tab.url))
          .map((tab) => ({
            url: tab.url,
            title: tab.title || null,
            openedAt: null,
            lastSeenAt: takenAt,
          })),
      }).pipe(
        Effect.map((snapshot): CloudDevice => ({ name, snapshot })),
        Effect.mapError(
          (error) => new CloudTabsReadError({ path, message: `Invalid tabs of ${uuid}: ${error}` }),
        ),
      ),
    );
  }),
});

export const layer = (path: string): Layer.Layer<CloudTabsReader> =>
  Layer.succeed(CloudTabsReader, make(path));

/** Reads the path from {@link pathEnvVar}, falling back to {@link defaultPath}. */
export const layerConfig: Layer.Layer<CloudTabsReader, Config.ConfigError> = Layer.effect(
  CloudTabsReader,
  Effect.gen(function* () {
    const path = yield* Config.String(pathEnvVar).pipe(Config.withDefault(defaultPath(homedir())));
    return make(path);
  }),
);
