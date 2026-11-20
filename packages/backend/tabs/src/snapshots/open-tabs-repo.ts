import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tab from "@stash/contracts-domain/tab";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `open_tabs` table and `devices.tabs_taken_at`. The tabs of a snapshot travel as one JSON
// parameter read with `json_each`, so a snapshot of any size is a fixed number of statements.

/** A device with its snapshot, before the saved tabs are looked up. */
export interface DeviceSnapshot {
  readonly device: Device.Device;
  readonly snapshot: Tab.TabsSnapshot | null;
}

/**
 * The `open_tabs` rows of each of the current user's devices (`CurrentUser`), with the time of
 * its snapshot. A device of another user is never read or written.
 */
export class OpenTabsRepo extends Context.Service<
  OpenTabsRepo,
  {
    /**
     * Replaces the device's tabs in one transaction. A URL that was already open keeps its
     * earliest `opened_at`. A new one takes the reported `openedAt`, or `takenAt` if there is none.
     * Every tab's `last_seen_at` becomes `takenAt`. Answers the snapshot as it is stored now
     * (as `listAll` reads it), from the written rows, with no read of its own.
     */
    readonly replace: (
      deviceId: Device.DeviceId,
      takenAt: DateTime.Utc,
      tabs: ReadonlyArray<Tab.OpenTab>,
    ) => Effect.Effect<Tab.TabsSnapshot, D1Database.DatabaseError, Security.CurrentUser>;
    /** Every device, oldest first, with its snapshot (`null` if it never reported one). */
    readonly listAll: Effect.Effect<
      ReadonlyArray<DeviceSnapshot>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
    /**
     * Counts one report of the device in a fixed window of `windowMillis` that starts at the
     * first report after the previous window ended, and answers how many reports the window
     * has now and when it ends (epoch ms).
     */
    readonly countReport: (
      deviceId: Device.DeviceId,
      nowMillis: number,
      windowMillis: number,
    ) => Effect.Effect<
      { readonly count: number; readonly endsAt: number },
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
  }
>()("@stash/backend-tabs/OpenTabsRepo") {}

const DeviceRow = Schema.Struct({
  ...Device.Device.fields,
  tabsTakenAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});

const TabRow = Schema.Struct({
  deviceId: Device.DeviceId,
  url: Link.Url,
  title: Schema.NullOr(Schema.String),
  openedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastSeenAt: Schema.DateTimeUtcFromString,
  lastActiveAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  windowId: Schema.NullOr(Schema.String),
  windowName: Schema.NullOr(Schema.String),
  faviconUrl: Schema.NullOr(Link.Url),
});

// The optional keys stay away when the device did not report them, as in the contract.
const toOpenTab = (row: typeof TabRow.Type): Tab.OpenTab => ({
  url: row.url,
  title: row.title,
  openedAt: row.openedAt,
  lastSeenAt: row.lastSeenAt,
  ...(row.lastActiveAt === null ? {} : { lastActiveAt: row.lastActiveAt }),
  ...(row.windowId === null
    ? {}
    : {
        window: {
          id: row.windowId,
          ...(row.windowName === null ? {} : { name: row.windowName }),
        },
      }),
  ...(row.faviconUrl === null ? {} : { faviconUrl: row.faviconUrl }),
});

// RETURNING gives the rows in no set order, so they carry their id to be put in tab-strip order.
const InsertedTabRow = Schema.Struct({ ...TabRow.fields, id: Schema.Number });

const CountRow = Schema.Struct({ count: Schema.Number, start: Schema.Number });

const deviceColumns = `id, name, kind, created_at AS createdAt, tabs_taken_at AS tabsTakenAt`;
const tabColumns = `device_id AS deviceId, url, title, opened_at AS openedAt,
  last_seen_at AS lastSeenAt, last_active_at AS lastActiveAt, window_id AS windowId,
  window_name AS windowName, favicon_url AS faviconUrl`;

const withTabs = (
  devices: ReadonlyArray<typeof DeviceRow.Type>,
  tabs: ReadonlyArray<typeof TabRow.Type>,
): ReadonlyArray<DeviceSnapshot> => {
  const byDevice = Map.groupBy(tabs, (tab) => tab.deviceId);
  return devices.map(({ tabsTakenAt, ...device }) => ({
    device,
    snapshot:
      tabsTakenAt === null
        ? null
        : {
            deviceId: device.id,
            takenAt: tabsTakenAt,
            tabs: (byDevice.get(device.id) ?? []).map(toOpenTab),
          },
  }));
};

