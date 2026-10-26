import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveLinksBatch from "@stash/backend-links/save-links-batch";
import * as StashConfig from "@stash/backend-platform/stash-config";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as EnqueueCommand from "@stash/backend-tabs/enqueue-command";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import type * as Tab from "@stash/contracts-domain/tab";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

// Links are saved through `@stash/backend-links` and commands queued through
// `@stash/backend-tabs`, which own those tables. Saving is not rate limited: the cron is not a
// client. A tab stays in `open_tabs` until its device reports a new snapshot, so a tab that already
// has a pending `close-tab` command is skipped instead of being archived again.

/** When the tab was opened, or first seen if its device does not report that. */
const openedAt = (tab: Tab.OpenTab): DateTime.Utc => tab.openedAt ?? tab.lastSeenAt;

/**
 * Archives the tabs open on `zen` devices for longer than `archiveAfterDays`: each becomes an
 * `archived` link (a link that was already saved and is still `new` becomes `archived` too; one
 * the user has already read or finished keeps its status) and gets a `close-tab` command for its
 * device. Returns how many tabs were archived.
 */
export const autoArchiveTabs = Effect.fn("autoArchiveTabs")(function* () {
  const config = yield* StashConfig.StashConfig;
  const openTabs = yield* OpenTabsRepo.OpenTabsRepo;
  const commands = yield* CommandsRepo.CommandsRepo;
  const links = yield* LinksRepo.LinksRepo;
  const cutoff = DateTime.subtract(yield* DateTime.now, { days: config.archiveAfterDays });

  let archived = 0;
  for (const { device, snapshot } of yield* openTabs.listAll) {
    if (device.kind !== "zen" || snapshot === null) continue;
    const closing = new Set(
      (yield* commands.listByDevice(device.id, "pending")).flatMap((command) =>
        command.payload.kind === "close-tab" ? [command.payload.url] : [],
      ),
    );
    const stale = new Map<string, Tab.OpenTab>();
    for (const tab of snapshot.tabs) {
      if (DateTime.isLessThan(openedAt(tab), cutoff) && !closing.has(tab.url)) {
        if (!stale.has(tab.url)) stale.set(tab.url, tab);
      }
    }
    if (stale.size === 0) continue;

    const tabs = [...stale.values()];
    const saved = yield* SaveLinksBatch.saveLinks(
      { kind: "device", deviceId: device.id },
      tabs.map((tab) =>
        tab.title === null ? { url: tab.url } : { url: tab.url, title: tab.title },
      ),
    );
    for (const link of saved) {
      if (link.status === "new") yield* links.update(link.id, { status: "archived" });
    }
    for (const tab of tabs) {
      yield* EnqueueCommand.enqueueCommand(device.id, { kind: "close-tab", url: tab.url });
    }
    archived += tabs.length;
  }
  yield* Effect.log(
    `auto-archive: archived ${archived} tabs older than ${config.archiveAfterDays} days`,
  );
  return archived;
});
