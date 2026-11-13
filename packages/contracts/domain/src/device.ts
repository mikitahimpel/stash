import { Schema } from "effect";

export const DeviceId = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("DeviceId"),
);
export type DeviceId = typeof DeviceId.Type;

export const DeviceKind = Schema.Literals(["zen", "ios", "mac-agent"]);
export type DeviceKind = typeof DeviceKind.Type;

export const DeviceName = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(100), Schema.isTrimmed()),
);

export const Device = Schema.Struct({
  id: DeviceId,
  name: DeviceName,
  kind: DeviceKind,
  createdAt: Schema.DateTimeUtcFromString,
});
export type Device = typeof Device.Type;

/** The latest link a device saved: when, and which link (a repeat save points at the stored one). */
export const DeviceLastSave = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  linkId: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
});
export type DeviceLastSave = typeof DeviceLastSave.Type;

/**
 * What a device did last, for the Connect page's status. `lastSeenAt` is the latest of its token's
 * last use, its last save and its last tabs snapshot, or `null` if it never got in touch.
 */
export const DeviceActivity = Schema.Struct({
  deviceId: DeviceId,
  lastSeenAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastSave: Schema.NullOr(DeviceLastSave),
});
export type DeviceActivity = typeof DeviceActivity.Type;
