import type * as GithubOAuthConfig from "@stash/backend-platform/github-oauth-config";
import type * as Live from "@stash/backend-platform/live";
import type * as StashConfig from "@stash/backend-platform/stash-config";

// Bindings and vars declared for the `Api` Worker in the root `alchemy.run.ts`. Keep the two in
// sync. Only the bindings the composed features use are declared. Vectorize and Workers AI have no
// local emulation in `alchemy dev` (see docs/alchemy.md), so they are optional and not declared in
// `alchemy.run.ts` yet: without them, semantic search fails and hybrid search answers with keyword
// results only.
export interface WorkerEnv
  extends
    StashConfig.Env,
    GithubOAuthConfig.Env,
    Pick<Live.PlatformEnv, "DB" | "ENRICHMENT_QUEUE">,
    Partial<Pick<Live.PlatformEnv, "VECTORS" | "AI">> {
  /** `"on"` only under `alchemy dev`; enables the `/_smoke/*` routes. */
  readonly SMOKE_ROUTES: string;
}
