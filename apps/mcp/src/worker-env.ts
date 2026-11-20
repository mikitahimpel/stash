import type * as ApiClient from "@stash/mcp-platform/api-client";

// Bindings and vars declared for the `Mcp` Worker in the root `alchemy.run.ts`. Keep the two in
// sync. Only the entry reads `env`.
export interface WorkerEnv extends ApiClient.ApiEnv {
  /** OAuth clients, grants and tokens. The provider requires exactly this binding name. */
  readonly OAUTH_KV: KVNamespace;
  /** Public origin of this Worker (`https://…`, or `http://localhost:<port>` in dev). */
  readonly MCP_ORIGIN: string;
  /**
   * The origin this Worker was reached at before it moved to `MCP_ORIGIN` (its `workers.dev`
   * address, on a stage with a custom domain). It keeps answering there for old connectors.
   */
  readonly MCP_LEGACY_ORIGIN?: string;
  /**
   * The web app's origin. When it is `MCP_ORIGIN` too (a custom domain), the sign-in pages use the
   * web app's sign-in (passkey, Google, GitHub) through its session cookie, with the GitHub Device
   * Flow as a fallback link; on other origins the Device Flow is the only way.
   */
  readonly WEB_ORIGIN?: string;
  /**
   * The GitHub OAuth App's client ID for the Device Flow. A plain var: it is public. Missing until
   * the app exists: the device flow sign-in then answers 503 (`login-not-configured.ts`), and only the web
   * sign-in remains, where there is one.
   */
  readonly GITHUB_CLIENT_ID?: string;
}
