import type * as DevicesApi from "@stash/contracts-api/devices";
import * as Device from "@stash/contracts-domain/device";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as DevicesRepo from "./devices-repo.ts";

/** Registers a device under a new id. Its API token is issued separately (`POST /tokens`). */
export const registerDevice = Effect.fn("registerDevice")(function* (
  input: DevicesApi.RegisterDevice,
) {
  const repo = yield* DevicesRepo.DevicesRepo;
  const device: Device.Device = {
    id: Device.DeviceId.make(crypto.randomUUID()),
    name: input.name,
    kind: input.kind,
    createdAt: yield* DateTime.now,
  };
  yield* repo.insert(device);
  return device;
});
