import type * as Security from "@stash/contracts-api/security";
import type * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as DevicesRepo from "./devices/devices-repo.ts";

// The signed-in user may act for every device. A device token acts only for its own device, with
// one exception: `mac-agent` reads Safari's iCloud Tabs on a Mac and reports the tabs of the iOS
// devices it registered, so it may write the snapshot of any `ios` device.

const forbidden = (message: string) => new Errors.Forbidden({ message });

/** Succeeds if the principal may replace the target device's tabs snapshot. */
export const authorizeTabsWrite = Effect.fn("authorizeTabsWrite")(function* (
  principal: Security.Principal,
  target: Device.Device,
) {
  if (principal.kind === "user" || principal.deviceId === target.id) return;
  if (target.kind === "ios") {
    const repo = yield* DevicesRepo.DevicesRepo;
    const own = yield* repo.findById(principal.deviceId);
    if (Option.isSome(own) && own.value.kind === "mac-agent") return;
  }
  return yield* forbidden("A device may only report its own tabs");
});

/** Succeeds if the principal may read or acknowledge the device's commands. */
export const authorizeCommandsAccess = (
  principal: Security.Principal,
  deviceId: Device.DeviceId,
): Effect.Effect<void, Errors.Forbidden> =>
  principal.kind === "user" || principal.deviceId === deviceId
    ? Effect.void
    : Effect.fail(forbidden("A device may only read its own commands"));
