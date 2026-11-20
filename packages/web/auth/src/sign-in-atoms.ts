import * as SignInGroup from "@stash/contracts-api/sign-in";
import type * as Invite from "@stash/contracts-domain/invite";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as ApiBaseUrl from "@stash/web-api-client/api-base-url";
import { StashApiClient } from "@stash/web-api-client/stash-api-client";
import * as WebPlatform from "@stash/web-platform/live";
import * as Passkeys from "@stash/web-platform/passkeys";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";

// Signing in with a passkey or with Google (#178). The GitHub Device Flow is `device-login-atoms`.

/** Which buttons to show: Google only where it is configured. Passkeys always work. */
export const providers = ApiAtoms.query(["auth"], (client) => client.signIn.providers());

/**
 * The authenticator the passkey ceremonies use. Defaults to the browser's (`navigator.credentials`)
 * from `@stash/web-platform`. Tests replace it per registry through `initialValues`.
 */
export const passkeys: Atom.Writable<Layer.Layer<Passkeys.Passkeys>> = Atom.make(
  WebPlatform.layerPasskeys,
).pipe(Atom.keepAlive);

/**
 * How a passkey sign-in ended:
 *
 * - `signedIn`: the session cookie is set.
 * - `cancelled`: the sheet was closed (or held no passkey for this site). Nothing to say.
 * - `unknown`: the passkey is not one of this stash's (removed, or made for another account).
 * - `exists`: this device already has a passkey for the account (adding one).
 * - `unsupported`: this browser has no passkeys.
 * - `closed`: the invite can't be used any more.
 * - `rateLimited`: too many tries from this network; wait a minute.
 * - `failed`: anything else, such as no connection.
 */
export type PasskeyOutcome =
  | "signedIn"
  | "cancelled"
  | "unknown"
  | "exists"
  | "unsupported"
  | "closed"
  | "rateLimited"
  | "failed";

const fromPasskeyError = (error: Passkeys.PasskeyError): PasskeyOutcome => {
  switch (error.reason) {
    case "Cancelled":
      return "cancelled";
    case "Exists":
      return "exists";
    case "Unsupported":
      return "unsupported";
    case "Failed":
      return "failed";
  }
};

/** The answer for each way a ceremony can fail, for the page to show. */
export const outcomeOf = <A, R>(
  ceremony: Effect.Effect<A, unknown, R>,
): Effect.Effect<PasskeyOutcome, never, R> =>
  ceremony.pipe(
    Effect.as<PasskeyOutcome>("signedIn"),
    Effect.catch((error: unknown) => {
      const tag = (error as { readonly _tag?: unknown } | null)?._tag;
      if (tag === "PasskeyError") return Effect.succeed(fromPasskeyError(error as never));
      if (tag === "LoginNotAllowed") return Effect.succeed<PasskeyOutcome>("unknown");
      if (tag === "NotFound") return Effect.succeed<PasskeyOutcome>("closed");
      if (tag === "RateLimited") return Effect.succeed<PasskeyOutcome>("rateLimited");
      return Effect.succeed<PasskeyOutcome>("failed");
    }),
  );

/**
 * Signs in with a passkey: one button and no user name (the passkey says whose it is). The api
 * sends a challenge, the browser's sheet signs it, the api checks it and sets the session cookie.
 */
export const signInWithPasskey = StashApiClient.runtime.fn<void>()((_, get) =>
  outcomeOf(
    Effect.gen(function* () {
      const client = yield* StashApiClient;
      const authenticator = yield* Passkeys.Passkeys;
      const challenge = yield* client.signIn.passkeyOptions();
      const credential = yield* authenticator.get(challenge.options);
      yield* client.signIn.passkeySignIn({
        payload: { challengeId: challenge.challengeId, credential: credential as never },
      });
    }).pipe(Effect.provide(get(passkeys))),
  ),
);

/** Joins with an invite link by making a passkey for the new account on this device. */
export const signUpWithPasskey = StashApiClient.runtime.fn<Invite.InviteToken>()((invite, get) =>
  outcomeOf(
    Effect.gen(function* () {
      const client = yield* StashApiClient;
      const authenticator = yield* Passkeys.Passkeys;
      const challenge = yield* client.signIn.passkeySignUpOptions({ payload: { invite } });
      const credential = yield* authenticator.create(challenge.options);
      yield* client.signIn.passkeySignUp({
        payload: { challengeId: challenge.challengeId, invite, credential: credential as never },
      });
    }).pipe(Effect.provide(get(passkeys))),
  ),
);

/**
 * Where "Continue with Google" goes: the api's start route, a full navigation (Google's page is
 * another site), which comes back to `redirect` signed in.
 */
export const googleStartUrl = (options: {
  readonly invite?: Invite.InviteToken | undefined;
  readonly redirect?: string | undefined;
}): string => {
  const query = new URLSearchParams();
  if (options.invite !== undefined) query.set("invite", options.invite);
  if (options.redirect !== undefined && options.redirect !== "/") {
    query.set("redirect", options.redirect);
  }
  const search = query.toString();
  return `${ApiBaseUrl.fromEnv}/auth/google/start${search === "" ? "" : `?${search}`}`;
};

/** What the page says for a `?signin=` code the Google callback came back with. */
export const googleErrorText = (code: unknown): string | undefined => {
  switch (code as SignInGroup.GoogleCallbackError) {
    case "google_denied":
      return "Google sign-in was cancelled.";
    case "google_expired":
      return "The Google sign-in took too long or was started elsewhere. Try again.";
    case "google_not_allowed":
      return "This Google account has no account in this stash. Ask its owner for an invite link.";
    case "google_taken":
      return "This Google account already signs in another member of this stash.";
    case "google_failed":
      return "Google answered something unexpected. Try again.";
    default:
      return undefined;
  }
};

/** The query parameter of those codes. */
export const errorParam = SignInGroup.callbackErrorParam;
