import * as Effect from "effect/Effect";
import * as DevicesRepo from "./devices-repo.ts";

/** What each device did last (token use, save, tabs snapshot), oldest device first. */
export const devicesActivity = DevicesRepo.DevicesRepo.use((repo) => repo.activity).pipe(
  Effect.withSpan("devicesActivity"),
);
