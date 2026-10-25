import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Redacted from "effect/Redacted";
import * as ApiTokenSecret from "../api-tokens/api-token-secret.ts";

// The session cookie's value. Like an API token it carries 256 random bits, and D1 stores only its
// SHA-256 hash as `sessions.id`, so a leaked database cannot be replayed as a cookie.

/** A fresh random session token. */
export const generate: Effect.Effect<Redacted.Redacted<string>> = Effect.sync(() =>
  Redacted.make(
    Base64Url.encode(crypto.getRandomValues(new Uint8Array(ApiTokenSecret.randomBytes))),
  ),
);

/** The `sessions.id` of a token. */
export const hash = ApiTokenSecret.hash;
