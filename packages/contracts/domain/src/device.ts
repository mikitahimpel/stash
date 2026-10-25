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
