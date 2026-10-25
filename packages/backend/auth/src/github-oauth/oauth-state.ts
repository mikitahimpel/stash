import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";

// The OAuth `state` ties a callback to the browser that started the login (CSRF protection).
// `githubLogin` puts it both in the GitHub redirect and in a short-lived cookie scoped to the
// callback path. `githubCallback` accepts the callback only when the two match.

/** Name of the cookie that carries the state between login and callback. */
export const cookieName = "stash_oauth_state";

/** Only the callback needs the cookie. */
export const cookiePath = "/auth/github";

/** How long a started login may take. */
export const maxAge = Duration.minutes(10);

/** A fresh random state. */
export const generate: Effect.Effect<string> = Effect.sync(() =>
  Base64Url.encode(crypto.getRandomValues(new Uint8Array(32))),
);
