import * as D1Database from "@stash/backend-platform/d1-database";
import * as Device from "@stash/contracts-domain/device";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";

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
  }
>()("@stash/backend-tabs/DevicesRepo") {}

const deviceColumns = "id, name, kind, created_at AS createdAt";

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
