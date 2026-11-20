import * as AcceptInvite from "@stash/backend-users/accept-invite";
import * as SecretHash from "@stash/backend-users/secret-hash";
import * as UsersRepo from "@stash/backend-users/users-repo";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import type * as Invite from "@stash/contracts-domain/invite";
import * as SignIn from "@stash/contracts-domain/sign-in";
import * as User from "@stash/contracts-domain/user";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as PasskeyChallenges from "./passkey-challenges.ts";
import * as PasskeysRepo from "./passkeys-repo.ts";
import * as RelyingParty from "./relying-party.ts";

// The WebAuthn ceremonies, with `@simplewebauthn/server` checking every answer (challenge, origin,
// RP id, signature, counter). Passkeys are discoverable credentials, so signing in needs no user
// name: the authenticator offers its passkeys for this site, and the answer names the credential.
// Attestation is not asked for (`none`): which authenticator made a passkey does not matter here.

/** ES256 and RS256: what every platform authenticator signs with. */
export const algorithms = [-7, -257];

/** Milliseconds the browser waits for the user. */
export const timeout = 120_000;

const notAllowed = (message = "That passkey doesn't open an account here") =>
  new Errors.LoginNotAllowed({ message });

/** A verification that threw (a malformed answer) is a failed one. */
const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => "invalid" as const });

const userHandle = (id: User.UserId) => new TextEncoder().encode(id) as Uint8Array<ArrayBuffer>;

const transportsOf = (credential: SignIn.PasskeyCredential): string | null => {
  const transports = credential.response["transports"];
  return Array.isArray(transports) && transports.every((value) => typeof value === "string")
    ? JSON.stringify(transports)
    : null;
};

const parseTransports = (value: string | null): Array<string> | undefined => {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : undefined;
  } catch {
    return undefined;
  }
};

/** Options as plain JSON: the library leaves unset fields `undefined`, which JSON has not. */
const asJson = (options: object): SignIn.PasskeyOptions =>
  JSON.parse(JSON.stringify(options)) as SignIn.PasskeyOptions;

/** A name for a new passkey when the browser sent none. */
const defaultName = (synced: boolean) => (synced ? "Synced passkey" : "Passkey");

// Verifies a registration answer against a stored challenge. `None` if it does not hold.
const verifyRegistration = (credential: SignIn.PasskeyCredential, challenge: string) =>
  Effect.gen(function* () {
    const rp = yield* RelyingParty.relyingParty;
    const verified = yield* attempt(() =>
      verifyRegistrationResponse({
        response: credential as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: true,
        supportedAlgorithmIDs: algorithms,
      }),
    ).pipe(Effect.result);
    if (Result.isFailure(verified) || !verified.success.verified) return Option.none();
    const info = verified.success.registrationInfo;
    const id = SignIn.PasskeyId.make(info.credential.id);
    return Option.some({
      id,
      publicKey: Base64Url.encode(info.credential.publicKey),
      counter: info.credential.counter,
      transports: transportsOf(credential),
      synced: info.credentialBackedUp && info.credentialDeviceType === "multiDevice",
    });
  });

