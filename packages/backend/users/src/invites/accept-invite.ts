import type * as D1Database from "@stash/backend-platform/d1-database";
import type * as Invite from "@stash/contracts-domain/invite";
import * as User from "@stash/contracts-domain/user";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SecretHash from "../secret-hash.ts";
import * as UsersRepo from "../users-repo.ts";
import * as InvitesRepo from "./invites-repo.ts";

/** The invite of a link's token, if it can still be accepted. */
export const findOpenInvite = Effect.fn("findOpenInvite")(function* (token: Invite.InviteToken) {
  const invites = yield* InvitesRepo.InvitesRepo;
  return yield* invites.findOpen(yield* SecretHash.hash(token), yield* DateTime.now);
});

/** How a new member signs up: an account at a provider, or rows written with the user (a passkey). */
export type SignUp =
  | UsersRepo.Identity
  | {
      readonly displayName: string;
      /** The member's rows besides the user, given the new user's id (see `NewMember.also`). */
      readonly also: (id: User.UserId) => ReadonlyArray<D1Database.Statement>;
      /** The id to create the user with, when the rows need it beforehand (a WebAuthn user id). */
      readonly id?: User.UserId;
    };

/**
 * Signs a new person up with an invite: creates the member (named after their account, with the
 * default daily AI quota), binds the sign-in account (or writes the passkey) and uses the invite
 * up, in one transaction. `None`, with nothing created, when the invite cannot be accepted
 * (unknown, used, revoked, expired) or the account already has a user.
 */
export const acceptInvite = Effect.fn("acceptInvite")(function* (
  token: Invite.InviteToken,
  signUp: SignUp,
) {
  const users = yield* UsersRepo.UsersRepo;
  const invite = yield* findOpenInvite(token);
  if (Option.isNone(invite)) return Option.none<User.User>();
  const id = ("id" in signUp ? signUp.id : undefined) ?? User.UserId.make(crypto.randomUUID());
  const name = "also" in signUp ? signUp.displayName : signUp.label;
  const created = yield* users.createMember({
    id,
    displayName: name.trim().slice(0, 100) || "Member",
    dailyAiQuota: User.defaultMemberDailyAiQuota,
    ...("also" in signUp ? { also: signUp.also(id) } : { identity: signUp }),
    inviteId: invite.value.id,
    now: yield* DateTime.now,
  });
  return created ? yield* users.findById(id) : Option.none<User.User>();
});
