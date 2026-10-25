import * as D1Database from "@stash/backend-platform/d1-database";
import * as ApiToken from "@stash/contracts-domain/api-token";
import type * as Device from "@stash/contracts-domain/device";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A token row: what is listed, plus the hash. */
export const StoredApiToken = Schema.Struct({
  ...ApiToken.ApiTokenInfo.fields,
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

/** The `api_tokens` table. */
export class ApiTokensRepo extends Context.Service<
  ApiTokensRepo,
  {
    readonly deviceExists: (
      deviceId: Device.DeviceId,
    ) => Effect.Effect<boolean, D1Database.DatabaseError>;
    readonly insert: (
      token: NewApiToken,
    ) => Effect.Effect<ApiToken.ApiTokenInfo, D1Database.DatabaseError>;
    /** Every token, revoked ones included, oldest first. */
    readonly list: Effect.Effect<ReadonlyArray<ApiToken.ApiTokenInfo>, D1Database.DatabaseError>;
    readonly findByHash: (
      hash: string,
    ) => Effect.Effect<Option.Option<StoredApiToken>, D1Database.DatabaseError>;
    /** Sets `revokedAt` unless the token is already revoked. `None` if there is no such token. */
    readonly revoke: (
      id: ApiToken.ApiTokenId,
      at: DateTime.Utc,
    ) => Effect.Effect<Option.Option<ApiToken.ApiTokenInfo>, D1Database.DatabaseError>;
  }
>()("@stash/backend-auth/ApiTokensRepo") {}

const infoColumns = "id, device_id AS deviceId, created_at AS createdAt, revoked_at AS revokedAt";

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return ApiTokensRepo.of({
    deviceExists: (deviceId) =>
      db
        .first(D1Database.sql`SELECT 1 AS found FROM devices WHERE id = ${deviceId}`)
        .pipe(Effect.map(Option.isSome)),
    insert: (token) => {
      const createdAt = DateTime.formatIso(token.createdAt);
      return db
        .run(
          D1Database.sql`INSERT INTO api_tokens (id, device_id, hash, created_at)
            VALUES (${token.id}, ${token.deviceId}, ${token.hash}, ${createdAt})`,
        )
        .pipe(
          Effect.as({
            id: token.id,
            deviceId: token.deviceId,
            createdAt: token.createdAt,
            revokedAt: null,
          }),
        );
    },
    list: D1Database.query(ApiToken.ApiTokenInfo)(
      D1Database.statement(`SELECT ${infoColumns} FROM api_tokens ORDER BY created_at, id`),
    ).pipe(provide),
    findByHash: (hash) =>
      D1Database.queryFirst(StoredApiToken)(
        D1Database.statement(`SELECT ${infoColumns}, hash FROM api_tokens WHERE hash = ?`, hash),
      ).pipe(provide),
    revoke: (id, at) =>
      D1Database.queryFirst(ApiToken.ApiTokenInfo)(
        D1Database.statement(
          `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?
            RETURNING ${infoColumns}`,
          DateTime.formatIso(at),
          id,
        ),
      ).pipe(provide),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<ApiTokensRepo, never, D1Database.Database> =
  Layer.effect(ApiTokensRepo)(make);
