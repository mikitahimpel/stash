import * as GoogleConfig from "@stash/backend-platform/google-config";
import * as StashConfig from "@stash/backend-platform/stash-config";
import * as AcceptInvite from "@stash/backend-users/accept-invite";
import * as SecretHash from "@stash/backend-users/secret-hash";
import * as UsersRepo from "@stash/backend-users/users-repo";
import type * as Security from "@stash/contracts-api/security";
import * as SignInGroup from "@stash/contracts-api/sign-in";
import * as Invite from "@stash/contracts-domain/invite";
import type * as User from "@stash/contracts-domain/user";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as ReturnPath from "../sign-in/return-path.ts";
import * as StartSession from "../sessions/start-session.ts";
import * as GoogleClient from "./google-client.ts";
import * as GoogleFlowsStore from "./google-flows-store.ts";

// Sign in with Google on the web origin: `start` sends the browser to Google with a fresh state,
// PKCE challenge and nonce, and binds the flow to that browser with a cookie; Google sends it
// back to `callback`, which checks the state and the cookie, exchanges the code, verifies the ID
// token, and then signs the account's user in (or links the account, when a signed-in user asked
// for that). A Google account without a user signs up only with an invite. Every outcome is a
// redirect: to the page the user wanted, or back with `?signin=<GoogleCallbackError>`.

/** The cookie that binds a started flow to its browser. */
export const bindingCookieName = "stash_google";

/** The redirect URI registered at Google: the api's callback, on the web origin under `/api`. */
export const redirectUri = (webOrigin: string) => `${webOrigin}/api/auth/google/callback`;

/** Enough to know the account and show its address. */
export const scope = "openid email";

const random = () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) => Base64Url.encode(new Uint8Array(digest))),
  );

/** What a started flow is for. */
export interface StartOptions {
  readonly redirect?: string | undefined;
  readonly invite?: Invite.InviteToken | undefined;
  readonly linkUserId?: User.UserId | undefined;
}

/** Starts a flow: the Google URL to open, and the binding cookie's value to set. */
export const start = Effect.fn("googleStart")(function* (options: StartOptions) {
  const config = yield* GoogleConfig.GoogleConfig;
  const stash = yield* StashConfig.StashConfig;
  const store = yield* GoogleFlowsStore.GoogleFlowsStore;
  if (!config.configured) return yield* Effect.die("Google sign-in is not configured");

  const state = random();
  const verifier = random();
  const nonce = random();
  const binding = random();
  const fallback = options.linkUserId === undefined ? "/" : "/settings#security";
  const redirect = ReturnPath.sanitize(options.redirect);
  yield* store.put(state, {
    verifier,
    nonce,
    bindingHash: yield* SecretHash.hash(binding),
    redirect: redirect === "/" ? fallback : redirect,
    ...(options.invite === undefined ? {} : { invite: options.invite }),
    ...(options.linkUserId === undefined ? {} : { linkUserId: options.linkUserId }),
  });
  const url = new URL(config.endpoints.authorization);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri(stash.webOrigin),
    scope,
    state,
    nonce,
    code_challenge: yield* sha256(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { location: url.toString(), binding: Redacted.make(binding) };
});

/** Where a callback sends the browser, and the session it starts, if it signed someone in. */
export interface Outcome {
  readonly location: string;
  readonly session?: Effect.Success<ReturnType<typeof StartSession.startSession>>;
}

const withError = (page: string, code: SignInGroup.GoogleCallbackError) =>
  ReturnPath.withParam(page, SignInGroup.callbackErrorParam, code);

/** The page a failed flow returns to: Settings for a link, the invite or login page otherwise. */
const pageFor = (flow: GoogleFlowsStore.StoredGoogleFlow | undefined) => {
  if (flow?.linkUserId !== undefined) return "/settings";
  if (flow?.invite !== undefined) return `${Invite.invitePath}${flow.invite}`;
  if (flow !== undefined && flow.redirect !== "/") {
    return ReturnPath.withParam("/login", "redirect", flow.redirect);
  }
  return "/login";
};

/** The user a verified Google account signs in as, if any (an invite may create one). */
const resolveUser = (account: GoogleClient.GoogleAccount, invite: Invite.InviteToken | undefined) =>
  Effect.gen(function* () {
    const users = yield* UsersRepo.UsersRepo;
    const known = yield* users.findByIdentity("google", account.sub);
    if (Option.isSome(known)) {
      return Option.some<Security.CurrentUser["Service"]>({
        id: known.value.id,
        role: known.value.role,
      });
    }
    if (invite === undefined) return Option.none();
    const created = yield* AcceptInvite.acceptInvite(invite, {
      provider: "google",
      subject: account.sub,
      label: account.email ?? "",
    });
    if (Option.isSome(created)) yield* Effect.log(`members: ${created.value.id} joined by invite`);
    return Option.map(created, (user) => ({ id: user.id, role: user.role }));
  });

/** Finishes a flow. Never fails: every outcome is a redirect. */
export const callback = Effect.fn("googleCallback")(function* (
  query: SignInGroup.GoogleCallback,
  binding: string | undefined,
) {
  const stash = yield* StashConfig.StashConfig;
  const store = yield* GoogleFlowsStore.GoogleFlowsStore;
  const google = yield* GoogleClient.GoogleClient;
  const users = yield* UsersRepo.UsersRepo;

  const stored = query.state === undefined ? Option.none() : yield* store.take(query.state);
  if (Option.isNone(stored)) return { location: withError("/login", "google_expired") };
  const flow = stored.value;
  const failed = (code: SignInGroup.GoogleCallbackError): Outcome => ({
    location: withError(pageFor(flow), code),
  });
  // Started in another browser (or the cookie is gone): never sign this one in with it.
  if (binding === undefined || (yield* SecretHash.hash(binding)) !== flow.bindingHash) {
    return failed("google_expired");
  }
  if (query.error !== undefined || query.code === undefined) return failed("google_denied");

  const account = yield* google
    .exchangeCode({
      code: query.code,
      verifier: Redacted.make(flow.verifier),
      redirectUri: redirectUri(stash.webOrigin),
    })
    .pipe(
      Effect.flatMap((idToken) => google.verifyIdToken(idToken, flow.nonce)),
      Effect.tapError((error) => Effect.logWarning(`google sign-in: ${error.reason}`)),
      Effect.result,
    );
  if (Result.isFailure(account)) return failed("google_failed");

  if (flow.linkUserId !== undefined) {
    const identity = {
      provider: "google" as const,
      subject: account.success.sub,
      label: account.success.email ?? "",
    };
    const linked = yield* users
      .linkIdentity(flow.linkUserId, identity, yield* DateTime.now)
      .pipe(Effect.orDie);
    if (!linked) {
      const owner = yield* users.findByIdentity("google", identity.subject).pipe(Effect.orDie);
      const mine = Option.isSome(owner) && owner.value.id === flow.linkUserId;
      if (!mine) return failed("google_taken");
    }
    return { location: flow.redirect } satisfies Outcome;
  }

  const user = yield* resolveUser(account.success, flow.invite).pipe(Effect.orDie);
  if (Option.isNone(user)) return failed("google_not_allowed");
  const session = yield* StartSession.startSession(user.value.id, { method: "google" }).pipe(
    Effect.orDie,
  );
  return { location: flow.redirect, session } satisfies Outcome;
});
