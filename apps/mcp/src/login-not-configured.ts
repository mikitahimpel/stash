import * as OAuthHandler from "./oauth-handler.ts";
import * as OAuthProvider from "./oauth-provider.ts";

// A deploy may run before the GitHub OAuth app exists (no `GITHUB_CLIENT_ID`). The sign-in pages
// then answer 503 instead of starting a device flow with no client id, except on the web app's own
// origin, where the web sign-in (passkeys need no provider) still works. The OAuth metadata,
// registration and token endpoints keep working.
export const handleLoginNotConfigured = (
  request: Request,
  env: { readonly GITHUB_CLIENT_ID?: string | undefined; readonly WEB_ORIGIN?: string | undefined },
): Response | undefined => {
  if (env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_ID !== "") return undefined;
  const url = new URL(request.url);
  const { pathname } = url;
  if (
    pathname !== OAuthHandler.authorizePath &&
    !pathname.startsWith(`${OAuthHandler.authorizePath}/`)
  )
    return undefined;
  if (
    OAuthProvider.sharesWebOrigin(url.origin, env) &&
    pathname !== OAuthHandler.devicePath &&
    pathname !== OAuthHandler.pollPath
  )
    return undefined;
  return new Response("GitHub login is not configured on this deployment.\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
