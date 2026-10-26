import type * as TabsApi from "@stash/contracts-api/tabs";
import type * as Security from "@stash/contracts-api/security";
import type * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as DeviceAccess from "../device-access.ts";
import * as FindDevice from "../devices/find-device.ts";
import * as OpenTabsRepo from "./open-tabs-repo.ts";

/**
 * Replaces the device's open tabs with the reported snapshot. URLs that stay open keep the time
 * they were first seen open, and every tab is marked as seen at `takenAt`.
 */
export const replaceTabsSnapshot = Effect.fn("replaceTabsSnapshot")(function* (
  principal: Security.Principal,
  deviceId: Device.DeviceId,
  report: TabsApi.ReportTabs,
) {
  const device = yield* FindDevice.findDevice(deviceId);
  yield* DeviceAccess.authorizeTabsWrite(principal, device);
  const repo = yield* OpenTabsRepo.OpenTabsRepo;
  yield* repo.replace(deviceId, report.takenAt, report.tabs);
});
