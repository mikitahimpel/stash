import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";

/**
 * The lowercase hex SHA-256 of a secret that carries enough randomness to need no salt (an invite
 * token). Only this is stored, so a leaked database hands out no working link.
 */
export const hash = (secret: string): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))).pipe(
    Effect.map((digest) => Hex.encode(new Uint8Array(digest))),
  );
