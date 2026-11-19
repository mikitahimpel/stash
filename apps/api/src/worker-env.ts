import type * as AnthropicConfig from "@stash/backend-platform/anthropic-config";
import type * as GithubConfig from "@stash/backend-platform/github-config";
import type * as Live from "@stash/backend-platform/live";
import type * as StashConfig from "@stash/backend-platform/stash-config";

// Bindings and vars declared for the `Api` Worker in the root `alchemy.run.ts`. Keep the two in
// sync. Only the bindings the composed features use are declared. Vectorize and Workers AI have no
// local emulation in `alchemy dev` (see docs/alchemy.md), so only a deploy binds them: without
// them, semantic search fails and hybrid search answers with keyword results only. The Anthropic
// key is bound only on deploy too: without it, the enrichment consumer fails each message and the
// queue retries it. `GITHUB_CLIENT_ID` is missing until the GitHub OAuth app exists: the login
// routes then answer 503 (`login-not-configured.ts`). `LINK_EVENTS` is the Worker's own Durable
// Object class (`LinkEvents` in `worker.ts`): without it nothing is published and `GET /events`
// answers 503, so clients fall back to asking.
export interface WorkerEnv
  extends
    StashConfig.Env,
    Partial<GithubConfig.Env>,
    Partial<AnthropicConfig.Env>,
    Pick<Live.PlatformEnv, "DB" | "ENRICHMENT_QUEUE" | "KV">,
    Partial<Pick<Live.PlatformEnv, "VECTORS" | "AI" | "BLOBS" | "LINK_EVENTS">> {
  /**
   * The vector metadata property Vectorize indexes for filtering (`userId`). Set with `VECTORS`.
   * Nothing reads it: it is here so that the Worker is deployed after the metadata index exists
   * (see `alchemy.run.ts`).
   */
  readonly VECTORS_USER_PROPERTY?: string;
  /** `"on"` only under `alchemy dev`; enables the `/_smoke/*` routes. */
  readonly SMOKE_ROUTES: string;
}
