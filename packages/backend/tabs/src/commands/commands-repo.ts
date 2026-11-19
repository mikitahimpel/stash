import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as Command from "@stash/contracts-domain/command";
import type * as Device from "@stash/contracts-domain/device";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `commands` table. `payload` holds the JSON of the `CommandPayload` and `kind` repeats its
// `kind`, so commands can be filtered by kind in SQL.

/** The outcome a device reports. */
export type Outcome = Exclude<Command.CommandStatus, "pending">;

/** The `commands` table: the commands of the current user's devices (`CurrentUser`). */
export class CommandsRepo extends Context.Service<
  CommandsRepo,
  {
    readonly insert: (
      command: Command.Command,
    ) => Effect.Effect<void, D1Database.DatabaseError, Security.CurrentUser>;
    readonly findById: (
      id: Command.CommandId,
    ) => Effect.Effect<
      Option.Option<Command.Command>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
    /** The device's commands, oldest first, optionally with one status. */
    readonly listByDevice: (
      deviceId: Device.DeviceId,
      status?: Command.CommandStatus,
    ) => Effect.Effect<
      ReadonlyArray<Command.Command>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
    /** Moves a pending command to `status`. `false` if it was not pending (or does not exist). */
    readonly complete: (
      id: Command.CommandId,
      status: Outcome,
      completedAt: DateTime.Utc,
    ) => Effect.Effect<boolean, D1Database.DatabaseError, Security.CurrentUser>;
  }
>()("@stash/backend-tabs/CommandsRepo") {}

const CommandRow = Schema.Struct({
  ...Command.Command.fields,
  payload: Schema.fromJsonString(Command.CommandPayload),
});

const commandColumns = `id, device_id AS deviceId, payload, status, created_at AS createdAt,
  completed_at AS completedAt`;

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  const currentUser = Effect.service(Security.CurrentUser);
  return CommandsRepo.of({
    insert: (command) =>
      Effect.flatMap(currentUser, (user) =>
        db.run(
          D1Database.sql`INSERT INTO commands
              (id, user_id, device_id, kind, payload, status, created_at)
            VALUES (${command.id}, ${user.id}, ${command.deviceId}, ${command.payload.kind},
              ${JSON.stringify(command.payload)}, ${command.status},
              ${DateTime.formatIso(command.createdAt)})`,
        ),
      ).pipe(Effect.asVoid),
    findById: (id) =>
      Effect.flatMap(currentUser, (user) =>
        D1Database.queryFirst(CommandRow)(
          D1Database.statement(
            `SELECT ${commandColumns} FROM commands WHERE id = ? AND user_id = ?`,
            id,
            user.id,
          ),
        ).pipe(provide),
      ),
    listByDevice: (deviceId, status) =>
      Effect.flatMap(currentUser, (user) =>
        D1Database.query(CommandRow)(
          status === undefined
            ? D1Database.statement(
                `SELECT ${commandColumns} FROM commands WHERE device_id = ? AND user_id = ?
                  ORDER BY created_at, rowid`,
                deviceId,
                user.id,
              )
            : D1Database.statement(
                `SELECT ${commandColumns} FROM commands
                  WHERE device_id = ? AND user_id = ? AND status = ?
                  ORDER BY created_at, rowid`,
                deviceId,
                user.id,
                status,
              ),
        ).pipe(provide),
      ),
    complete: (id, status, completedAt) =>
      Effect.flatMap(currentUser, (user) =>
        db.run(
          D1Database.sql`UPDATE commands SET status = ${status},
            completed_at = ${DateTime.formatIso(completedAt)}
            WHERE id = ${id} AND user_id = ${user.id} AND status = 'pending'`,
        ),
      ).pipe(Effect.map((result) => result.changes > 0)),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<CommandsRepo, never, D1Database.Database> =
  Layer.effect(CommandsRepo)(make);
