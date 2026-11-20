import * as GoogleConfig from "@stash/backend-platform/google-config";

// A deploy may run before a sign-in provider is set up. Its routes then answer 503 instead of
// calling the provider with no client:
//
// - GitHub (no `GITHUB_CLIENT_ID`): the device flow routes, and linking GitHub.
// - Google (no `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`): start, callback and linking.
//
// Passkeys need no provider and always work. `GET /auth/providers` tells the web app which buttons
// to show. CORS headers are set so the SPA can read the answer; preflights still go through the
// api's own CORS middleware.
const githubPaths = new Set([
  "POST /auth/device/start",
  "POST /auth/device/poll",
  "POST /auth/github/link",
]);
const googlePaths = new Set([
  "GET /auth/google/start",
  "GET /auth/google/callback",
  "POST /auth/google/link",
]);

export interface Env extends Partial<GoogleConfig.Env> {
  readonly GITHUB_CLIENT_ID?: string | undefined;
  readonly WEB_ORIGIN: string;
}

const notConfigured = (env: Env, provider: string) =>
  Response.json(
    { _tag: "NotConfigured", message: `${provider} login is not configured on this deployment` },
    {
      status: 503,
      headers: {
        "access-control-allow-origin": env.WEB_ORIGIN,
        "access-control-allow-credentials": "true",
        vary: "Origin",
      },
    },
  );

export const handleLoginNotConfigured = (request: Request, env: Env): Response | undefined => {
  const route = `${request.method} ${new URL(request.url).pathname}`;
  if (
    githubPaths.has(route) &&
    (env.GITHUB_CLIENT_ID === undefined || env.GITHUB_CLIENT_ID === "")
  ) {
    return notConfigured(env, "GitHub");
  }
  if (googlePaths.has(route) && !GoogleConfig.isConfigured(env)) {
    return notConfigured(env, "Google");
  }
  return undefined;
};
