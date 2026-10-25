import * as D1Database from "@stash/backend-platform/d1-database";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A session row. `id` is the hash of the session token, never the token. */
export const StoredSession = Schema.Struct({
  id: Schema.String,
  githubLogin: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type StoredSession = typeof StoredSession.Type;

/** The `sessions` table. */
export class SessionsRepo extends Context.Service<
  SessionsRepo,
  {
    readonly insert: (session: StoredSession) => Effect.Effect<void, D1Database.DatabaseError>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<StoredSession>, D1Database.DatabaseError>;
    readonly remove: (id: string) => Effect.Effect<void, D1Database.DatabaseError>;
  }
>()("@stash/backend-auth/SessionsRepo") {}

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return SessionsRepo.of({
    insert: (session) => {
      const createdAt = DateTime.formatIso(session.createdAt);
      const expiresAt = DateTime.formatIso(session.expiresAt);
      return db
        .run(
          D1Database.sql`INSERT INTO sessions (id, github_login, created_at, expires_at)
            VALUES (${session.id}, ${session.githubLogin}, ${createdAt}, ${expiresAt})`,
        )
        .pipe(Effect.asVoid);
    },
    find: (id) =>
      D1Database.queryFirst(StoredSession)(
        D1Database.statement(
          `SELECT id, github_login AS githubLogin, created_at AS createdAt, expires_at AS expiresAt
            FROM sessions WHERE id = ?`,
          id,
        ),
      ).pipe(provide),
    remove: (id) =>
      db.run(D1Database.sql`DELETE FROM sessions WHERE id = ${id}`).pipe(Effect.asVoid),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<SessionsRepo, never, D1Database.Database> =
  Layer.effect(SessionsRepo)(make);
