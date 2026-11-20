import { Schema } from "effect";

// How a person signs in (#178): passkeys, and accounts at Google and GitHub. A user may have
// several, and keeps at least one.

/** The ways to sign in. */
export const SignInMethod = Schema.Literals(["passkey", "google", "github"]);
export type SignInMethod = typeof SignInMethod.Type;

/** A provider whose account can be linked to a user. */
export const AccountProvider = Schema.Literals(["google", "github"]);
export type AccountProvider = typeof AccountProvider.Type;

/** A passkey's credential id, as base64url. */
export const PasskeyId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{16,1366}$/, {
      message: "Expected a base64url credential id",
    }),
  ),
  Schema.brand("PasskeyId"),
);
export type PasskeyId = typeof PasskeyId.Type;

/** What a passkey is called in Settings. */
export const PasskeyName = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
);

/** A passkey as its user lists it. The public key stays on the server. */
export const Passkey = Schema.Struct({
  id: PasskeyId,
  name: PasskeyName,
  createdAt: Schema.DateTimeUtcFromString,
  lastUsedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** Whether the passkey syncs (iCloud Keychain, Google Password Manager), so a lost phone keeps it. */
  synced: Schema.Boolean,
});
export type Passkey = typeof Passkey.Type;

/** Identifies a linked account: `<provider>:<the provider's id of the account>`. */
export const AccountId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(300)),
  Schema.brand("AccountId"),
);
export type AccountId = typeof AccountId.Type;

/**
 * An account at Google or GitHub that signs its user in. It is matched by the provider's id of
 * the account (Google's `sub`, GitHub's numeric id), never by the label.
 */
export const LinkedAccount = Schema.Struct({
  id: AccountId,
  provider: AccountProvider,
  /** What the provider calls the account (an e-mail address, a GitHub login), to show. */
  label: Schema.NullOr(Schema.String),
  /** `null` for the owner's GitHub login, which the deployment sets. */
  linkedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** The owner's GitHub login is set by the deployment (`ALLOWED_GITHUB_LOGIN`): never unlinked. */
  fixed: Schema.Boolean,
});
export type LinkedAccount = typeof LinkedAccount.Type;

/** Which providers this deployment has. Passkeys always work. */
export const SignInProviders = Schema.Struct({
  google: Schema.Boolean,
  github: Schema.Boolean,
});
export type SignInProviders = typeof SignInProviders.Type;

/** The signed-in user's ways to sign in, for Settings → Security. */
export const SignInMethods = Schema.Struct({
  passkeys: Schema.Array(Passkey),
  accounts: Schema.Array(LinkedAccount),
  providers: SignInProviders,
});
export type SignInMethods = typeof SignInMethods.Type;

/** How many ways to sign in a user has. The last one can't be removed. */
export const count = (methods: Pick<SignInMethods, "passkeys" | "accounts">): number =>
  methods.passkeys.length + methods.accounts.length;

/** A WebAuthn ceremony's options, as JSON for `navigator.credentials` (`create` or `get`). */
export const PasskeyOptions = Schema.JsonObject;
export type PasskeyOptions = typeof PasskeyOptions.Type;

/** Identifies one WebAuthn ceremony. Its challenge stays on the server, keyed by it. */
export const ChallengeId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,64}$/)),
  Schema.brand("ChallengeId"),
);
export type ChallengeId = typeof ChallengeId.Type;

/** A ceremony to run in the browser, then send back with its `challengeId`. */
export const PasskeyChallenge = Schema.Struct({
  challengeId: ChallengeId,
  options: PasskeyOptions,
});
export type PasskeyChallenge = typeof PasskeyChallenge.Type;

/**
 * What the browser's authenticator answered (`PublicKeyCredential.toJSON()`, a registration or an
 * authentication). The server checks everything in it.
 */
export const PasskeyCredential = Schema.Struct({
  id: Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(1366))),
  rawId: Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(1366))),
  type: Schema.Literal("public-key"),
  response: Schema.JsonObject,
  clientExtensionResults: Schema.JsonObject,
  authenticatorAttachment: Schema.optionalKey(Schema.String),
});
export type PasskeyCredential = typeof PasskeyCredential.Type;
