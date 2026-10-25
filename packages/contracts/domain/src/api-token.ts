import { Schema } from "effect";
import * as Device from "./device.ts";

export const ApiTokenId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("ApiTokenId"),
);
export type ApiTokenId = typeof ApiTokenId.Type;

/** A token as listed. It never carries the secret or its hash. */
export const ApiTokenInfo = Schema.Struct({
  id: ApiTokenId,
  deviceId: Device.DeviceId,
  createdAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type ApiTokenInfo = typeof ApiTokenInfo.Type;

/**
 * A freshly created token. The plaintext is returned exactly once, at creation. It decodes into a
 * `Redacted` so it never shows up in logs or inspection.
 */
export const CreatedApiToken = Schema.Struct({
  ...ApiTokenInfo.fields,
  token: Schema.RedactedFromValue(Schema.String.pipe(Schema.check(Schema.isNonEmpty()))),
});
export type CreatedApiToken = typeof CreatedApiToken.Type;
