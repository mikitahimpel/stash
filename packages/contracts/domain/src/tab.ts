import { Schema } from "effect";
import * as Device from "./device.ts";
import * as Link from "./link.ts";

/** A tab open on a device, as last reported. */
export const OpenTab = Schema.Struct({
  url: Link.Url,
  title: Schema.NullOr(Schema.String),
  openedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastSeenAt: Schema.DateTimeUtcFromString,
});
export type OpenTab = typeof OpenTab.Type;

/** All tabs open on one device. A new snapshot replaces the previous one. */
export const TabsSnapshot = Schema.Struct({
  deviceId: Device.DeviceId,
  takenAt: Schema.DateTimeUtcFromString,
  tabs: Schema.Array(OpenTab),
});
export type TabsSnapshot = typeof TabsSnapshot.Type;
