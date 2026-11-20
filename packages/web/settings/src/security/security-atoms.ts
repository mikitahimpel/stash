import type * as AuthGroup from "@stash/contracts-api/auth";
import * as SignIn from "@stash/contracts-domain/sign-in";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import { StashApiClient } from "@stash/web-api-client/stash-api-client";
import * as WebPlatform from "@stash/web-platform/live";
import * as PageNavigation from "@stash/web-platform/page-navigation";
import * as Passkeys from "@stash/web-platform/passkeys";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Stream from "effect/Stream";

// Settings → Security (#178): the signed-in user's ways to sign in. Passkeys are added on this
// device and removed; Google and GitHub accounts are linked and unlinked. The last way in is
// never removed (the api answers `Conflict`, and the buttons say so before).

/** Passkeys, linked accounts, and which providers this deployment has. */
export const methods = ApiAtoms.query(["signIn"], (client) => client.signIn.methods());

/** How many ways to sign in the user has. */
export const count = SignIn.count;

/** The authenticator to add passkeys with. Tests replace it per registry (`initialValues`). */
export const passkeys: Atom.Writable<Layer.Layer<Passkeys.Passkeys>> = Atom.make(
  WebPlatform.layerPasskeys,
).pipe(Atom.keepAlive);

/** How adding a passkey ended. */
export type AddOutcome = "added" | "cancelled" | "exists" | "unsupported" | "failed";

/** Makes a passkey on this device (Face ID, Touch ID, a security key) for the signed-in user. */
export const addPasskey = StashApiClient.runtime.fn<void>()((_, get) =>
  Effect.gen(function* () {
    const client = yield* StashApiClient;
    const authenticator = yield* Passkeys.Passkeys;
    const challenge = yield* client.signIn.passkeyAddOptions();
    const credential = yield* authenticator.create(challenge.options);
    yield* client.signIn.passkeyAdd({
      payload: { challengeId: challenge.challengeId, credential: credential as never },
    });
    return "added" as AddOutcome;
  }).pipe(
    Reactivity.mutation(["signIn"]),
    Effect.provide(get(passkeys)),
    Effect.catch((error: unknown) => {
      const reason = (error as { readonly reason?: unknown } | null)?.reason;
      const tag = (error as { readonly _tag?: unknown } | null)?._tag;
      if (tag === "PasskeyError" && reason === "Cancelled")
        return Effect.succeed<AddOutcome>("cancelled");
      if ((tag === "PasskeyError" && reason === "Exists") || tag === "Conflict") {
        return Effect.succeed<AddOutcome>("exists");
      }
      if (tag === "PasskeyError" && reason === "Unsupported") {
        return Effect.succeed<AddOutcome>("unsupported");
      }
      return Effect.succeed<AddOutcome>("failed");
    }),
  ),
);

export const removePasskey = ApiAtoms.mutation(["signIn"], (client, id: SignIn.PasskeyId) =>
  client.signIn.passkeyRemove({ params: { id } }),
);

export const removeAccount = ApiAtoms.mutation(["signIn"], (client, id: SignIn.AccountId) =>
  client.signIn.accountRemove({ params: { id } }),
);

/** Leaves for Google's page to link the account; it comes back to Settings. */
export const linkGoogle = ApiAtoms.mutation([], (client) =>
  client.signIn
    .googleLink({ payload: { redirect: "/settings" } })
    .pipe(Effect.tap(({ url }) => Effect.sync(() => PageNavigation.navigateTo(url)))),
);

/**
 * Linking GitHub with the Device Flow, as the login page signs in: `waiting` shows the code,
 * then `linked`, or `taken` when the account signs another user in, or `expired`.
 */
export type GithubLink =
  | {
      readonly step: "waiting";
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresAt: number;
    }
  | { readonly step: "linked" }
  | { readonly step: "taken" }
  | { readonly step: "expired" };

const end = (link: GithubLink) => [[link], Option.none<number>()] as const;

/** Starts a device flow and polls `githubLink` until it ends. Writing it again starts over. */
export const linkGithub = StashApiClient.runtime.fn<void>()(() =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* StashApiClient;
      const started = yield* client.auth.deviceStart();
      const expiresAt = (yield* Clock.currentTimeMillis) + started.expiresIn * 1000;
      const flowId: AuthGroup.DeviceFlowId = started.flowId;
      const poll = Stream.paginate(started.interval, (interval) =>
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.seconds(interval));
          if ((yield* Clock.currentTimeMillis) >= expiresAt) return end({ step: "expired" });
          const status = yield* client.signIn.githubLink({ payload: { flowId } });
          switch (status.status) {
            case "pending":
              return [[], Option.some(interval)] as const;
            case "slow_down":
              return [[], Option.some(interval + 5)] as const;
            case "complete":
              return end({ step: "linked" });
          }
        }).pipe(
          Effect.catchTags({
            DeviceFlowExpired: () => Effect.succeed(end({ step: "expired" })),
            DeviceFlowDenied: () => Effect.succeed(end({ step: "expired" })),
            Conflict: () => Effect.succeed(end({ step: "taken" })),
          }),
        ),
      );
      return Stream.concat(
        Stream.succeed<GithubLink>({
          step: "waiting",
          userCode: started.userCode,
          verificationUri: started.verificationUri,
          expiresAt,
        }),
        poll,
      );
    }),
  ).pipe(
    Stream.tap((link) =>
      link.step === "linked" ? Reactivity.invalidate(["signIn"]) : Effect.void,
    ),
  ),
);
