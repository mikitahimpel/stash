import * as StashConfig from "@stash/backend-platform/stash-config";
import * as UsersRepo from "@stash/backend-users/users-repo";
import type * as AuthGroup from "@stash/contracts-api/auth";
import * as Security from "@stash/contracts-api/security";
import type * as SignInGroup from "@stash/contracts-api/sign-in";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as GithubClient from "../device-flow/github-client.ts";
import * as PollDeviceFlow from "../device-flow/poll-device-flow.ts";
import * as SignInMethods from "./sign-in-methods.ts";

const taken = () => new Errors.Conflict({ message: "This GitHub account signs another user in" });

/**
 * One poll of a device flow started to link GitHub to the current user. Once GitHub authorizes,
 * the account is linked, unless it is the owner's login or another user's account (`Conflict`).
 * The owner signs in with GitHub already and links nothing here (`Conflict`).
 */
export const linkGithub = Effect.fn("linkGithub")(function* (flowId: AuthGroup.DeviceFlowId) {
  const current = yield* Security.CurrentUser;
  const config = yield* StashConfig.StashConfig;
  const users = yield* UsersRepo.UsersRepo;
  if (current.role === "owner") {
    return yield* new Errors.Conflict({ message: "The owner signs in with GitHub already" });
  }
  const polled = yield* PollDeviceFlow.pollAccount(flowId);
  if (polled.status !== "authorized") return polled satisfies SignInGroup.GithubLinkStatus;
  const { account } = polled;
  if (GithubClient.sameLogin(account.login, config.allowedGithubLogin)) return yield* taken();
  const now = yield* DateTime.now;
  const identity = { provider: "github" as const, subject: account.id, label: account.login };
  if (!(yield* users.linkIdentity(current.id, identity, now).pipe(Effect.orDie))) {
    const holder = yield* users.findByIdentity("github", account.id).pipe(Effect.orDie);
    if (Option.isNone(holder) || holder.value.id !== current.id) return yield* taken();
  }
  return {
    status: "complete",
    account: {
      id: SignInMethods.accountId("github", account.id),
      provider: "github",
      label: account.login,
      linkedAt: now,
      fixed: false,
    },
  } satisfies SignInGroup.GithubLinkStatus;
});
