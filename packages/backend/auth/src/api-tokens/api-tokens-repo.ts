import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A token row: what is listed, plus the hash and the user the token acts for. */
export const StoredApiToken = Schema.Struct({
  ...ApiToken.ApiTokenInfo.fields,
  userId: User.UserId,
  role: User.UserRole,
  hash: Schema.String,
});
export type StoredApiToken = typeof StoredApiToken.Type;

/** A token to insert. Only its hash, never the plaintext. */
export interface NewApiToken {
  readonly id: ApiToken.ApiTokenId;
  readonly deviceId: Device.DeviceId;
  readonly hash: string;
  readonly createdAt: DateTime.Utc;
}

/** A user token to insert: no device, and a name for Settings. */
export interface NewUserApiToken {
  readonly id: ApiToken.ApiTokenId;
  readonly name: string;
  readonly hash: string;
  readonly createdAt: DateTime.Utc;
}

/**
 * The `api_tokens` table. Everything is the current user's (`CurrentUser`) except `findByHash`
 * and `touch`: those authenticate a request, which is how the current user gets known.
 */
export class ApiTokensRepo extends Context.Service<
  ApiTokensRepo,
  {
    /** Whether the current user has this device. */
    readonly deviceExists: (
      deviceId: Device.DeviceId,
    ) => Effect.Effect<boolean, D1Database.DatabaseError, Security.CurrentUser>;
    readonly insert: (
      token: NewApiToken,
    ) => Effect.Effect<ApiToken.ApiTokenInfo, D1Database.DatabaseError, Security.CurrentUser>;
    readonly insertUser: (
      token: NewUserApiToken,
    ) => Effect.Effect<ApiToken.ApiTokenInfo, D1Database.DatabaseError, Security.CurrentUser>;
    /** Every token of the current user, revoked ones included, oldest first. */
    readonly list: Effect.Effect<
      ReadonlyArray<ApiToken.ApiTokenInfo>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
    readonly findByHash: (
      hash: string,
    ) => Effect.Effect<Option.Option<StoredApiToken>, D1Database.DatabaseError>;
    /**
     * Records that the token authenticated a request at `at`, unless it already did within the
     * last minute (one write per token per minute at most).
     */
    readonly touch: (
      id: ApiToken.ApiTokenId,
      at: DateTime.Utc,
    ) => Effect.Effect<void, D1Database.DatabaseError>;
    /**
     * Sets `revokedAt` unless the token is already revoked. `None` if the current user has no
     * such token.
     */
    readonly revoke: (
      id: ApiToken.ApiTokenId,
      at: DateTime.Utc,
    ) => Effect.Effect<
      Option.Option<ApiToken.ApiTokenInfo>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
  }
>()("@stash/backend-auth/ApiTokensRepo") {}

const infoColumns = `id, device_id AS deviceId, name, created_at AS createdAt,
  revoked_at AS revokedAt, last_used_at AS lastUsedAt`;

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return ApiTokensRepo.of({
    deviceExists: (deviceId) =>
      Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
        db
          .first(
            D1Database.sql`SELECT 1 AS found FROM devices
              WHERE id = ${deviceId} AND user_id = ${user.id}`,
          )
          .pipe(Effect.map(Option.isSome)),
      ),
    insert: (token) => {
      const createdAt = DateTime.formatIso(token.createdAt);
      return Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
        db.run(
          D1Database.sql`INSERT INTO api_tokens (id, user_id, device_id, hash, created_at)
            VALUES (${token.id}, ${user.id}, ${token.deviceId}, ${token.hash}, ${createdAt})`,
        ),
      ).pipe(
        Effect.as({
          id: token.id,
          deviceId: token.deviceId,
          name: null,
          createdAt: token.createdAt,
          revokedAt: null,
          lastUsedAt: null,
        }),
      );
    },
    insertUser: (token) => {
      const createdAt = DateTime.formatIso(token.createdAt);
      return Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
        db.run(
          D1Database.sql`INSERT INTO api_tokens (id, user_id, name, hash, created_at)
            VALUES (${token.id}, ${user.id}, ${token.name}, ${token.hash}, ${createdAt})`,
        ),
      ).pipe(
        Effect.as({
          id: token.id,
          deviceId: null,
          name: token.name,
          createdAt: token.createdAt,
          revokedAt: null,
          lastUsedAt: null,
        }),
      );
    },
    list: Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
      D1Database.query(ApiToken.ApiTokenInfo)(
        D1Database.statement(
          `SELECT ${infoColumns} FROM api_tokens WHERE user_id = ? ORDER BY created_at, id`,
          user.id,
        ),
      ).pipe(provide),
    ),
    findByHash: (hash) =>
      D1Database.queryFirst(StoredApiToken)(
        D1Database.statement(
          `SELECT t.id, t.device_id AS deviceId, t.name, t.created_at AS createdAt,
              t.revoked_at AS revokedAt, t.last_used_at AS lastUsedAt, t.hash,
              t.user_id AS userId, u.role
            FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
          hash,
        ),
      ).pipe(provide),
    touch: (id, at) =>
      db
        .run(
          D1Database.sql`UPDATE api_tokens SET last_used_at = ${DateTime.formatIso(at)}
            WHERE id = ${id} AND (last_used_at IS NULL
              OR last_used_at < ${DateTime.formatIso(DateTime.subtract(at, { minutes: 1 }))})`,
        )
        .pipe(Effect.asVoid),
    revoke: (id, at) =>
      Effect.flatMap(Effect.service(Security.CurrentUser), (user) =>
        D1Database.queryFirst(ApiToken.ApiTokenInfo)(
          D1Database.statement(
            `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?
              RETURNING ${infoColumns}`,
            DateTime.formatIso(at),
            id,
            user.id,
          ),
        ).pipe(provide),
      ),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<ApiTokensRepo, never, D1Database.Database> =
  Layer.effect(ApiTokensRepo)(make);
