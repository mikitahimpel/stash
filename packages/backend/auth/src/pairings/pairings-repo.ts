import * as D1Database from "@stash/backend-platform/d1-database";
import * as Device from "@stash/contracts-domain/device";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The `device_pairings` table: approved pairings the extension has not claimed yet. */
export class PairingsRepo extends Context.Service<
  PairingsRepo,
  {
    /** Stores the approval. `false` if this code was already approved (the row exists). */
    readonly insert: (pairing: {
      readonly codeHash: string;
      readonly deviceId: Device.DeviceId;
      readonly expiresAt: DateTime.Utc;
    }) => Effect.Effect<boolean, D1Database.DatabaseError>;
    /**
     * Deletes the approval and returns its device, if it exists and has not lapsed by `now`. One
     * statement, so two claims of the same code never both get a device.
     */
    readonly take: (
      codeHash: string,
      now: DateTime.Utc,
    ) => Effect.Effect<Option.Option<Device.DeviceId>, D1Database.DatabaseError>;
  }
>()("@stash/backend-auth/PairingsRepo") {}

const Taken = Schema.Struct({ deviceId: Device.DeviceId });

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  return PairingsRepo.of({
    insert: (pairing) =>
      db
        .run(
          D1Database.sql`INSERT INTO device_pairings (code_hash, device_id, expires_at)
            VALUES (${pairing.codeHash}, ${pairing.deviceId}, ${DateTime.formatIso(pairing.expiresAt)})
            ON CONFLICT (code_hash) DO NOTHING`,
        )
        .pipe(Effect.map((result) => result.changes > 0)),
    take: (codeHash, now) =>
      Effect.gen(function* () {
        const iso = DateTime.formatIso(now);
        // Lapsed approvals go too, so the table never grows.
        yield* db.run(D1Database.sql`DELETE FROM device_pairings WHERE expires_at <= ${iso}`);
        const taken = yield* D1Database.queryFirst(Taken)(
          D1Database.sql`DELETE FROM device_pairings WHERE code_hash = ${codeHash}
            AND expires_at > ${iso} RETURNING device_id AS deviceId`,
        );
        return Option.map(taken, (row) => row.deviceId);
      }).pipe(Effect.provideService(D1Database.Database, db)),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<PairingsRepo, never, D1Database.Database> =
  Layer.effect(PairingsRepo)(make);
