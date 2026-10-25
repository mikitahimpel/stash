/**
 * The api origin, from the Vite env var `VITE_API_BASE_URL` (for example
 * `https://stash-api.example.workers.dev`). When it is unset, requests go to the page's own
 * origin, which is what a same-origin deploy or a dev proxy wants.
 */
export const fromEnv: string | undefined = import.meta.env.VITE_API_BASE_URL || undefined;
