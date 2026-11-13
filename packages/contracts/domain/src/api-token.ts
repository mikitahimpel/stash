import { Schema } from "effect";
import * as Device from "./device.ts";

export const ApiTokenId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("ApiTokenId"),
);
export type ApiTokenId = typeof ApiTokenId.Type;

/** The name of the token the MCP connector mints for itself when the owner authorizes Claude. */
export const mcpTokenName = "Claude (MCP)";

/**
 * A token as listed. It never carries the secret or its hash. A device token has a `deviceId` and
 * acts as that device. A user token (the MCP connector's) has no device, carries a `name`, and acts
 * as the signed-in user.
 */
export const ApiTokenInfo = Schema.Struct({
  id: ApiTokenId,
  deviceId: Schema.NullOr(Device.DeviceId),
  /** What a user token is for, e.g. `Claude (MCP)`. `null` for a device token. */
  name: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isNonEmpty()))),
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
