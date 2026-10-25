import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { tryCall, type BrowserError } from "./browser-error.ts";

/**
 * An open tab. Only the fields features need, so the Safari port can fill the same shape.
 *
 * `url` and `title` are `null` when the browser withholds them (privileged pages such as
 * `about:` URLs). `hidden` tabs exist but are not shown in the tab strip.
 */
export interface Tab {
  readonly id: number;
  readonly windowId: number;
  readonly url: string | null;
  readonly title: string | null;
  readonly active: boolean;
  readonly pinned: boolean;
  readonly hidden: boolean;
  /** When the tab was last active, in epoch milliseconds, if the browser reports it. */
  readonly lastAccessed: number | null;
}

/** Which tabs to return. Every field that is set must match. */
export interface TabsFilter {
  readonly windowId?: number;
  /** `true`: only tabs in the window that is focused (or was focused last). */
  readonly currentWindow?: boolean;
  readonly active?: boolean;
  readonly pinned?: boolean;
  readonly hidden?: boolean;
}

/**
 * The browser's tabs (`browser.tabs`).
 */
export class Tabs extends Context.Service<
  Tabs,
  {
    /** Every tab that matches `filter`, in window and tab-strip order. */
    readonly query: (filter?: TabsFilter) => Effect.Effect<ReadonlyArray<Tab>, BrowserError>;
    /** The active tab of the current window, if there is one. */
    readonly current: Effect.Effect<Option.Option<Tab>, BrowserError>;
    /** Closes the tabs. Closing a tab that no longer exists fails. */
    readonly remove: (ids: ReadonlyArray<number>) => Effect.Effect<void, BrowserError>;
    /**
     * Emits whenever the set of open tabs may have changed: a tab was opened, closed, moved,
     * shown or hidden, or its URL or title changed. Bursts are not coalesced. Run it when the
     * background page starts, like `Alarms.fired`.
     */
    readonly changed: Stream.Stream<void>;
  }
>()("@stash/ext-platform/Tabs") {}

const fromBrowser = (tab: browser.tabs.Tab): Option.Option<Tab> =>
  tab.id === undefined || tab.id === browser.tabs.TAB_ID_NONE || tab.windowId === undefined
    ? Option.none()
    : Option.some({
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url ?? null,
        title: tab.title ?? null,
        active: tab.active,
        pinned: tab.pinned,
        hidden: tab.hidden ?? false,
        lastAccessed: tab.lastAccessed ?? null,
      });

const queryInfo = (filter: TabsFilter): browser.tabs._QueryQueryInfo => {
  const info: browser.tabs._QueryQueryInfo = {};
  if (filter.windowId !== undefined) info.windowId = filter.windowId;
  if (filter.currentWindow !== undefined) info.currentWindow = filter.currentWindow;
  if (filter.active !== undefined) info.active = filter.active;
  if (filter.pinned !== undefined) info.pinned = filter.pinned;
  if (filter.hidden !== undefined) info.hidden = filter.hidden;
  return info;
};

// The `tabs.onUpdated` fields that change what a snapshot of the open tabs holds.
const relevantUpdate = (change: browser.tabs._OnUpdatedChangeInfo) =>
  change.url !== undefined ||
  change.title !== undefined ||
  change.hidden !== undefined ||
  change.pinned !== undefined;

const changed = Stream.callback<void>((queue) => {
  const notify = () => Queue.offerUnsafe(queue, undefined);
  const onUpdated = (_id: number, change: browser.tabs._OnUpdatedChangeInfo) => {
    if (relevantUpdate(change)) notify();
  };
  const events = [
    browser.tabs.onCreated,
    browser.tabs.onRemoved,
    browser.tabs.onMoved,
    browser.tabs.onAttached,
    browser.tabs.onReplaced,
  ] as ReadonlyArray<WebExtEvent<() => void>>;
  return Effect.acquireRelease(
    Effect.sync(() => {
      for (const event of events) event.addListener(notify);
      browser.tabs.onUpdated.addListener(onUpdated);
    }),
    () =>
      Effect.sync(() => {
        for (const event of events) event.removeListener(notify);
        browser.tabs.onUpdated.removeListener(onUpdated);
      }),
  );
});

const query = (filter: TabsFilter = {}) =>
  Effect.map(
    tryCall("tabs.query", () => browser.tabs.query(queryInfo(filter))),
    (tabs) => tabs.flatMap((tab) => Option.toArray(fromBrowser(tab))),
  );

/**
 * The live service, backed by `browser.tabs`. Needs the `tabs` permission for `url` and `title`.
 */
export const layer: Layer.Layer<Tabs> = Layer.succeed(Tabs)({
  query,
  current: Effect.map(query({ active: true, currentWindow: true }), (tabs) =>
    Option.fromNullishOr(tabs[0]),
  ),
  remove: (ids) =>
    ids.length === 0 ? Effect.void : tryCall("tabs.remove", () => browser.tabs.remove([...ids])),
  changed,
});
