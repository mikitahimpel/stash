import * as StashConfig from "@stash/backend-platform/stash-config";
import type * as Security from "@stash/contracts-api/security";
import type * as Invite from "@stash/contracts-domain/invite";
import * as AcceptInvite from "@stash/backend-users/accept-invite";
import * as UsersRepo from "@stash/backend-users/users-repo";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as GithubClient from "../device-flow/github-client.ts";

/**
 * The Stash user a GitHub account signs in as, if any:
 *
 * - the allowlisted login (`ALLOWED_GITHUB_LOGIN`) is the owner, as before there were members;
 * - an account bound to a member (by its numeric id, which survives a rename) is that member;
 * - any other account becomes a new member if it comes with an invite that can still be
 *   accepted, which uses the invite up.
 *
 * `None` for everyone else. An invite is never spent on an account that already has a user.
 */
export const resolveUser = Effect.fn("resolveUser")(function* (
  account: GithubClient.GithubUser,
  invite?: Invite.InviteToken,
) {
  const config = yield* StashConfig.StashConfig;
  const users = yield* UsersRepo.UsersRepo;
  if (GithubClient.sameLogin(account.login, config.allowedGithubLogin)) {
    return Option.some<Security.CurrentUser["Service"]>({ id: UsersRepo.ownerId, role: "owner" });
  }
  const known = yield* users.findByIdentity("github", account.id);
  if (Option.isSome(known)) return Option.some({ id: known.value.id, role: known.value.role });
  if (invite === undefined) return Option.none();
  const created = yield* AcceptInvite.acceptInvite(invite, {
    provider: "github",
    subject: account.id,
    label: account.login,
  });
  if (Option.isSome(created)) yield* Effect.log(`members: ${created.value.id} joined by invite`);
  return Option.map(created, (user) => ({ id: user.id, role: user.role }));
});
