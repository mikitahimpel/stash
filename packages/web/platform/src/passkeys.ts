import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** A WebAuthn ceremony's options or answer, as the JSON the api sends and takes. */
export type Json = { readonly [key: string]: unknown };

/**
 * Why a passkey ceremony failed:
 * - `Unsupported`: this browser has no WebAuthn.
 * - `Cancelled`: the user closed the sheet, or no passkey was there (the browser does not say
 *   which, on purpose).
 * - `Exists`: the authenticator already holds a passkey for this account.
 * - `Failed`: anything else.
 */
export type PasskeyErrorReason = "Unsupported" | "Cancelled" | "Exists" | "Failed";

export class PasskeyError extends Data.TaggedError("PasskeyError")<{
  readonly reason: PasskeyErrorReason;
  readonly cause?: unknown;
}> {}

/** Face ID, Touch ID or a security key, through `navigator.credentials`. */
export class Passkeys extends Context.Service<
  Passkeys,
  {
    readonly supported: Effect.Effect<boolean>;
    /** Makes a passkey (`navigator.credentials.create`) for creation options from the api. */
    readonly create: (options: Json) => Effect.Effect<Json, PasskeyError>;
    /** Signs a challenge with a passkey (`navigator.credentials.get`). */
    readonly get: (options: Json) => Effect.Effect<Json, PasskeyError>;
  }
>()("@stash/web-platform/Passkeys") {}

const reasonOf = (cause: unknown): PasskeyErrorReason => {
  const name = cause instanceof Error ? cause.name : "";
  const code = (cause as { readonly code?: unknown } | null)?.code;
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || name === "InvalidStateError") {
    return "Exists";
  }
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") {
    return "Cancelled";
  }
  if (name === "NotSupportedError") return "Unsupported";
  return "Failed";
};

const ceremony = (run: () => Promise<unknown>) =>
  Effect.suspend(() =>
    browserSupportsWebAuthn()
      ? Effect.tryPromise({
          try: run,
          catch: (cause) => new PasskeyError({ reason: reasonOf(cause), cause }),
        }).pipe(Effect.map((answer) => JSON.parse(JSON.stringify(answer)) as Json))
      : Effect.fail(new PasskeyError({ reason: "Unsupported" })),
  );

/** The live service, backed by `@simplewebauthn/browser`. */
export const layer: Layer.Layer<Passkeys> = Layer.succeed(Passkeys)({
  supported: Effect.sync(browserSupportsWebAuthn),
  create: (options) => ceremony(() => startRegistration({ optionsJSON: options as never })),
  get: (options) => ceremony(() => startAuthentication({ optionsJSON: options as never })),
});
