import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as SignIn from "@stash/contracts-domain/sign-in";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `passkeys` table. Listing, adding and removing are the current user's (`CurrentUser`).
// `find` is what a sign-in reads with nothing but the credential id the authenticator answered
// with, which is how the user gets known, so it takes no user.

/** A passkey row. `publicKey` is the COSE key, base64url. */
export const StoredPasskey = Schema.Struct({
  id: SignIn.PasskeyId,
  userId: User.UserId,
  publicKey: Schema.String,
  counter: Schema.Int,
  /** JSON array of transports, or `null`. */
  transports: Schema.NullOr(Schema.String),
  synced: Schema.Boolean,
  name: SignIn.PasskeyName,
  createdAt: Schema.DateTimeUtcFromString,
  lastUsedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type StoredPasskey = typeof StoredPasskey.Type;

/** A passkey to insert. */
export type NewPasskey = Omit<StoredPasskey, "lastUsedAt">;

// SQLite stores `synced` as 0 or 1.
const Row = Schema.Struct({ ...StoredPasskey.fields, synced: Schema.BooleanFromBit });

const columns = `id, user_id AS userId, public_key AS publicKey, counter, transports, synced, name,
  created_at AS createdAt, last_used_at AS lastUsedAt`;

/** A row as its user sees it. */
export const toPasskey = (row: StoredPasskey): SignIn.Passkey => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  synced: row.synced,
});

/**
 * The statement that inserts `passkey`, only while its user exists: a sign-up writes it in the
 * same transaction as the new member (`AcceptInvite.SignUp`), and a lost race writes nothing.
 */
export const insertStatement = (passkey: NewPasskey): D1Database.Statement =>
  D1Database.sql`INSERT INTO passkeys
      (id, user_id, public_key, counter, transports, synced, name, created_at)
    SELECT ${passkey.id}, ${passkey.userId}, ${passkey.publicKey}, ${passkey.counter},
      ${passkey.transports}, ${passkey.synced ? 1 : 0}, ${passkey.name},
      ${DateTime.formatIso(passkey.createdAt)}
    WHERE EXISTS (SELECT 1 FROM users WHERE id = ${passkey.userId})
      AND NOT EXISTS (SELECT 1 FROM passkeys WHERE id = ${passkey.id})`;

export class PasskeysRepo extends Context.Service<
  PasskeysRepo,
  {
    /** The passkey of a credential id, whoever's it is. */
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<StoredPasskey>, D1Database.DatabaseError>;
    /** The current user's passkeys, oldest first. */
    readonly list: Effect.Effect<
      ReadonlyArray<StoredPasskey>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
    /** Adds a passkey of the current user. `false` if the credential id is taken. */
    readonly insert: (
      passkey: Omit<NewPasskey, "userId">,
    ) => Effect.Effect<boolean, D1Database.DatabaseError, Security.CurrentUser>;
    /** Removes a passkey of the current user. `false` if they have no such passkey. */
    readonly remove: (
      id: SignIn.PasskeyId,
    ) => Effect.Effect<boolean, D1Database.DatabaseError, Security.CurrentUser>;
    /** Records a sign-in: the authenticator's new counter and the time. */
    readonly touch: (
      passkey: Pick<StoredPasskey, "id" | "userId">,
      counter: number,
      at: DateTime.Utc,
    ) => Effect.Effect<void, D1Database.DatabaseError>;
  }
>()("@stash/backend-auth/PasskeysRepo") {}

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return PasskeysRepo.of({
    find: (id) =>
      D1Database.queryFirst(Row)(
        D1Database.statement(`SELECT ${columns} FROM passkeys WHERE id = ?`, id),
      ).pipe(provide),
    list: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      return yield* D1Database.query(Row)(
        D1Database.statement(
          `SELECT ${columns} FROM passkeys WHERE user_id = ? ORDER BY created_at, id`,
          user.id,
        ),
      ).pipe(provide);
    }),
    insert: (passkey) =>
      Effect.gen(function* () {
        const user = yield* Security.CurrentUser;
        const result = yield* db.run(insertStatement({ ...passkey, userId: user.id }));
        return result.changes > 0;
      }),
    remove: (id) =>
      Effect.gen(function* () {
        const user = yield* Security.CurrentUser;
        const result = yield* db.run(
          D1Database.sql`DELETE FROM passkeys WHERE id = ${id} AND user_id = ${user.id}`,
        );
        return result.changes > 0;
      }),
    touch: (passkey, counter, at) =>
      db
        .run(
          D1Database.sql`UPDATE passkeys SET counter = ${counter},
              last_used_at = ${DateTime.formatIso(at)}
            WHERE id = ${passkey.id} AND user_id = ${passkey.userId}`,
        )
        .pipe(Effect.asVoid),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<PasskeysRepo, never, D1Database.Database> =
  Layer.effect(PasskeysRepo)(make);
