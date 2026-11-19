import * as D1Database from "@stash/backend-platform/d1-database";
import * as Members from "@stash/contracts-api/members";
import type * as Invite from "@stash/contracts-domain/invite";
import * as User from "@stash/contracts-domain/user";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `users` and `user_identities` tables. This repo is about the users themselves, so unlike
// the repos of user data it does not read `CurrentUser`: it is what tells who the current user is
// (at sign-in), and what the owner manages. Its callers check who may ask.

/** The id of the owner, fixed by `0011-users.sql`. */
export const ownerId = User.UserId.make("owner");

/** An account at a sign-in provider. For GitHub the subject is the account's numeric id. */
export interface Identity {
  readonly provider: "github";
  readonly subject: string;
  /** What the provider calls the account, to show. */
  readonly label: string;
}

/** A member to create by accepting an invite. */
export interface NewMember {
  readonly id: User.UserId;
  readonly displayName: string;
  readonly dailyAiQuota: User.DailyAiQuota;
  readonly identity: Identity;
  readonly inviteId: Invite.InviteId;
  readonly now: DateTime.Utc;
}

export class UsersRepo extends Context.Service<
  UsersRepo,
  {
    readonly findById: (
      id: User.UserId,
    ) => Effect.Effect<Option.Option<User.User>, D1Database.DatabaseError>;
    /** The user who signs in with this account, if one does. */
    readonly findByIdentity: (
      provider: Identity["provider"],
      subject: string,
    ) => Effect.Effect<Option.Option<User.User>, D1Database.DatabaseError>;
    /** Every user with what they hold, the owner first, then oldest first. */
    readonly list: Effect.Effect<ReadonlyArray<Members.Member>, D1Database.DatabaseError>;
    /** Every user's id and role, the owner first: what the crons walk. */
    readonly listAll: Effect.Effect<
      ReadonlyArray<{ readonly id: User.UserId; readonly role: User.UserRole }>,
      D1Database.DatabaseError
    >;
    /**
     * Creates the member with their sign-in account and uses up the invite, in one transaction.
     * `false`, with nothing written, if the invite can no longer be accepted (used by someone a
     * moment ago, revoked, expired) or the account already belongs to a user.
     */
    readonly createMember: (member: NewMember) => Effect.Effect<boolean, D1Database.DatabaseError>;
  }
>()("@stash/backend-users/UsersRepo") {}

const userColumns = `u.id, u.display_name AS displayName, u.role, u.created_at AS createdAt,
  u.daily_ai_quota AS dailyAiQuota`;

const RoleRow = Schema.Struct({ id: User.UserId, role: User.UserRole });

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  const findById = (id: User.UserId) =>
    D1Database.queryFirst(User.User)(
      D1Database.statement(`SELECT ${userColumns} FROM users u WHERE u.id = ?`, id),
    ).pipe(provide);
  return UsersRepo.of({
    findById,
    findByIdentity: (provider, subject) =>
      D1Database.queryFirst(User.User)(
        D1Database.statement(
          `SELECT ${userColumns} FROM user_identities i JOIN users u ON u.id = i.user_id
            WHERE i.provider = ? AND i.subject = ?`,
          provider,
          subject,
        ),
      ).pipe(provide),
    list: D1Database.query(Members.Member)(
      D1Database.statement(
        `SELECT ${userColumns},
            (SELECT COUNT(*) FROM links l WHERE l.user_id = u.id) AS links
          FROM users u ORDER BY u.role = 'owner' DESC, u.created_at, u.id`,
      ),
    ).pipe(provide),
    listAll: D1Database.query(RoleRow)(
      D1Database.statement(
        "SELECT id, role FROM users ORDER BY role = 'owner' DESC, created_at, id",
      ),
    ).pipe(provide),
    createMember: Effect.fn("UsersRepo.createMember")(function* (member) {
      const now = DateTime.formatIso(member.now);
      const { identity } = member;
      // Each statement writes only if the one before it did, so a lost race writes nothing. The
      // user comes first because the invite's `accepted_by` references it.
      yield* db.batch([
        D1Database.sql`INSERT INTO users (id, display_name, role, daily_ai_quota, created_at)
          SELECT ${member.id}, ${member.displayName}, 'member', ${member.dailyAiQuota}, ${now}
          WHERE EXISTS (SELECT 1 FROM invites WHERE id = ${member.inviteId}
              AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ${now})
            AND NOT EXISTS (SELECT 1 FROM user_identities
              WHERE provider = ${identity.provider} AND subject = ${identity.subject})`,
        D1Database.sql`UPDATE invites SET accepted_at = ${now}, accepted_by = ${member.id}
          WHERE id = ${member.inviteId} AND accepted_at IS NULL
            AND EXISTS (SELECT 1 FROM users WHERE id = ${member.id})`,
        D1Database.sql`INSERT INTO user_identities (provider, subject, user_id, label, created_at)
          SELECT ${identity.provider}, ${identity.subject}, ${member.id}, ${identity.label}, ${now}
          WHERE EXISTS (SELECT 1 FROM users WHERE id = ${member.id})`,
      ]);
      return Option.isSome(yield* findById(member.id));
    }),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<UsersRepo, never, D1Database.Database> =
  Layer.effect(UsersRepo)(make);
