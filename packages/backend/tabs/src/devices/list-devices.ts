import * as Effect from "effect/Effect";
import * as DevicesRepo from "./devices-repo.ts";

/** Every device of the current user, oldest first. */
export const listDevices = DevicesRepo.DevicesRepo.use((repo) => repo.list).pipe(
  Effect.withSpan("listDevices"),
);
