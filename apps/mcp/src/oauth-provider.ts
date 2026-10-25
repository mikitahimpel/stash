import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Layer } from "effect";
import type * as GitHub from "./github-identity.ts";
import * as McpServer from "./mcp-server.ts";
import * as OAuthHandler from "./oauth-handler.ts";
import type { WorkerEnv } from "./worker-env.ts";

/** The provider adds its helpers to the `env` its `defaultHandler` sees. */
export type ProviderEnv = WorkerEnv & { readonly OAUTH_PROVIDER: OAuthHelpers };

export interface Options {
  readonly env: Pick<WorkerEnv, "MCP_ORIGIN" | "ALLOWED_GITHUB_LOGIN">;
  /** Serves an authenticated MCP request. */
  readonly mcp: (request: Request) => Promise<Response>;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
}

/**
 * The Worker's `fetch`: OAuth 2.1 metadata, dynamic client registration and tokens from
 * `@cloudflare/workers-oauth-provider`, the bearer check on `/mcp`, and the GitHub sign-in pages.
 */
export const make = ({ env, mcp, github }: Options) => {
  const origin = new URL(env.MCP_ORIGIN).origin;
  const handleOAuth = OAuthHandler.make({
    origin,
    allowedLogin: env.ALLOWED_GITHUB_LOGIN,
    github,
  });
  return new OAuthProvider<ProviderEnv>({
    apiRoute: McpServer.path,
    apiHandler: { fetch: (request) => mcp(request) },
    defaultHandler: {
      fetch: (request, env) =>
        handleOAuth(request as unknown as Request, env.OAUTH_PROVIDER) as never,
    },
    authorizeEndpoint: OAuthHandler.authorizePath,
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: {
      resource: `${origin}${McpServer.path}`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource_name: "Stash",
    },
  });
};
