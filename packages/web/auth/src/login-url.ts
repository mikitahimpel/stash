import * as ApiBaseUrl from "@stash/web-api-client/api-base-url";

/**
 * Where the login button sends the browser: the api starts the GitHub OAuth flow there, and its
 * callback sets the session cookie and redirects back to the app.
 */
export const github = `${(ApiBaseUrl.fromEnv ?? "").replace(/\/+$/, "")}/auth/github/login`;
