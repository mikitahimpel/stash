import * as D1Database from "@stash/backend-platform/d1-database";
import * as Device from "@stash/contracts-domain/device";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The `devices` table. */
export class DevicesRepo extends Context.Service<
  DevicesRepo,
  {
    readonly findById: (
      id: Device.DeviceId,
    ) => Effect.Effect<Option.Option<Device.Device>, D1Database.DatabaseError>;
    /** Oldest first. */
    readonly list: Effect.Effect<ReadonlyArray<Device.Device>, D1Database.DatabaseError>;
    readonly insert: (device: Device.Device) => Effect.Effect<void, D1Database.DatabaseError>;
    /** What each device did last, oldest device first. */
    readonly activity: Effect.Effect<
      ReadonlyArray<Device.DeviceActivity>,
      D1Database.DatabaseError
    >;
  }
>()("@stash/backend-tabs/DevicesRepo") {}

const deviceColumns = "id, name, kind, created_at AS createdAt";

const ActivityRow = Schema.Struct({
  deviceId: Device.DeviceId,
  tokenUsedAt: Schema.NullOr(Schema.String),
  tabsTakenAt: Schema.NullOr(Schema.String),
  lastSaveAt: Schema.NullOr(Schema.String),
  linkId: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
});

// The latest of the device's token uses (`api_tokens.last_used_at`, written by the auth
// middleware), its tabs snapshot and its last save. A save whose link was deleted since still
// counts as contact, but has no link to show.
const activitySql = `SELECT d.id AS deviceId,
    (SELECT MAX(t.last_used_at) FROM api_tokens t WHERE t.device_id = d.id) AS tokenUsedAt,
    d.tabs_taken_at AS tabsTakenAt, d.last_save_at AS lastSaveAt,
    l.id AS linkId, l.url AS url, l.title AS title
  FROM devices d LEFT JOIN links l ON l.id = d.last_save_link_id
  ORDER BY d.created_at, d.rowid`;

const toActivity = (row: typeof ActivityRow.Type): Device.DeviceActivity => {
  // ISO 8601 UTC strings sort as text.
  const seen = [row.tokenUsedAt, row.tabsTakenAt, row.lastSaveAt]
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  return {
    deviceId: row.deviceId,
    lastSeenAt: seen === undefined ? null : DateTime.makeUnsafe(seen),
    lastSave:
      row.lastSaveAt === null || row.linkId === null || row.url === null
        ? null
        : {
            at: DateTime.makeUnsafe(row.lastSaveAt),
            linkId: row.linkId,
            url: row.url,
            title: row.title,
          },
  };
};

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return DevicesRepo.of({
    findById: (id) =>
      D1Database.queryFirst(Device.Device)(
        D1Database.statement(`SELECT ${deviceColumns} FROM devices WHERE id = ?`, id),
      ).pipe(provide),
    list: D1Database.query(Device.Device)(
      D1Database.statement(`SELECT ${deviceColumns} FROM devices ORDER BY created_at, rowid`),
    ).pipe(provide),
    activity: D1Database.query(ActivityRow)(D1Database.statement(activitySql)).pipe(
      provide,
      Effect.map((rows) => rows.map(toActivity)),
    ),
    insert: (device) =>
      db
        .run(
          D1Database.sql`INSERT INTO devices (id, name, kind, created_at)
            VALUES (${device.id}, ${device.name}, ${device.kind}, ${DateTime.formatIso(device.createdAt)})`,
        )
        .pipe(Effect.asVoid),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<DevicesRepo, never, D1Database.Database> =
  Layer.effect(DevicesRepo)(make);
