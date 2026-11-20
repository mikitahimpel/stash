import * as GithubConfig from "@stash/backend-platform/github-config";
import * as GoogleConfig from "@stash/backend-platform/google-config";
import * as StashConfig from "@stash/backend-platform/stash-config";
import * as UsersRepo from "@stash/backend-users/users-repo";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as SignIn from "@stash/contracts-domain/sign-in";
import * as Effect from "effect/Effect";
import * as PasskeysRepo from "../passkeys/passkeys-repo.ts";

// The ways a user signs in, for Settings → Security: their passkeys and linked accounts. The
// owner also always has the allowlisted GitHub login, which the deployment sets: it is listed as
// `fixed` and never removed, so the owner can always remove anything else. Anyone else keeps at
// least one way: removing the last is `Conflict`.

/** The account id of a linked account. */
export const accountId = (provider: SignIn.AccountProvider, subject: string): SignIn.AccountId =>
  SignIn.AccountId.make(`${provider}:${subject}`);

/** The owner's GitHub login, set by `ALLOWED_GITHUB_LOGIN`. */
export const ownerGithubId = accountId("github", "allowlisted");

const parseAccountId = (id: SignIn.AccountId) => {
  const at = id.indexOf(":");
  const provider = id.slice(0, at);
  const subject = id.slice(at + 1);
  return at > 0 && (provider === "google" || provider === "github") && subject !== ""
    ? { provider: provider as SignIn.AccountProvider, subject }
    : undefined;
};

/** Which providers this deployment has. */
export const providers = Effect.gen(function* () {
  const google = yield* GoogleConfig.GoogleConfig;
  const github = yield* GithubConfig.GithubConfig;
  return {
    google: google.configured,
    github: github.clientId !== "",
  } satisfies SignIn.SignInProviders;
});

/** The current user's ways to sign in. */
export const list = Effect.gen(function* () {
  const current = yield* Security.CurrentUser;
  const users = yield* UsersRepo.UsersRepo;
  const passkeys = yield* PasskeysRepo.PasskeysRepo;
  const config = yield* StashConfig.StashConfig;
  const identities = yield* users.listIdentities(current.id).pipe(Effect.orDie);
  const accounts: Array<SignIn.LinkedAccount> = identities.map((identity) => ({
    id: accountId(identity.provider, identity.subject),
    provider: identity.provider,
    label: identity.label === null || identity.label === "" ? null : identity.label,
    linkedAt: identity.createdAt,
    fixed: false,
  }));
  if (current.role === "owner") {
    accounts.unshift({
      id: ownerGithubId,
      provider: "github",
      label: config.allowedGithubLogin,
      linkedAt: null,
      fixed: true,
    });
  }
  return {
    passkeys: (yield* passkeys.list.pipe(Effect.orDie)).map(PasskeysRepo.toPasskey),
    accounts,
    providers: yield* providers,
  } satisfies SignIn.SignInMethods;
}).pipe(Effect.withSpan("listSignInMethods"));

const lastMethod = () =>
  new Errors.Conflict({ message: "This is your last way to sign in. Add another one first." });

/** Removes a passkey of the current user, unless it is their last way to sign in. */
export const removePasskey = Effect.fn("removePasskey")(function* (id: SignIn.PasskeyId) {
  const methods = yield* list;
  if (!methods.passkeys.some((passkey) => passkey.id === id)) {
    return yield* new Errors.NotFound({ resource: "passkey", id });
  }
  if (SignIn.count(methods) <= 1) return yield* lastMethod();
  const passkeys = yield* PasskeysRepo.PasskeysRepo;
  if (!(yield* passkeys.remove(id).pipe(Effect.orDie))) {
    return yield* new Errors.NotFound({ resource: "passkey", id });
  }
});

/** Unlinks an account of the current user, unless it is fixed or their last way to sign in. */
export const removeAccount = Effect.fn("removeAccount")(function* (id: SignIn.AccountId) {
  const current = yield* Security.CurrentUser;
  const methods = yield* list;
  const account = methods.accounts.find((candidate) => candidate.id === id);
  const parsed = parseAccountId(id);
  if (account === undefined || parsed === undefined) {
    return yield* new Errors.NotFound({ resource: "account", id });
  }
  if (account.fixed) {
    return yield* new Errors.Conflict({
      message: "The owner's GitHub login is set by the deployment",
    });
  }
  if (SignIn.count(methods) <= 1) return yield* lastMethod();
  const users = yield* UsersRepo.UsersRepo;
  if (
    !(yield* users.unlinkIdentity(current.id, parsed.provider, parsed.subject).pipe(Effect.orDie))
  ) {
    return yield* new Errors.NotFound({ resource: "account", id });
  }
});