const registrationOptions = (user: {
  readonly id: User.UserId;
  readonly name: string;
  readonly exclude?: ReadonlyArray<PasskeysRepo.StoredPasskey>;
}) =>
  Effect.gen(function* () {
    const rp = yield* RelyingParty.relyingParty;
    return yield* Effect.promise(() =>
      generateRegistrationOptions({
        rpName: rp.name,
        rpID: rp.id,
        userID: userHandle(user.id),
        userName: user.name,
        userDisplayName: user.name,
        timeout,
        attestationType: "none",
        excludeCredentials: (user.exclude ?? []).map((passkey) => ({
          id: passkey.id,
          ...(parseTransports(passkey.transports) === undefined
            ? {}
            : { transports: parseTransports(passkey.transports)! }),
        })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        supportedAlgorithmIDs: algorithms,
      }),
    );
  });

/** Options to sign in with any passkey of this site. */
export const signInOptions = Effect.fn("passkeySignInOptions")(function* () {
  const rp = yield* RelyingParty.relyingParty;
  const challenges = yield* PasskeyChallenges.PasskeyChallenges;
  const options = yield* Effect.promise(() =>
    generateAuthenticationOptions({ rpID: rp.id, timeout, userVerification: "required" }),
  );
  const challengeId = yield* challenges.put({ kind: "sign-in", challenge: options.challenge });
  return { challengeId, options: asJson(options) };
});

/**
 * The user a passkey sign-in opens, after checking the answer against its challenge and the
 * stored public key, and recording the use. `LoginNotAllowed` for an unknown passkey, a
 * challenge that is gone, or an answer that does not verify.
 */
export const signIn = Effect.fn("passkeySignIn")(function* (
  challengeId: SignIn.ChallengeId,
  credential: SignIn.PasskeyCredential,
) {
  const rp = yield* RelyingParty.relyingParty;
  const challenges = yield* PasskeyChallenges.PasskeyChallenges;
  const repo = yield* PasskeysRepo.PasskeysRepo;
  const users = yield* UsersRepo.UsersRepo;

  const challenge = yield* challenges.take(challengeId);
  if (Option.isNone(challenge) || challenge.value.kind !== "sign-in") {
    return yield* notAllowed("The sign-in took too long. Try again.");
  }
  const stored = yield* repo.find(credential.id).pipe(Effect.orDie);
  if (Option.isNone(stored)) return yield* notAllowed();
  const passkey = stored.value;
  const publicKey = Base64Url.decode(passkey.publicKey);
  if (Result.isFailure(publicKey)) return yield* Effect.die("stored public key is not base64url");
  const transports = parseTransports(passkey.transports);
  const verified = yield* attempt(() =>
    verifyAuthenticationResponse({
      response: credential as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.value.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: passkey.id,
        publicKey: publicKey.success as Uint8Array<ArrayBuffer>,
        counter: passkey.counter,
        ...(transports === undefined ? {} : { transports: transports as never }),
      },
      requireUserVerification: true,
    }),
  ).pipe(Effect.result);
  if (Result.isFailure(verified) || !verified.success.verified) return yield* notAllowed();

  yield* repo
    .touch(passkey, verified.success.authenticationInfo.newCounter, yield* DateTime.now)
    .pipe(Effect.orDie);
  const user = yield* users.findById(passkey.userId).pipe(Effect.orDie);
  if (Option.isNone(user)) return yield* notAllowed();
  return { id: user.value.id, role: user.value.role } satisfies Security.CurrentUser["Service"];
});

/**
 * Options to sign up from an invite with a new passkey. The member's id is chosen now (it is the
 * passkey's user handle) and kept with the challenge, with the invite. `NotFound` for an invite
 * that cannot be accepted.
 */
export const signUpOptions = Effect.fn("passkeySignUpOptions")(function* (
  invite: Invite.InviteToken,
) {
  const challenges = yield* PasskeyChallenges.PasskeyChallenges;
  const open = yield* AcceptInvite.findOpenInvite(invite).pipe(Effect.orDie);
  if (Option.isNone(open)) return yield* new Errors.NotFound({ resource: "invite", id: "" });
  const userId = User.UserId.make(crypto.randomUUID());
  const options = yield* registrationOptions({ id: userId, name: "Stash" });
  const challengeId = yield* challenges.put({
    kind: "sign-up",
    challenge: options.challenge,
    userId,
    inviteHash: yield* SecretHash.hash(invite),
  });
  return { challengeId, options: asJson(options) };
});

/**
 * Signs a new member up from an invite with the passkey they just made: the member, their passkey
 * and the used invite are written in one transaction. `NotFound` if the invite can no longer be
 * accepted, `LoginNotAllowed` if the answer does not verify or the passkey exists already.
 */
