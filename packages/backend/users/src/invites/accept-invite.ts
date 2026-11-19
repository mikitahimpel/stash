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

/**
 * Signs a new person up with an invite: creates the member (named after their account, with the
 * default daily AI quota), binds the sign-in account to them and uses the invite up. `None`, with
 * nothing created, when the invite cannot be accepted (unknown, used, revoked, expired) or the
 * account already has a user.
 */
export const acceptInvite = Effect.fn("acceptInvite")(function* (
  token: Invite.InviteToken,
  identity: UsersRepo.Identity,
) {
  const users = yield* UsersRepo.UsersRepo;
  const invite = yield* findOpenInvite(token);
  if (Option.isNone(invite)) return Option.none<User.User>();
  const id = User.UserId.make(crypto.randomUUID());
  const created = yield* users.createMember({
    id,
    displayName: identity.label.slice(0, 100) || "Member",
    dailyAiQuota: User.defaultMemberDailyAiQuota,
    identity,
    inviteId: invite.value.id,
    now: yield* DateTime.now,
  });
  return created ? yield* users.findById(id) : Option.none<User.User>();
});
