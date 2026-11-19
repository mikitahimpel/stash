// The `Web` Worker in front of the SPA's Static Assets (see `alchemy.run.ts`). It runs for every
// path but the static files under `/assets/` and `/downloads/`, and does three things:
//
// 1. It serves the api same-origin: `/api/*` goes to the `Api` Worker through the `API` Service
//    Binding with the `/api` prefix stripped, so the api keeps its root paths for every other
//    client. The session cookie it sets is then first-party on the web origin. This holds on every
//    host, so clients that still call an old address keep working.
// 2. On the site's own host it serves the MCP server and its OAuth endpoints (`/mcp`, `/authorize`,
//    `/token`, `/register`, `/.well-known/oauth-*`) from the `Mcp` Worker through the `MCP` Service
//    Binding, with the URL unchanged. The binding exists only on a stage with a custom domain.
// 3. On an old `*.workers.dev` host of a stage that moved to a custom domain, it answers a GET of
//    anything else with a 301 to the same path on the new host.
//
// Everything else is the assets layer's: a file, or `index.html` for the client router.

/** The part of a Workers `Fetcher` (Service Binding or `ASSETS`) this Worker calls. */
export interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

/** Bindings declared for the `Web` Worker in the root `alchemy.run.ts`. Keep the two in sync. */
export interface WorkerEnv {
  /** Service Binding to the `Api` Worker. */
  readonly API: Fetcher;
  /** Service Binding to the `Mcp` Worker, when the MCP server shares the site's host. */
  readonly MCP?: Fetcher;
  /**
   * The site's own origin. The Worker redirects pages of an old `*.workers.dev` host to it, and
   * the build bakes it into the extension it puts under `/downloads/` (see `alchemy.run.ts`).
   */
  readonly STASH_WEB_ORIGIN?: string;
  /** The built SPA (`apps/web/dist`), with the SPA fallback to `index.html`. */
  readonly ASSETS: Fetcher;
}

// A Workers entry may export only handlers (`workerd` rejects any other value), so the helpers
// stay private.

/** The path prefix the api is served under on the web origin. */
const apiPrefix = "/api";

/** The api path for a web path under `/api`, or `undefined` when it isn't one. */
const apiPath = (pathname: string): string | undefined => {
  if (pathname === apiPrefix) return "/";
  return pathname.startsWith(`${apiPrefix}/`) ? pathname.slice(apiPrefix.length) : undefined;
};

// The paths of the `Mcp` Worker: its endpoint, the sign-in pages, and the OAuth 2.1 endpoints and
// metadata of `@cloudflare/workers-oauth-provider`. A copy of what `apps/mcp` serves (contexts
// share no code). No route of the SPA may start with one of them (`test/web-worker.test.ts`).
const mcpPaths = ["/mcp", "/authorize", "/token", "/register"];
const mcpMetadataPrefix = "/.well-known/oauth-";

const isMcpPath = (pathname: string): boolean =>
  pathname.startsWith(mcpMetadataPrefix) ||
  mcpPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/** The site's own origin as a URL, or `undefined` when it is unset or not a URL. */
const siteOrigin = (env: WorkerEnv): URL | undefined => {
  try {
    return env.STASH_WEB_ORIGIN === undefined ? undefined : new URL(env.STASH_WEB_ORIGIN);
  } catch {
    return undefined;
  }
};

/** Whether `url` is on a `workers.dev` host that the site has moved away from. */
const isOldHost = (url: URL, site: URL): boolean =>
  url.hostname.endsWith(".workers.dev") && url.hostname !== site.hostname;

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = apiPath(url.pathname);
    if (path !== undefined) {
      url.pathname = path;
      // Method, headers (cookie, `cf-connecting-ip`, a WebSocket `upgrade`), body and redirect mode
      // are kept as they came, and the answer goes back untouched (a 101 keeps its socket).
      return env.API.fetch(new Request(url, request));
    }
    const site = siteOrigin(env);
    if (site !== undefined && isOldHost(url, site)) {
      if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
      const target = new URL(`${url.pathname}${url.search}`, site);
      return Promise.resolve(
        new Response(null, { status: 301, headers: { location: target.href } }),
      );
    }
    // The OAuth issuer and the MCP resource are this host, so the request goes on as it came.
    if (env.MCP !== undefined && site?.host === url.host && isMcpPath(url.pathname)) {
      return env.MCP.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
