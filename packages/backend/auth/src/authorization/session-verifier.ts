import type * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

/**
 * Checks the web session cookie. `Authorization` calls it when a request carries no valid bearer
 * token. The GitHub OAuth sessions provide the real implementation.
 */
export class SessionVerifier extends Context.Service<
  SessionVerifier,
  {
    /** The signed-in user for the session cookie's value, or `Unauthorized`. */
    readonly verify: (
      session: Redacted.Redacted<string>,
    ) => Effect.Effect<Security.UserPrincipal, Errors.Unauthorized>;
  }
>()("@stash/backend-auth/SessionVerifier") {}

/** Rejects every session, so only API tokens authenticate. */
export const layerDenyAll: Layer.Layer<SessionVerifier> = Layer.succeed(SessionVerifier)({
  verify: () => Effect.fail(new Errors.Unauthorized({ message: "Sessions are not supported" })),
});
