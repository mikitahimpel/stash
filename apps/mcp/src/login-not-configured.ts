import * as OAuthHandler from "./oauth-handler.ts";

// A deploy may run before the GitHub OAuth app exists (no `GITHUB_CLIENT_ID`). The sign-in pages
// then answer 503 instead of starting a device flow with no client id. The OAuth metadata,
// registration and token endpoints keep working.
export const handleLoginNotConfigured = (
  request: Request,
  env: { readonly GITHUB_CLIENT_ID?: string | undefined },
): Response | undefined => {
  if (env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_ID !== "") return undefined;
  const { pathname } = new URL(request.url);
  if (
    pathname !== OAuthHandler.authorizePath &&
    !pathname.startsWith(`${OAuthHandler.authorizePath}/`)
  )
    return undefined;
  return new Response("GitHub login is not configured on this deployment.\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
