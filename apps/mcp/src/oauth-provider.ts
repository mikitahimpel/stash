import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Layer } from "effect";
import type * as GitHub from "./github-identity.ts";
import * as McpServer from "./mcp-server.ts";
import * as OAuthHandler from "./oauth-handler.ts";
import type { WorkerEnv } from "./worker-env.ts";

/** The provider adds its helpers to the `env` its `defaultHandler` sees. */
export type ProviderEnv = WorkerEnv & { readonly OAUTH_PROVIDER: OAuthHelpers };

export interface Options {
  readonly env: Pick<
    WorkerEnv,
    "MCP_ORIGIN" | "MCP_LEGACY_ORIGIN" | "WEB_ORIGIN" | "GITHUB_CLIENT_ID"
  >;
  /** Serves an authenticated MCP request, calling the api with the grant's `apiToken`. */
  readonly mcp: (request: Request, apiToken: string) => Promise<Response>;
  readonly github: Layer.Layer<GitHub.GitHubIdentity>;
  /** Mints the api token for a new grant (see `OAuthHandler.Options`). */
  readonly mintApiToken: OAuthHandler.Options["mintApiToken"];
  /**
   * Mints a grant's api token for a web session's user (see `OAuthHandler.Options.webSignIn`).
   * Used only by the provider of the origin that is also `WEB_ORIGIN`.
   */
  readonly mintForSession?: NonNullable<OAuthHandler.Options["webSignIn"]>["mintForSession"];
  /** Whether the api still accepts a grant's token: `false` once it is revoked in Settings. */
  readonly isApiTokenActive: (apiToken: string) => Promise<boolean>;
  /** Epoch milliseconds, for the device flow's poll interval. Tests pass their own clock. */
  readonly now?: () => number;
}

/** Whether `origin` is the web app's too, so its sign-in pages see the web session cookie. */
export const sharesWebOrigin = (
  origin: string,
  env: { readonly WEB_ORIGIN?: string | undefined },
) =>
  env.WEB_ORIGIN !== undefined &&
  env.WEB_ORIGIN !== "" &&
  new URL(env.WEB_ORIGIN).origin === origin;

const isGithubConfigured = (env: Pick<WorkerEnv, "GITHUB_CLIENT_ID">) =>
  env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_ID !== "";

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
const makeFor = (origin: string, options: Options) => {
  const { mcp, github, mintApiToken, isApiTokenActive, now, mintForSession } = options;
  const handleOAuth = OAuthHandler.make({
    origin,
    github,
    mintApiToken,
    githubConfigured: isGithubConfigured(options.env),
    ...(mintForSession !== undefined && sharesWebOrigin(origin, options.env)
      ? { webSignIn: { mintForSession } }
      : {}),
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
