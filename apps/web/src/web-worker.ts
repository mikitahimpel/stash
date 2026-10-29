// The `Web` Worker in front of the SPA's Static Assets (see `alchemy.run.ts`). It serves the api
// same-origin: `/api/*` goes to the `Api` Worker through the `API` Service Binding with the `/api`
// prefix stripped, so the api keeps its root paths for every other client. The session cookie it
// sets is then first-party on the web origin. The assets layer answers every other path itself
// (`runWorkerFirst` lists only `/api` and `/api/*`), so this Worker only runs for api requests.

/** The part of a Workers `Fetcher` (Service Binding or `ASSETS`) this Worker calls. */
export interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

/** Bindings declared for the `Web` Worker in the root `alchemy.run.ts`. Keep the two in sync. */
export interface WorkerEnv {
  /** Service Binding to the `Api` Worker. */
  readonly API: Fetcher;
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

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = apiPath(url.pathname);
    if (path === undefined) return env.ASSETS.fetch(request);
    url.pathname = path;
    // Method, headers (cookie, `cf-connecting-ip`), body and redirect mode are kept as they came.
    return env.API.fetch(new Request(url, request));
  },
};
