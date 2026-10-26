import * as Command from "@stash/contracts-domain/command";
import type * as Device from "@stash/contracts-domain/device";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FindDevice from "../devices/find-device.ts";
import * as CommandsRepo from "./commands-repo.ts";

/** Queues a pending command for the device, which picks it up on its next poll. */
export const enqueueCommand = Effect.fn("enqueueCommand")(function* (
  deviceId: Device.DeviceId,
  payload: Command.CommandPayload,
) {
  yield* FindDevice.findDevice(deviceId);
  const repo = yield* CommandsRepo.CommandsRepo;
  const command: Command.Command = {
    id: Command.CommandId.make(crypto.randomUUID()),
    deviceId,
    payload,
    status: "pending",
    createdAt: yield* DateTime.now,
    completedAt: null,
  };
  yield* repo.insert(command);
  return command;
});
