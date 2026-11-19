import * as D1Database from "@stash/backend-platform/d1-database";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * A session row. `id` is the hash of the session token, never the token. `githubLogin` is the
 * GitHub login that signed in, to show and, for the owner, to check against the allowlist.
 */
export const StoredSession = Schema.Struct({
  id: Schema.String,
  userId: User.UserId,
  githubLogin: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type StoredSession = typeof StoredSession.Type;

/** A session with its user's role. A session whose user is gone is not found. */
export const SessionWithRole = Schema.Struct({ ...StoredSession.fields, role: User.UserRole });
export type SessionWithRole = typeof SessionWithRole.Type;

/**
 * The `sessions` table. A session is looked up by the hash of its secret token, which is how the
 * current user gets known, so nothing here reads `CurrentUser`.
 */
export class SessionsRepo extends Context.Service<
  SessionsRepo,
  {
    readonly insert: (session: StoredSession) => Effect.Effect<void, D1Database.DatabaseError>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<SessionWithRole>, D1Database.DatabaseError>;
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
          D1Database.sql`INSERT INTO sessions (id, user_id, github_login, created_at, expires_at)
            VALUES (${session.id}, ${session.userId}, ${session.githubLogin}, ${createdAt},
              ${expiresAt})`,
        )
        .pipe(Effect.asVoid);
    },
    find: (id) =>
      D1Database.queryFirst(SessionWithRole)(
        D1Database.statement(
          `SELECT s.id, s.user_id AS userId, u.role, s.github_login AS githubLogin,
              s.created_at AS createdAt, s.expires_at AS expiresAt
            FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
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
