import type * as TabsApi from "@stash/contracts-api/tabs";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as OpenTabsRepo from "./open-tabs-repo.ts";
import * as SavedTabs from "./saved-tabs.ts";

/**
 * The open tabs of every device, grouped by device, each with its tabs that are saved, and the
 * time of the answer (`at`).
 */
export const listOpenTabs = Effect.gen(function* () {
  // Taken before the read: an event published after it may hold what the read missed.
  const at = yield* DateTime.now;
  const devices = yield* OpenTabsRepo.OpenTabsRepo.use((repo) => repo.listAll);
  const saved = yield* SavedTabs.savedTabs(devices.flatMap((entry) => entry.snapshot?.tabs ?? []));
  const savedUrls = new Map(saved.map((tab) => [tab.url as string, tab]));
  return {
    devices: devices.map((entry): TabsApi.DeviceTabs => ({
      ...entry,
      saved: (entry.snapshot?.tabs ?? []).flatMap((tab) => {
        const hit = savedUrls.get(tab.url);
        return hit === undefined ? [] : [hit];
      }),
    })),
    at,
  };
}).pipe(Effect.withSpan("listOpenTabs"));