const iso = (value: DateTime.Utc | undefined | null) =>
  value === undefined || value === null ? null : DateTime.formatIso(value);

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);

  return OpenTabsRepo.of({
    replace: Effect.fnUntraced(function* (deviceId, takenAt, tabs) {
      const user = yield* Security.CurrentUser;
      const taken = DateTime.formatIso(takenAt);
      const rows = JSON.stringify(
        tabs.map((tab) => ({
          url: tab.url,
          title: tab.title,
          openedAt: iso(tab.openedAt),
          lastActiveAt: iso(tab.lastActiveAt),
          windowId: tab.window?.id ?? null,
          windowName: tab.window?.name ?? null,
          faviconUrl: tab.faviconUrl ?? null,
        })),
      );
      // The new rows are inserted before the old ones are deleted, so `opened_at` can be read
      // from the old rows. An `INTEGER PRIMARY KEY` gets max(id) + 1, so inside the transaction
      // the device's newest `tabs.length` rows are exactly the new ones.
      // Every statement names the user, and the insert writes nothing unless the device is theirs.
      const insert = D1Database.statement(
        `INSERT INTO open_tabs (device_id, user_id, url, title, opened_at, last_seen_at,
              last_active_at, window_id, window_name, favicon_url)
            SELECT ?1, ?4, json_extract(t.value, '$.url'), json_extract(t.value, '$.title'),
              COALESCE(
                (SELECT MIN(o.opened_at) FROM open_tabs o
                  WHERE o.device_id = ?1 AND o.user_id = ?4
                    AND o.url = json_extract(t.value, '$.url')),
                json_extract(t.value, '$.openedAt'),
                ?2
              ),
              ?2,
              json_extract(t.value, '$.lastActiveAt'),
              json_extract(t.value, '$.windowId'),
              json_extract(t.value, '$.windowName'),
              json_extract(t.value, '$.faviconUrl')
            FROM json_each(?3) AS t
            WHERE EXISTS (SELECT 1 FROM devices d WHERE d.id = ?1 AND d.user_id = ?4)
            ORDER BY t.key
            RETURNING id, ${tabColumns}`,
        deviceId,
        taken,
        rows,
        user.id,
      );
      const [inserted] = yield* db.batch([
        insert,
        D1Database.statement(
          `DELETE FROM open_tabs WHERE device_id = ?1 AND user_id = ?3 AND id NOT IN (
            SELECT id FROM open_tabs WHERE device_id = ?1 AND user_id = ?3
              ORDER BY id DESC LIMIT ?2)`,
          deviceId,
          tabs.length,
          user.id,
        ),
        D1Database.sql`UPDATE devices SET tabs_taken_at = ${taken}
          WHERE id = ${deviceId} AND user_id = ${user.id}`,
      ]);
      const written = yield* D1Database.decodeReturned(
        InsertedTabRow,
        insert,
      )(inserted!).pipe(provide);
      return {
        deviceId,
        takenAt,
        tabs: [...written].sort((a, b) => a.id - b.id).map(toOpenTab),
      };
    }),
    listAll: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      const devices = yield* D1Database.query(DeviceRow)(
        D1Database.statement(
          `SELECT ${deviceColumns} FROM devices WHERE user_id = ? ORDER BY created_at, rowid`,
          user.id,
        ),
      );
      const tabs = yield* D1Database.query(TabRow)(
        D1Database.statement(
          `SELECT ${tabColumns} FROM open_tabs WHERE user_id = ? ORDER BY id`,
          user.id,
        ),
      );
      return withTabs(devices, tabs);
    }).pipe(provide),
    countReport: Effect.fnUntraced(function* (deviceId, nowMillis, windowMillis) {
      const user = yield* Security.CurrentUser;
      return yield* D1Database.queryFirst(CountRow)(
        D1Database.statement(
          `UPDATE devices SET
              tabs_window_count = CASE
                WHEN tabs_window_start IS NULL OR tabs_window_start + ?2 <= ?1 THEN 1
                ELSE tabs_window_count + 1 END,
              tabs_window_start = CASE
                WHEN tabs_window_start IS NULL OR tabs_window_start + ?2 <= ?1 THEN ?1
                ELSE tabs_window_start END
            WHERE id = ?3 AND user_id = ?4
            RETURNING tabs_window_count AS count, tabs_window_start AS start`,
          nowMillis,
          windowMillis,
          deviceId,
          user.id,
        ),
      ).pipe(
        Effect.map(
          Option.match({
            onNone: () => ({ count: 0, endsAt: nowMillis + windowMillis }),
            onSome: ({ count, start }) => ({ count, endsAt: start + windowMillis }),
          }),
        ),
        provide,
      );
    }),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<OpenTabsRepo, never, D1Database.Database> =
  Layer.effect(OpenTabsRepo)(make);
