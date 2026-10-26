import type * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as DevicesRepo from "./devices-repo.ts";

/** The device, or `NotFound`. */
export const findDevice = Effect.fn("findDevice")(function* (id: Device.DeviceId) {
  const repo = yield* DevicesRepo.DevicesRepo;
  return yield* Effect.fromOption(yield* repo.findById(id)).pipe(
    Effect.mapError(() => new Errors.NotFound({ resource: "device", id })),
  );
});
