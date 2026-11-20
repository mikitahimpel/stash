import * as StashConfig from "@stash/backend-platform/stash-config";
import * as Effect from "effect/Effect";

/**
 * The WebAuthn relying party: the web app. Its id is the web origin's host (on prod the site's
 * own domain, which the MCP sign-in shares), and only that origin may run a ceremony.
 */
export interface RelyingParty {
  readonly id: string;
  readonly origin: string;
  readonly name: string;
}

export const name = "Stash";

export const relyingParty: Effect.Effect<RelyingParty, never, StashConfig.StashConfig> = Effect.map(
  Effect.service(StashConfig.StashConfig),
  (config) => {
    const origin = new URL(config.webOrigin);
    return { id: origin.hostname, origin: origin.origin, name };
  },
);
