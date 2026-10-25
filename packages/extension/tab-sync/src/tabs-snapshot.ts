import type * as Tab from "@stash/contracts-domain/tab";
import * as Link from "@stash/contracts-domain/link";
import type * as BrowserTabs from "@stash/ext-platform/browser-tabs";
import type * as DateTime from "effect/DateTime";
import * as Hash from "effect/Hash";
import * as Schema from "effect/Schema";

const isUrl = Schema.is(Link.Url);

/**
 * The open tabs as the API stores them, in tab-strip order. Tabs without an http(s) URL
 * (`about:` pages, privileged pages whose URL the browser withholds) are left out. Hidden tabs
 * stay in: Zen hides the tabs of the workspaces that are not shown, but they are still open.
 */
export const fromTabs = (
  tabs: ReadonlyArray<BrowserTabs.Tab>,
  now: DateTime.Utc,
): ReadonlyArray<Tab.OpenTab> =>
  tabs.flatMap((tab) =>
    tab.url !== null && isUrl(tab.url)
      ? [{ url: tab.url, title: tab.title, openedAt: null, lastSeenAt: now }]
      : [],
  );

/**
 * What counts as a change: URLs and titles, in order. `lastSeenAt` is left out, so a snapshot
 * of the same tabs taken later hashes the same.
 */
export const hash = (tabs: ReadonlyArray<Tab.OpenTab>): number =>
  Hash.string(JSON.stringify(tabs.map((tab) => [tab.url, tab.title])));
