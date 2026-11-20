import type * as TabsApi from "@stash/contracts-api/tabs";
import * as Effect from "effect/Effect";
import * as OpenTabsRepo from "./open-tabs-repo.ts";
import * as SavedTabs from "./saved-tabs.ts";

/** The open tabs of every device, grouped by device, each with its tabs that are saved. */
export const listOpenTabs = Effect.gen(function* () {
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
  };
}).pipe(Effect.withSpan("listOpenTabs"));
