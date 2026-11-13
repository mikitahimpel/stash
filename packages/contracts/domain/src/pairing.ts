import { Schema } from "effect";

/**
 * The one-time secret an extension pairs with. The extension makes it (32 random bytes as
 * base64url, 43 characters), opens the web app's `/connect/extension?code=…` page with it, and
 * claims its device token with it once the signed-in owner approves. The api stores only its hash.
 */
export const PairingCode = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{32,128}$/, {
      message: "Expected a base64url pairing code of 32 to 128 characters",
    }),
  ),
  Schema.brand("PairingCode"),
);
export type PairingCode = typeof PairingCode.Type;

/** How long an approved pairing waits for the extension to claim it. */
export const pairingTtlMinutes = 10;
