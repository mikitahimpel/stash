import type * as Tab from "@stash/contracts-domain/tab";
import * as Link from "@stash/contracts-domain/link";
import type * as BrowserTabs from "@stash/ext-platform/browser-tabs";
import * as DateTime from "effect/DateTime";
import * as Hash from "effect/Hash";
import * as Schema from "effect/Schema";

const isUrl = Schema.is(Link.Url);

/** When this browser first saw each open tab, in epoch ms, by tab id. */
export type OpenedAt = ReadonlyMap<number, number>;

/** Whether the tab goes into a snapshot: an http(s) page outside a private window. */
export const isReported = (tab: BrowserTabs.Tab): tab is BrowserTabs.Tab & { url: string } =>
  !tab.incognito && tab.url !== null && isUrl(tab.url);

/**
 * `openedAt` for the tabs open now: a tab already known keeps its time, a new one takes `now` (or
 * the time it was last active, if that is earlier: a tab that was open before this browser
 * started reporting). Closed tabs are forgotten.
 */
export const trackOpened = (
  known: OpenedAt,
  tabs: ReadonlyArray<BrowserTabs.Tab>,
  now: number,
): OpenedAt =>
  new Map(tabs.map((tab) => [tab.id, known.get(tab.id) ?? Math.min(now, tab.lastAccessed ?? now)]));

/**
 * The open tabs as the API stores them, in tab-strip order. Tabs without an http(s) URL
 * (`about:`, `moz-extension:` and privileged pages whose URL the browser withholds) and tabs in
 * private windows are left out. Hidden tabs stay in: Zen hides the tabs of the workspaces that
 * are not shown, but they are still open. A `data:` icon is not sent.
 */
export const fromTabs = (
  tabs: ReadonlyArray<BrowserTabs.Tab>,
  now: DateTime.Utc,
  openedAt: OpenedAt = new Map(),
): ReadonlyArray<Tab.OpenTab> =>
  tabs.filter(isReported).map((tab) => {
    const opened = openedAt.get(tab.id);
    return {
      url: tab.url as Link.Url,
      title: tab.title,
      openedAt: opened === undefined ? null : DateTime.makeUnsafe(opened),
      lastSeenAt: now,
      ...(tab.lastAccessed === null ? {} : { lastActiveAt: DateTime.makeUnsafe(tab.lastAccessed) }),
      window: { id: String(tab.windowId) },
      ...(tab.favIconUrl !== null && isUrl(tab.favIconUrl)
        ? { faviconUrl: tab.favIconUrl as Link.Url }
        : {}),
    };
  });

const seconds = (at: DateTime.Utc | null | undefined) =>
  at === null || at === undefined ? null : Math.floor(DateTime.toEpochMillis(at) / 1000);

/**
 * What counts as a change: URLs, titles, windows, icons and when each tab was last active (to the
 * second), in order. `lastSeenAt` and `openedAt` are left out, so a snapshot of the same tabs
 * taken later hashes the same.
 */
export const hash = (tabs: ReadonlyArray<Tab.OpenTab>): number =>
  Hash.string(
    JSON.stringify(
      tabs.map((tab) => [
        tab.url,
        tab.title,
        tab.window?.id ?? null,
        tab.faviconUrl ?? null,
        seconds(tab.lastActiveAt),
      ]),
    ),
  );
