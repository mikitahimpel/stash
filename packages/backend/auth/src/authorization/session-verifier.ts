import type * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

/** A verified session: the principal the endpoints see, and the user whose stash it opens. */
export interface Verified {
  readonly principal: Security.UserPrincipal;
  readonly user: Security.CurrentUser["Service"];
}

/**
 * Checks the web session cookie. `Authorization` calls it when a request carries no valid bearer
 * token. The GitHub OAuth sessions provide the real implementation.
 */
export class SessionVerifier extends Context.Service<
  SessionVerifier,
  {
    /** Who the session cookie's value signs in, or `Unauthorized`. */
    readonly verify: (
      session: Redacted.Redacted<string>,
    ) => Effect.Effect<Verified, Errors.Unauthorized>;
  }
>()("@stash/backend-auth/SessionVerifier") {}

/** Rejects every session, so only API tokens authenticate. */
export const layerDenyAll: Layer.Layer<SessionVerifier> = Layer.succeed(SessionVerifier)({
  verify: () => Effect.fail(new Errors.Unauthorized({ message: "Sessions are not supported" })),
});
