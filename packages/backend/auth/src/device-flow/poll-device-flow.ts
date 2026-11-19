import type * as AuthGroup from "@stash/contracts-api/auth";
import type * as Invite from "@stash/contracts-domain/invite";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as SignIn from "../sessions/sign-in.ts";
import * as StartSession from "../sessions/start-session.ts";
import * as DeviceFlowsStore from "./device-flows-store.ts";
import * as GithubClient from "./github-client.ts";

/** Where a flow stands after one poll. `complete` carries the new session, once. */
export type PollOutcome =
  | { readonly status: "pending" }
  | { readonly status: "slow_down" }
  | {
      readonly status: "complete";
      readonly session: Effect.Success<ReturnType<typeof StartSession.startSession>>;
    };

const expired = () => new Errors.DeviceFlowExpired({ message: "The device flow has expired" });

/**
 * Polls GitHub for a started flow, at most once per `interval`; a poll that comes earlier answers
 * `slow_down` without reaching GitHub. Once GitHub authorizes, the flow is deleted, the access
 * token reads the account and is dropped, and a session starts if the account has a Stash user
 * (`SignIn.resolveUser`: the owner, a member, or a new member when `invite` can be accepted).
 */
export const pollDeviceFlow = Effect.fn("pollDeviceFlow")(function* (
  flowId: AuthGroup.DeviceFlowId,
  invite?: Invite.InviteToken,
) {
  const github = yield* GithubClient.GithubClient;
  const store = yield* DeviceFlowsStore.DeviceFlowsStore;

  const flow = yield* store.find(flowId);
  if (Option.isNone(flow)) return yield* expired();
  const now = yield* DateTime.now;
  if (DateTime.isLessThan(now, flow.value.nextPollAt)) {
    return { status: "slow_down" } satisfies PollOutcome;
  }

  const reschedule = (interval: number) =>
    store.put(flowId, {
      ...flow.value,
      interval,
      nextPollAt: DateTime.addDuration(now, Duration.seconds(interval)),
    });

  const result = yield* github.pollAccessToken(Redacted.make(flow.value.deviceCode));
  switch (result._tag) {
    case "Pending":
      yield* reschedule(flow.value.interval);
      return { status: "pending" } satisfies PollOutcome;
    case "SlowDown":
      yield* reschedule(
        Math.max(result.interval ?? 0, flow.value.interval + GithubClient.slowDownSeconds),
      );
      return { status: "slow_down" } satisfies PollOutcome;
    case "Expired":
      yield* store.remove(flowId);
      return yield* expired();
    case "Denied":
      yield* store.remove(flowId);
      return yield* new Errors.DeviceFlowDenied({ message: "The authorization was denied" });
    case "Authorized": {
      yield* store.remove(flowId);
      // A token GitHub just issued and rejects at once is not the client's fault.
      const account = yield* github.fetchUser(result.accessToken).pipe(Effect.orDie);
      const user = yield* SignIn.resolveUser(account, invite).pipe(Effect.orDie);
      if (Option.isNone(user)) {
        return yield* new Errors.LoginNotAllowed({
          message: "This GitHub account has no Stash account. Ask the owner for an invite.",
        });
      }
      const session = yield* StartSession.startSession(user.value.id, account.login).pipe(
        Effect.orDie,
      );
      return { status: "complete", session } satisfies PollOutcome;
    }
  }
});
