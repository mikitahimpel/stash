import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Layer } from "effect";
import type * as GitHub from "./github-identity.ts";
import * as McpServer from "./mcp-server.ts";
import * as OAuthHandler from "./oauth-handler.ts";
import type { WorkerEnv } from "./worker-env.ts";

/** The provider adds its helpers to the `env` its `defaultHandler` sees. */
export type ProviderEnv = WorkerEnv & { readonly OAUTH_PROVIDER: OAuthHelpers };

export interface Options {
  readonly env: Pick<WorkerEnv, "MCP_ORIGIN" | "MCP_LEGACY_ORIGIN">;
  /** Serves an authenticated MCP request, calling the api with the grant's `apiToken`. */
  readonly mcp: (request: Request, apiToken: string) => Promise<Response>;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
  /** Mints the api token for a new grant (see `OAuthHandler.Options`). */
  readonly mintApiToken: OAuthHandler.Options["mintApiToken"];
  /** Whether the api still accepts a grant's token: `false` once it is revoked in Settings. */
  readonly isApiTokenActive: (apiToken: string) => Promise<boolean>;
  /** Epoch milliseconds, for the device flow's poll interval. Tests pass their own clock. */
  readonly now?: () => number;
}

/**
 * The Worker's `fetch`. A deploy that moved the server to another host keeps answering on the old
 * one (`MCP_LEGACY_ORIGIN`), so connectors added with the old URL keep working: the provider
 * serves only its own resource (a request for `/mcp` on any other origin gets 404) and names its
 * origin as the issuer, so each origin gets a provider of its own. Both read the same KV, and a
 * grant stays bound to the resource it was made for. A request on any other host gets the
 * provider of `MCP_ORIGIN`.
 */
export const make = (options: Options) => {
  const { MCP_ORIGIN, MCP_LEGACY_ORIGIN } = options.env;
  const current = makeFor(new URL(MCP_ORIGIN).origin, options);
  if (MCP_LEGACY_ORIGIN === undefined || MCP_LEGACY_ORIGIN === "") return current;
  const legacyOrigin = new URL(MCP_LEGACY_ORIGIN).origin;
  if (legacyOrigin === new URL(MCP_ORIGIN).origin) return current;
  const legacy = makeFor(legacyOrigin, options);
  return {
    fetch: (request: Request, env: ProviderEnv, ctx: ExecutionContext) =>
      (new URL(request.url).origin === legacyOrigin ? legacy : current).fetch(
        request as never,
        env,
        ctx,
      ),
  };
};

/**
 * The provider of one origin: OAuth 2.1 metadata, dynamic client registration and tokens from
 * `@cloudflare/workers-oauth-provider`, the bearer check on `/mcp`, and the GitHub Device Flow sign-in pages.
 */
const makeFor = (origin: string, { mcp, github, mintApiToken, isApiTokenActive, now }: Options) => {
  const handleOAuth = OAuthHandler.make({
    origin,
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
