import { Schema } from "effect";
import * as Device from "./device.ts";
import * as Link from "./link.ts";

/**
 * The window a tab is in, as the device names it: a browser window, or a Zen workspace (space).
 * `id` is only stable within one device and one run of its browser; it groups the tabs of one
 * window and means nothing else. `name` is what the user calls it (a Zen space's name), when the
 * device knows one.
 */
export const TabWindow = Schema.Struct({
  id: Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(200))),
  name: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(200))),
  ),
});
export type TabWindow = typeof TabWindow.Type;

/** A tab open on a device, as last reported. */
export const OpenTab = Schema.Struct({
  url: Link.Url,
  title: Schema.NullOr(Schema.String),
  openedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastSeenAt: Schema.DateTimeUtcFromString,
  /** When the tab was last the active one, if the device knows (Firefox's `lastAccessed`). */
  lastActiveAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  /** The window or workspace the tab is in, if the device has windows. */
  window: Schema.optionalKey(TabWindow),
  /** The page's icon, an http(s) address (never a `data:` URL), if the device has one. */
  faviconUrl: Schema.optionalKey(Link.Url),
});
export type OpenTab = typeof OpenTab.Type;

/** All tabs open on one device. A new snapshot replaces the previous one. */
export const TabsSnapshot = Schema.Struct({
  deviceId: Device.DeviceId,
  takenAt: Schema.DateTimeUtcFromString,
  tabs: Schema.Array(OpenTab),
});
export type TabsSnapshot = typeof TabsSnapshot.Type;

/**
 * An open tab whose page is saved in Stash: the tab's url as the device reported it, the link
 * stored under the same canonical url, and that link's preview image (for the row's thumbnail).
 */
export const SavedTab = Schema.Struct({
  url: Link.Url,
  linkId: Link.LinkId,
  imageUrl: Schema.NullOr(Link.Url),
});
export type SavedTab = typeof SavedTab.Type;
