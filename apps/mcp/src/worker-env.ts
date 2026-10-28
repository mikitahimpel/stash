import type * as ApiClient from "@stash/mcp-platform/api-client";

// Bindings and vars declared for the `Mcp` Worker in the root `alchemy.run.ts`. Keep the two in
// sync. Only the entry reads `env`.
export interface WorkerEnv extends ApiClient.ApiEnv {
  /** OAuth clients, grants and tokens. The provider requires exactly this binding name. */
  readonly OAUTH_KV: KVNamespace;
  /** Public origin of this Worker (`https://…`, or `http://localhost:<port>` in dev). */
  readonly MCP_ORIGIN: string;
  /** The GitHub OAuth App's client ID for the Device Flow. A plain var: it is public. */
  readonly GITHUB_CLIENT_ID: string;
  /** The only GitHub login that may authorize a client. */
  readonly ALLOWED_GITHUB_LOGIN: string;
}
