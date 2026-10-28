// A deploy may run before the GitHub OAuth app exists (no `GITHUB_CLIENT_ID`). The device flow
// routes then answer 503 instead of calling GitHub with no client id. CORS headers are set so the
// SPA can read the answer; preflights still go through the api's own CORS middleware.
const loginPaths = new Set(["/auth/device/start", "/auth/device/poll"]);

export const handleLoginNotConfigured = (
  request: Request,
  env: { readonly GITHUB_CLIENT_ID?: string | undefined; readonly WEB_ORIGIN: string },
): Response | undefined => {
  if (env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_ID !== "") return undefined;
  if (request.method !== "POST" || !loginPaths.has(new URL(request.url).pathname)) return undefined;
  return Response.json(
    { _tag: "NotConfigured", message: "GitHub login is not configured on this deployment" },
    {
      status: 503,
      headers: {
        "access-control-allow-origin": env.WEB_ORIGIN,
        "access-control-allow-credentials": "true",
        vary: "Origin",
      },
    },
  );
};
