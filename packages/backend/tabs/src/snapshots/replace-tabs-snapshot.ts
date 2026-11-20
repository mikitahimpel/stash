import type * as TabsApi from "@stash/contracts-api/tabs";
import * as Security from "@stash/contracts-api/security";
import type * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import type * as Tab from "@stash/contracts-domain/tab";
import * as LinkEvents from "@stash/backend-platform/link-events";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as DeviceAccess from "../device-access.ts";
import * as FindDevice from "../devices/find-device.ts";
import * as OpenTabsRepo from "./open-tabs-repo.ts";
import * as SavedTabs from "./saved-tabs.ts";

/**
 * How often one device may report. A browser reports after its tab events settle (about 1.5 s),
 * so even a user who keeps switching tabs stays well under it; a client in a loop does not.
 */
export const reportLimit = { count: 60, windowMillis: 60_000 } as const;

/**
 * Sends `tabs.updated` with the device's tabs as they were just stored (with the `openedAt` the
 * api kept) and which of them are saved. Never fails: a stream that misses it only makes Open now
 * wait for the next report or its own refresh.
 */
const publish = (device: Device.Device, snapshot: Tab.TabsSnapshot) =>
  Effect.gen(function* () {
    const saved = yield* SavedTabs.savedTabs(snapshot.tabs);
    const user = yield* Security.CurrentUser;
    const events = yield* LinkEvents.LinkEvents;
    yield* events.publish(user.id, {
      type: "tabs.updated",
      at: yield* DateTime.now,
      device,
      snapshot,
      saved,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`tabs events: ${device.id} was not published`, cause),
    ),
  );

/**
 * Replaces the device's open tabs with the reported snapshot and tells the live stream. URLs that
 * stay open keep the time they were first seen open, and every tab is marked as seen at
 * `takenAt`. A device past `reportLimit` gets `RateLimited` and nothing is written.
 */
export const replaceTabsSnapshot = Effect.fn("replaceTabsSnapshot")(function* (
  principal: Security.Principal,
  deviceId: Device.DeviceId,
  report: TabsApi.ReportTabs,
) {
  const device = yield* FindDevice.findDevice(deviceId);
  yield* DeviceAccess.authorizeTabsWrite(principal, device);
  const repo = yield* OpenTabsRepo.OpenTabsRepo;
  const now = yield* Clock.currentTimeMillis;
  const window = yield* repo.countReport(deviceId, now, reportLimit.windowMillis);
  if (window.count > reportLimit.count) {
    return yield* new Errors.RateLimited({
      retryAfterSeconds: Math.max(1, Math.ceil((window.endsAt - now) / 1000)),
    });
  }
  const snapshot = yield* repo.replace(deviceId, report.takenAt, report.tabs);
  yield* publish(device, snapshot);
});
