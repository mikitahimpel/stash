import * as Invite from "@stash/contracts-domain/invite";
import * as SignIn from "@stash/contracts-domain/sign-in";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as Auth from "./auth-group.ts";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

// Passkeys and Sign in with Google (#178), and the linked ways to sign in of a user. The GitHub
// Device Flow stays in `auth`.

/** Signed in. The response also sets the session cookie. */
export const SignedIn = Schema.Struct({ me: Security.UserPrincipal });
export type SignedIn = typeof SignedIn.Type;

export const PasskeySignIn = Schema.Struct({
  challengeId: SignIn.ChallengeId,
  credential: SignIn.PasskeyCredential,
});
export type PasskeySignIn = typeof PasskeySignIn.Type;

export const PasskeySignUpOptions = Schema.Struct({ invite: Invite.InviteToken });
export type PasskeySignUpOptions = typeof PasskeySignUpOptions.Type;

export const PasskeySignUp = Schema.Struct({
  challengeId: SignIn.ChallengeId,
  invite: Invite.InviteToken,
  credential: SignIn.PasskeyCredential,
  /** What the new member is called. Defaults to "Member". */
  displayName: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isMaxLength(100)))),
});
export type PasskeySignUp = typeof PasskeySignUp.Type;

export const AddPasskey = Schema.Struct({
  challengeId: SignIn.ChallengeId,
  credential: SignIn.PasskeyCredential,
  /** Defaults to a name from the authenticator, such as "iCloud Keychain", or "Passkey". */
  name: Schema.optionalKey(SignIn.PasskeyName),
});
export type AddPasskey = typeof AddPasskey.Type;

/**
 * Where to go once signed in: a path on the web origin (`/settings`, or the MCP sign-in's
 * `/authorize/session?state=…`). Anything else (another host, `//host`) opens the start page.
 */
export const ReturnPath = Schema.String.pipe(Schema.check(Schema.isMaxLength(2048)));

export const GoogleStart = Schema.Struct({
  /** An invite link's token: a Google account without a user signs up with it. */
  invite: Schema.optionalKey(Invite.InviteToken),
  redirect: Schema.optionalKey(ReturnPath),
});
export type GoogleStart = typeof GoogleStart.Type;

/** What Google sends back to the redirect URI. Other parameters are ignored. */
export const GoogleCallback = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export type GoogleCallback = typeof GoogleCallback.Type;

export const GoogleLink = Schema.Struct({ redirect: Schema.optionalKey(ReturnPath) });
export type GoogleLink = typeof GoogleLink.Type;

/** The Google page to open (a full navigation) to link the account. */
export const GoogleLinkStarted = Schema.Struct({ url: Schema.String });
export type GoogleLinkStarted = typeof GoogleLinkStarted.Type;

/** A device flow started with `auth.deviceStart`, to link its GitHub account. */
export const GithubLink = Schema.Struct({ flowId: Auth.DeviceFlowId });
export type GithubLink = typeof GithubLink.Type;

/** Where linking GitHub stands, like `DeviceFlowStatus`. `complete` carries the linked account. */
export const GithubLinkStatus = Schema.Union([
  Auth.DeviceFlowPending,
  Auth.DeviceFlowSlowDown,
  Schema.Struct({ status: Schema.Literal("complete"), account: SignIn.LinkedAccount }),
]);
export type GithubLinkStatus = typeof GithubLinkStatus.Type;

/** The error codes `googleCallback` puts on the page it returns to (`?signin=<code>`). */
export const GoogleCallbackError = Schema.Literals([
  /** Google said no, or the user cancelled. */
  "google_denied",
  /** The sign-in took too long, or ran in another browser. Start again. */
  "google_expired",
  /** The Google account has no user, and no invite came with it. */
  "google_not_allowed",
  /** The Google account already signs another user in. */
  "google_taken",
  /** Google answered something unexpected. */
  "google_failed",
]);
export type GoogleCallbackError = typeof GoogleCallbackError.Type;

/** The query parameter that carries a `GoogleCallbackError`. */
export const callbackErrorParam = "signin";

