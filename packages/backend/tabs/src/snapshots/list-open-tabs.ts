import * as Effect from "effect/Effect";
import * as OpenTabsRepo from "./open-tabs-repo.ts";

/** The open tabs of every device, grouped by device. */
export const listOpenTabs = OpenTabsRepo.OpenTabsRepo.use((repo) => repo.listAll).pipe(
  Effect.map((devices) => ({ devices })),
  Effect.withSpan("listOpenTabs"),
);