export const signUp = Effect.fn("passkeySignUp")(function* (
  challengeId: SignIn.ChallengeId,
  invite: Invite.InviteToken,
  credential: SignIn.PasskeyCredential,
  displayName: string | undefined,
) {
  const challenges = yield* PasskeyChallenges.PasskeyChallenges;
  const repo = yield* PasskeysRepo.PasskeysRepo;
  const challenge = yield* challenges.take(challengeId);
  if (
    Option.isNone(challenge) ||
    challenge.value.kind !== "sign-up" ||
    challenge.value.inviteHash !== (yield* SecretHash.hash(invite))
  ) {
    return yield* notAllowed("The sign-up took too long. Try again.");
  }
  const { userId } = challenge.value;
  const made = yield* verifyRegistration(credential, challenge.value.challenge);
  if (Option.isNone(made)) return yield* notAllowed("The passkey could not be checked.");
  if (Option.isSome(yield* repo.find(made.value.id).pipe(Effect.orDie))) {
    return yield* notAllowed("That passkey already opens an account. Sign in with it.");
  }
  const now = yield* DateTime.now;
  const user = yield* AcceptInvite.acceptInvite(invite, {
    id: userId,
    displayName: displayName ?? "",
    also: (id) => [
      PasskeysRepo.insertStatement({
        ...made.value,
        userId: id,
        name: defaultName(made.value.synced),
        createdAt: now,
      }),
    ],
  }).pipe(Effect.orDie);
  if (Option.isNone(user)) return yield* new Errors.NotFound({ resource: "invite", id: "" });
  yield* Effect.log(`members: ${user.value.id} joined by invite with a passkey`);
  return { id: user.value.id, role: user.value.role } satisfies Security.CurrentUser["Service"];
});

/** Options to add a passkey to the current user. Their passkeys are excluded. */
export const addOptions = Effect.fn("passkeyAddOptions")(function* () {
  const current = yield* Security.CurrentUser;
  const challenges = yield* PasskeyChallenges.PasskeyChallenges;
  const repo = yield* PasskeysRepo.PasskeysRepo;
  const users = yield* UsersRepo.UsersRepo;
  const user = yield* users.findById(current.id).pipe(Effect.orDie);
  const name = Option.match(user, { onNone: () => "Stash", onSome: (u) => u.displayName });
  const options = yield* registrationOptions({
    id: current.id,
    name,
    exclude: yield* repo.list.pipe(Effect.orDie),
  });
  const challengeId = yield* challenges.put({
    kind: "add",
    challenge: options.challenge,
    userId: current.id,
  });
  return { challengeId, options: asJson(options) };
});

/**
 * Adds the passkey just made to the current user. `ValidationError` if the challenge is gone or
 * was made for someone else, or the answer does not verify; `Conflict` if the passkey exists.
 */
export const add = Effect.fn("passkeyAdd")(function* (
  challengeId: SignIn.ChallengeId,
  credential: SignIn.PasskeyCredential,
  name: string | undefined,
) {
  const current = yield* Security.CurrentUser;
  const challenges = yield* PasskeyChallenges.PasskeyChallenges;
  const repo = yield* PasskeysRepo.PasskeysRepo;
  const challenge = yield* challenges.take(challengeId);
  if (
    Option.isNone(challenge) ||
    challenge.value.kind !== "add" ||
    challenge.value.userId !== current.id
  ) {
    return yield* new Errors.ValidationError({ message: "The passkey took too long. Try again." });
  }
  const made = yield* verifyRegistration(credential, challenge.value.challenge);
  if (Option.isNone(made)) {
    return yield* new Errors.ValidationError({ message: "The passkey could not be checked." });
  }
  const createdAt = yield* DateTime.now;
  const passkey = { ...made.value, name: name ?? defaultName(made.value.synced), createdAt };
  if (!(yield* repo.insert(passkey).pipe(Effect.orDie))) {
    return yield* new Errors.Conflict({ message: "This passkey is already added" });
  }
  return PasskeysRepo.toPasskey({ ...passkey, userId: current.id, lastUsedAt: null });
});
