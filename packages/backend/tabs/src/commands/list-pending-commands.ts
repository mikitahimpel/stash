import type * as Security from "@stash/contracts-api/security";
import type * as Command from "@stash/contracts-domain/command";
import type * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as DeviceAccess from "../device-access.ts";
import * as FindDevice from "../devices/find-device.ts";
import * as CommandsRepo from "./commands-repo.ts";

/**
 * The device's commands, oldest first. Devices poll with `status: "pending"`. Without a status,
 * every command is listed.
 */
export const listCommands = Effect.fn("listCommands")(function* (
  principal: Security.Principal,
  deviceId: Device.DeviceId,
  status?: Command.CommandStatus,
) {
  yield* FindDevice.findDevice(deviceId);
  yield* DeviceAccess.authorizeCommandsAccess(principal, deviceId);
  const repo = yield* CommandsRepo.CommandsRepo;
  return yield* repo.listByDevice(deviceId, status);
});
