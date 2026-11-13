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
  /** Serves an authenticated MCP request, calling the api with the grant's `apiToken`. */
  readonly mcp: (request: Request, apiToken: string) => Promise<Response>;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
  /** Mints the api token for a new grant (see `OAuthHandler.Options`). */
  readonly mintApiToken: (login: string) => Promise<string>;
  /** Whether the api still accepts a grant's token: `false` once it is revoked in Settings. */
  readonly isApiTokenActive: (apiToken: string) => Promise<boolean>;
  /** Epoch milliseconds, for the device flow's poll interval. Tests pass their own clock. */
  readonly now?: () => number;
}

/**
 * The Worker's `fetch`: OAuth 2.1 metadata, dynamic client registration and tokens from
 * `@cloudflare/workers-oauth-provider`, the bearer check on `/mcp`, and the GitHub Device Flow sign-in pages.
 */
export const make = ({ env, mcp, github, mintApiToken, isApiTokenActive, now }: Options) => {
  const origin = new URL(env.MCP_ORIGIN).origin;
  const handleOAuth = OAuthHandler.make({
    origin,
    allowedLogin: env.ALLOWED_GITHUB_LOGIN,
    github,
    mintApiToken,
    ...(now === undefined ? {} : { now }),
  });

  // The bearer challenge the provider sends for an invalid token, so the client signs in again.
  const reauthorize = () =>
    new Response(null, {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": `Bearer realm="OAuth", resource_metadata="${origin}/.well-known/oauth-protected-resource${McpServer.path}", error="invalid_token", error_description="The Stash token was revoked. Sign in again."`,
      },
    });

  // The provider has checked the bearer and decrypted the grant's props. A grant whose api token
  // is gone (revoked in Settings, or a grant from before tokens were minted) is revoked here too:
  // a refresh would only bring the same token back, so the client must run the sign-in again.
  const serveMcp = async (request: Request, env: ProviderEnv, ctx: ExecutionContext) => {
    const { props, auth } = ctx as ExecutionContext & {
      readonly props?: Partial<OAuthHandler.Props>;
      readonly auth?: { readonly token?: string };
    };
    const apiToken = props?.apiToken;
    if (apiToken !== undefined && (await isApiTokenActive(apiToken))) {
      return mcp(request, apiToken);
    }
    const token =
      auth?.token === undefined ? null : await env.OAUTH_PROVIDER.unwrapToken(auth.token);
    if (token !== null) await env.OAUTH_PROVIDER.revokeGrant(token.grantId, token.userId);
    return reauthorize();
  };

  return new OAuthProvider<ProviderEnv>({
    apiRoute: McpServer.path,
    apiHandler: {
      fetch: (request, env, ctx) => serveMcp(request as unknown as Request, env, ctx) as never,
    },
    defaultHandler: {
      fetch: (request, env) =>
        handleOAuth(request as unknown as Request, env.OAUTH_PROVIDER, env.OAUTH_KV) as never,
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