/**
 * Passkeys and Google:
 *
 * - **Open** (before a session exists, rate limited per client IP): `providers` (which buttons to
 *   show); signing in with a passkey (`passkeyOptions`, then `passkeySignIn` with the browser's
 *   answer; discoverable credentials, so no user name); signing up from an invite with a new
 *   passkey (`passkeySignUpOptions`, `passkeySignUp`; `NotFound` for an invite that cannot be
 *   accepted); and Google's authorization code flow with PKCE (`googleStart` redirects to Google,
 *   which returns to `googleCallback`, which sets the session cookie and redirects to the page the
 *   user wanted, or back to the login page with `?signin=<GoogleCallbackError>`). A Google
 *   account signs up only with an invite; the owner links theirs in Settings.
 * - **Guarded**, and only for a web session (`Forbidden` for an API token): Settings → Security.
 *   `methods` lists them; passkeys are added (`passkeyAddOptions`, `passkeyAdd`) and removed;
 *   Google and GitHub are linked (`googleLink`, then the same callback; `githubLink` polls a
 *   device flow from `auth.deviceStart`) and unlinked (`accountRemove`). The last way to sign in
 *   is never removed (`Conflict`), and an account that signs another user in is not linked
 *   (`Conflict`).
 *
 * Without `GOOGLE_CLIENT_ID` the Google routes answer 503 and `providers.google` is `false`.
 */
export class SignInGroup extends HttpApiGroup.make("signIn")
  .add(
    HttpApiEndpoint.get("providers", "/auth/providers", {
      success: SignIn.SignInProviders,
    }),
    HttpApiEndpoint.post("passkeyOptions", "/auth/passkey/options", {
      success: SignIn.PasskeyChallenge,
      error: ErrorStatuses.RateLimited,
    }),
    HttpApiEndpoint.post("passkeySignIn", "/auth/passkey/sign-in", {
      payload: PasskeySignIn,
      success: SignedIn,
      error: [ErrorStatuses.LoginNotAllowed, ErrorStatuses.RateLimited],
    }),
    HttpApiEndpoint.post("passkeySignUpOptions", "/auth/passkey/sign-up/options", {
      payload: PasskeySignUpOptions,
      success: SignIn.PasskeyChallenge,
      error: [ErrorStatuses.NotFound, ErrorStatuses.RateLimited],
    }),
    HttpApiEndpoint.post("passkeySignUp", "/auth/passkey/sign-up", {
      payload: PasskeySignUp,
      success: SignedIn,
      error: [ErrorStatuses.NotFound, ErrorStatuses.LoginNotAllowed, ErrorStatuses.RateLimited],
    }),
    HttpApiEndpoint.get("googleStart", "/auth/google/start", {
      query: GoogleStart,
      success: HttpApiSchema.Empty(302),
      error: ErrorStatuses.RateLimited,
    }),
    HttpApiEndpoint.get("googleCallback", "/auth/google/callback", {
      query: GoogleCallback,
      success: HttpApiSchema.Empty(302),
    }),
  )
  .add(
    HttpApiEndpoint.get("methods", "/auth/methods", {
      success: SignIn.SignInMethods,
      error: ErrorStatuses.Forbidden,
    }).middleware(Security.Authorization),
    HttpApiEndpoint.post("passkeyAddOptions", "/auth/passkeys/options", {
      success: SignIn.PasskeyChallenge,
      error: ErrorStatuses.Forbidden,
    }).middleware(Security.Authorization),
    HttpApiEndpoint.post("passkeyAdd", "/auth/passkeys", {
      payload: AddPasskey,
      success: SignIn.Passkey.pipe(HttpApiSchema.status(201)),
      error: [ErrorStatuses.Forbidden, ErrorStatuses.ValidationError, ErrorStatuses.Conflict],
    }).middleware(Security.Authorization),
    HttpApiEndpoint.delete("passkeyRemove", "/auth/passkeys/:id", {
      params: { id: SignIn.PasskeyId },
      success: HttpApiSchema.NoContent,
      error: [ErrorStatuses.Forbidden, ErrorStatuses.NotFound, ErrorStatuses.Conflict],
    }).middleware(Security.Authorization),
    HttpApiEndpoint.post("googleLink", "/auth/google/link", {
      payload: GoogleLink,
      success: GoogleLinkStarted,
      error: ErrorStatuses.Forbidden,
    }).middleware(Security.Authorization),
    HttpApiEndpoint.post("githubLink", "/auth/github/link", {
      payload: GithubLink,
      success: GithubLinkStatus,
      error: [
        ErrorStatuses.Forbidden,
        ErrorStatuses.DeviceFlowExpired,
        ErrorStatuses.DeviceFlowDenied,
        ErrorStatuses.Conflict,
      ],
    }).middleware(Security.Authorization),
    HttpApiEndpoint.delete("accountRemove", "/auth/accounts/:id", {
      params: { id: SignIn.AccountId },
      success: HttpApiSchema.NoContent,
      error: [ErrorStatuses.Forbidden, ErrorStatuses.NotFound, ErrorStatuses.Conflict],
    }).middleware(Security.Authorization),
  ) {}
