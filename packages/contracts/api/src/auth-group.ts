import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

/** A redirect. The target is in the `Location` header. */
export const Redirect = HttpApiSchema.Empty(302);

export const GithubCallbackQuery = Schema.Struct({
  code: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  state: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});
export type GithubCallbackQuery = typeof GithubCallbackQuery.Type;

/**
 * The GitHub OAuth flow. `login` and `callback` run before a session exists, so only `me` and
 * `logout` are guarded. On success `callback` sets the session cookie and redirects to the app.
 */
export class AuthGroup extends HttpApiGroup.make("auth").add(
  HttpApiEndpoint.get("me", "/auth/me", {
    success: Security.Principal,
  }).middleware(Security.Authorization),
  HttpApiEndpoint.get("githubLogin", "/auth/github/login", {
    success: Redirect,
  }),
  HttpApiEndpoint.get("githubCallback", "/auth/github/callback", {
    query: GithubCallbackQuery,
    success: Redirect,
    error: ErrorStatuses.Unauthorized,
  }),
  HttpApiEndpoint.post("logout", "/auth/logout", {
    success: HttpApiSchema.NoContent,
  }).middleware(Security.Authorization),
) {}
