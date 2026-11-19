import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import * as Invite from "@stash/contracts-domain/invite";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `invites` table. Listing, creating and revoking are the current user's own invites
// (`CurrentUser`, the owner: the callers check the role). `findOpen` is what a sign-up reads with
// nothing but the link's token, so it takes no user.

/** An invite to insert. Only the hash of its token, never the token. */
export interface NewInvite {
  readonly id: Invite.InviteId;
  readonly tokenHash: string;
  readonly createdAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
}

/** What `revoke` found. */
export type Revoked = "revoked" | "accepted" | "missing";

export class InvitesRepo extends Context.Service<
  InvitesRepo,
  {
    readonly insert: (
      invite: NewInvite,
    ) => Effect.Effect<Invite.Invite, D1Database.DatabaseError, Security.CurrentUser>;
    /** The current user's invites, newest first. */
    readonly list: Effect.Effect<
      ReadonlyArray<Invite.Invite>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
    /** Sets `revokedAt` on an invite nobody accepted. Revoking again keeps the first time. */
    readonly revoke: (
      id: Invite.InviteId,
      at: DateTime.Utc,
    ) => Effect.Effect<Revoked, D1Database.DatabaseError, Security.CurrentUser>;
    /** The invite with this token hash, if it can still be accepted at `now`. */
    readonly findOpen: (
      tokenHash: string,
      now: DateTime.Utc,
    ) => Effect.Effect<Option.Option<Invite.Invite>, D1Database.DatabaseError>;
  }
>()("@stash/backend-users/InvitesRepo") {}

const columns = `id, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt,
  accepted_at AS acceptedAt, accepted_by AS acceptedBy`;

const StateRow = Schema.Struct({ acceptedAt: Schema.NullOr(Schema.String) });

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return InvitesRepo.of({
    insert: (invite) =>
      Effect.gen(function* () {
        const user = yield* Security.CurrentUser;
        yield* db.run(
          D1Database.sql`INSERT INTO invites (id, token_hash, created_by, created_at, expires_at)
            VALUES (${invite.id}, ${invite.tokenHash}, ${user.id},
              ${DateTime.formatIso(invite.createdAt)}, ${DateTime.formatIso(invite.expiresAt)})`,
        );
        return {
          id: invite.id,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          revokedAt: null,
          acceptedAt: null,
          acceptedBy: null,
        };
      }),
    list: Effect.gen(function* () {
      const user = yield* Security.CurrentUser;
      return yield* D1Database.query(Invite.Invite)(
        D1Database.statement(
          `SELECT ${columns} FROM invites WHERE created_by = ? ORDER BY created_at DESC, id`,
          user.id,
        ),
      ).pipe(provide);
    }),
    revoke: (id, at) =>
      Effect.gen(function* () {
        const user = yield* Security.CurrentUser;
        const row = yield* D1Database.queryFirst(StateRow)(
          D1Database.sql`UPDATE invites
            SET revoked_at = CASE WHEN accepted_at IS NULL
              THEN COALESCE(revoked_at, ${DateTime.formatIso(at)}) ELSE revoked_at END
            WHERE id = ${id} AND created_by = ${user.id}
            RETURNING accepted_at AS acceptedAt`,
        ).pipe(provide);
        if (row._tag === "None") return "missing" as const;
        return row.value.acceptedAt === null ? ("revoked" as const) : ("accepted" as const);
      }),
    findOpen: (tokenHash, now) =>
      D1Database.queryFirst(Invite.Invite)(
        D1Database.statement(
          `SELECT ${columns} FROM invites WHERE token_hash = ?
            AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
          tokenHash,
          DateTime.formatIso(now),
        ),
      ).pipe(provide),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<InvitesRepo, never, D1Database.Database> =
  Layer.effect(InvitesRepo)(make);
