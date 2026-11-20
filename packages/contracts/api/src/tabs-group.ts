import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tab from "@stash/contracts-domain/tab";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

/** The body of `PUT /devices/:id/tabs`. The device comes from the path. */
export const ReportTabs = Schema.Struct({
  takenAt: Schema.DateTimeUtcFromString,
  tabs: Schema.Array(Tab.OpenTab),
});
export type ReportTabs = typeof ReportTabs.Type;

/**
 * A device with its latest snapshot, or `null` if it never reported one. `saved` names the tabs
 * whose page is a stored link (matched by canonical url); the api always sends it.
 */
export const DeviceTabs = Schema.Struct({
  device: Device.Device,
  snapshot: Schema.NullOr(Tab.TabsSnapshot),
  saved: Schema.optionalKey(Schema.Array(Tab.SavedTab)),
});
export type DeviceTabs = typeof DeviceTabs.Type;

export const AllTabs = Schema.Struct({
  devices: Schema.Array(DeviceTabs),
});
export type AllTabs = typeof AllTabs.Type;

/** Save an open tab as a link and queue a `close-tab` command for its device. */
export const ArchiveTab = Schema.Struct({
  deviceId: Device.DeviceId,
  url: Link.Url,
  title: Schema.optionalKey(Link.LinkTitle),
});
export type ArchiveTab = typeof ArchiveTab.Type;

export const ArchivedTab = Schema.Struct({
  link: Link.Link,
  command: Command.Command,
});
export type ArchivedTab = typeof ArchivedTab.Type;

export class TabsGroup extends HttpApiGroup.make("tabs")
  .add(
    // Replaces the device's previous snapshot and sends `tabs.updated` on the live stream.
    // `Forbidden` when a device token reports for a device it may not write, `RateLimited` when
    // one device reports far more often than its debounced tab changes would.
    HttpApiEndpoint.put("report", "/devices/:id/tabs", {
      params: { id: Device.DeviceId },
      payload: ReportTabs,
      success: HttpApiSchema.NoContent,
      error: [ErrorStatuses.NotFound, ErrorStatuses.Forbidden, ErrorStatuses.RateLimited],
    }),
    HttpApiEndpoint.get("list", "/tabs", {
      success: AllTabs,
    }),
    HttpApiEndpoint.post("archive", "/tabs/archive", {
      payload: ArchiveTab,
      success: ArchivedTab.pipe(HttpApiSchema.status(201)),
      error: [ErrorStatuses.NotFound, ErrorStatuses.RateLimited],
    }),
  )
  .middleware(Security.Authorization) {}
