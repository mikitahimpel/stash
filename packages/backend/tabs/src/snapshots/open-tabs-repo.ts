import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import type * as TabsApi from "@stash/contracts-api/tabs";
import * as Device from "@stash/contracts-domain/device";
import * as Tab from "@stash/contracts-domain/tab";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

// The `open_tabs` table and `devices.tabs_taken_at`. The tabs of a snapshot travel as one JSON
// parameter read with `json_each`, so a snapshot of any size is a fixed number of statements.

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
     * Every tab's `last_seen_at` becomes `takenAt`.
     */
    readonly replace: (
      deviceId: Device.DeviceId,
      takenAt: DateTime.Utc,
      tabs: ReadonlyArray<Tab.OpenTab>,
    ) => Effect.Effect<void, D1Database.DatabaseError, Security.CurrentUser>;
    /** Every device, oldest first, with its snapshot (`null` if it never reported one). */
    readonly listAll: Effect.Effect<
      ReadonlyArray<TabsApi.DeviceTabs>,
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
  ...Tab.OpenTab.fields,
  deviceId: Device.DeviceId,
});

const toOpenTab = ({ url, title, openedAt, lastSeenAt }: typeof TabRow.Type): Tab.OpenTab => ({
  url,
  title,
  openedAt,
  lastSeenAt,
});

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
          openedAt: tab.openedAt === null ? null : DateTime.formatIso(tab.openedAt),
        })),
      );
      // The new rows are inserted before the old ones are deleted, so `opened_at` can be read
      // from the old rows. An `INTEGER PRIMARY KEY` gets max(id) + 1, so inside the transaction
      // the device's newest `tabs.length` rows are exactly the new ones.
      // Every statement names the user, and the insert writes nothing unless the device is theirs.
      yield* db.batch([
        D1Database.statement(
          `INSERT INTO open_tabs (device_id, user_id, url, title, opened_at, last_seen_at)
            SELECT ?1, ?4, json_extract(t.value, '$.url'), json_extract(t.value, '$.title'),
              COALESCE(
                (SELECT MIN(o.opened_at) FROM open_tabs o
                  WHERE o.device_id = ?1 AND o.user_id = ?4
                    AND o.url = json_extract(t.value, '$.url')),
                json_extract(t.value, '$.openedAt'),
                ?2
              ),
              ?2
            FROM json_each(?3) AS t
            WHERE EXISTS (SELECT 1 FROM devices d WHERE d.id = ?1 AND d.user_id = ?4)
            ORDER BY t.key`,
          deviceId,
          taken,
          rows,
          user.id,
        ),
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
    }),
    listAll: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      const devices = yield* D1Database.query(DeviceRow)(
        D1Database.statement(
          `SELECT id, name, kind, created_at AS createdAt, tabs_taken_at AS tabsTakenAt
            FROM devices WHERE user_id = ? ORDER BY created_at, rowid`,
          user.id,
        ),
      );
      const tabs = yield* D1Database.query(TabRow)(
        D1Database.statement(
          `SELECT device_id AS deviceId, url, title, opened_at AS openedAt,
            last_seen_at AS lastSeenAt
            FROM open_tabs WHERE user_id = ? ORDER BY id`,
          user.id,
        ),
      );
      const byDevice = Map.groupBy(tabs, (tab) => tab.deviceId);
      return devices.map(({ tabsTakenAt, ...device }): TabsApi.DeviceTabs => ({
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
    }).pipe(provide),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<OpenTabsRepo, never, D1Database.Database> =
  Layer.effect(OpenTabsRepo)(make);
