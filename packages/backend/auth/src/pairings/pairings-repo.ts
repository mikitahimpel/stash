import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * How long a pairing row outlives its `expires_at`, claimed or not. While it exists its code can't
 * be approved again, so an old `/connect/extension?code=…` tab reopened and approved registers no
 * second device. Rows are tiny and only an owner's approval adds one.
 */
export const retentionDays = 90;

/**
 * The `device_pairings` table: every approved pairing code (its hash), claimed or not, until
 * `retentionDays` after it lapses.
 */
export class PairingsRepo extends Context.Service<
  PairingsRepo,
  {
    /**
     * Registers `device` for the current user and stores the approval of its code, in one
     * transaction. `false`, with nothing written, if this code was ever approved (the row exists:
     * pending, claimed or lapsed).
     */
    readonly approve: (pairing: {
      readonly codeHash: string;
      readonly device: Device.Device;
      readonly expiresAt: DateTime.Utc;
    }) => Effect.Effect<boolean, D1Database.DatabaseError, Security.CurrentUser>;
    /**
     * Marks the approval claimed and returns its device and the user who approved it, if it
     * exists, is unclaimed and has not lapsed by `now`. One statement, so two claims of the same
     * code never both get a device. The row stays, so the code is still known to `approve`. The
     * caller is the extension, which has only the code: the code says whose device it is.
     */
    readonly take: (
      codeHash: string,
      now: DateTime.Utc,
    ) => Effect.Effect<Option.Option<Taken>, D1Database.DatabaseError>;
  }
>()("@stash/backend-auth/PairingsRepo") {}

const TakenRow = Schema.Struct({ deviceId: Device.DeviceId, userId: User.UserId });
const RoleRow = Schema.Struct({ role: User.UserRole });

/** A claimed pairing: the device, and the user it belongs to. */
export interface Taken {
  readonly deviceId: Device.DeviceId;
  readonly user: Security.CurrentUser["Service"];
}

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  return PairingsRepo.of({
    approve: (pairing) => {
      const exists = db
        .first(
          D1Database.sql`SELECT 1 AS found FROM device_pairings WHERE code_hash = ${pairing.codeHash}`,
        )
        .pipe(Effect.map(Option.isSome));
      const { device } = pairing;
      // No ON CONFLICT: a used code fails the batch, which then writes nothing (no orphan device).
      const write = (userId: User.UserId) =>
        db.batch([
          D1Database.sql`INSERT INTO devices (id, user_id, name, kind, created_at)
            VALUES (${device.id}, ${userId}, ${device.name}, ${device.kind},
              ${DateTime.formatIso(device.createdAt)})`,
          D1Database.sql`INSERT INTO device_pairings (code_hash, user_id, device_id, expires_at)
            VALUES (${pairing.codeHash}, ${userId}, ${device.id},
              ${DateTime.formatIso(pairing.expiresAt)})`,
        ]);
      return Effect.gen(function* () {
        const user = yield* Security.CurrentUser;
        if (yield* exists) return false;
        return yield* write(user.id).pipe(
          Effect.as(true),
          // A concurrent approval of the same code won the race.
          Effect.catchTag("DatabaseError", (error) =>
            Effect.flatMap(exists, (found) => (found ? Effect.succeed(false) : Effect.fail(error))),
          ),
        );
      });
    },
    take: (codeHash, now) =>
      Effect.gen(function* () {
        const iso = DateTime.formatIso(now);
        // Rows long past their lapse go, so the table never grows without bound.
        const purgeBefore = DateTime.formatIso(DateTime.subtract(now, { days: retentionDays }));
        yield* db.run(
          D1Database.sql`DELETE FROM device_pairings WHERE expires_at <= ${purgeBefore}`,
        );
        const taken = yield* D1Database.queryFirst(TakenRow)(
          D1Database.sql`UPDATE device_pairings SET claimed_at = ${iso}
            WHERE code_hash = ${codeHash} AND claimed_at IS NULL AND device_id IS NOT NULL
              AND expires_at > ${iso}
            RETURNING device_id AS deviceId, user_id AS userId`,
        );
        if (Option.isNone(taken)) return Option.none<Taken>();
        const { deviceId, userId } = taken.value;
        const role = yield* D1Database.queryFirst(RoleRow)(
          D1Database.sql`SELECT role FROM users WHERE id = ${userId}`,
        );
        return Option.map(role, (row) => ({ deviceId, user: { id: userId, role: row.role } }));
      }).pipe(Effect.provideService(D1Database.Database, db)),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<PairingsRepo, never, D1Database.Database> =
  Layer.effect(PairingsRepo)(make);
