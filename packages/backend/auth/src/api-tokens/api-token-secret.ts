import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Redacted from "effect/Redacted";

// The secret half of an API token. The plaintext lives only in a `Redacted` and in the one create
// response. D1 stores its SHA-256 hash, which is enough to look a token up: the plaintext carries
// 256 random bits, so a slow, salted hash would add nothing.

/** Marks Stash tokens, so secret scanners and people can recognize them. */
export const prefix = "stash_";

/** Bytes of randomness in a token. */
export const randomBytes = 32;

/** A fresh random token. */
export const generate: Effect.Effect<Redacted.Redacted<string>> = Effect.sync(() =>
  Redacted.make(prefix + Base64Url.encode(crypto.getRandomValues(new Uint8Array(randomBytes)))),
);

/** The lowercase hex SHA-256 of the token, as stored in `api_tokens.hash`. */
export const hash = (token: Redacted.Redacted<string>): Effect.Effect<string> =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(Redacted.value(token))),
  ).pipe(Effect.map((digest) => Hex.encode(new Uint8Array(digest))));

/**
 * Compares two hashes in time that depends only on their length, never on where they differ.
 */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};
