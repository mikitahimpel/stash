/**
 * The api's base URL, from the Vite env var `VITE_API_BASE_URL`. It defaults to `/api` on the
 * page's own origin: the `Web` Worker forwards `/api/*` to the api through a Service Binding, and
 * the Vite dev server proxies it to `alchemy dev` the same way, so the session cookie is always
 * first-party. Set it only to reach an api on another origin (the api allows the web origin by
 * CORS).
 */
export const fromEnv: string = import.meta.env.VITE_API_BASE_URL || "/api";
