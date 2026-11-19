import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as LinksGroup from "@stash/contracts-api/links";
import type * as Link from "@stash/contracts-domain/link";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import { StashApiClient } from "@stash/web-api-client/stash-api-client";
import * as WebPlatform from "@stash/web-platform/live";
import type { ToastMessage } from "@stash/web-ui/toast-message";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as OpenTabsView from "./open-tabs-view.ts";

/**
 * Every device with its latest tabs snapshot: the api's own answer, cached (it outlives the page
 * and is revalidated when the page opens again). Refreshes when a `tabs` mutation succeeds.
 * Everything the page shows is derived from it, so a change to this answer (a refresh, or a patch
 * laid over it) changes the rows in place.
 */
export const tabs = ApiAtoms.query(["tabs"], (client) => client.tabs.list());

/**
 * The latest saved links (one page, the most the api gives at once), to tell which open tabs are
 * already in Stash. A tab saved longer ago than that shows as not saved; saving it again is
 * harmless (the api answers the stored link). Live link updates are laid over it like over any
 * query, and it refreshes when a `links` mutation succeeds.
 */
export const recentLinks = ApiAtoms.query(["links"], (client) =>
  client.links.list({ query: { limit: LinksGroup.maxPageSize } }),
);

/**
 * Links this page saved a moment ago, by their tab's address: the row says Saved as soon as the
 * api answers, before `recentLinks` has refreshed.
 */
export const justSaved: Atom.Writable<OpenTabsView.SavedIndex> = Atom.make<OpenTabsView.SavedIndex>(
  new Map(),
).pipe(Atom.keepAlive);

/**
 * Tabs hidden by an archive or close that is running or done (see `OpenTabsView.Hidden`). Kept
 * alive so a closed tab stays hidden when the user leaves the page and comes back.
 */
export const hidden: Atom.Writable<ReadonlyArray<OpenTabsView.Hidden>> = Atom.make<
  ReadonlyArray<OpenTabsView.Hidden>
>([]).pipe(Atom.keepAlive);

/** What the page has to say in a toast: a failed action, a copied link. */
export const toasts: Atom.Writable<ReadonlyArray<ToastMessage>> = Atom.make<
  ReadonlyArray<ToastMessage>
>([]).pipe(Atom.keepAlive);

export const dismissToast = (registry: AtomRegistry.AtomRegistry, id: string): void =>
  registry.update(toasts, (all) => all.filter((toast) => toast.id !== id));

let toastCount = 0;
const toast = (registry: AtomRegistry.AtomRegistry, message: Omit<ToastMessage, "id">): void =>
  registry.update(toasts, (all) => [...all, { ...message, id: `open-tabs-${++toastCount}` }]);

/** The saved links the page knows, by page address. Empty until `recentLinks` has answered. */
const saved: Atom.Atom<OpenTabsView.SavedIndex> = Atom.make((get) => {
  const recent = get(recentLinks);
  const links = AsyncResult.isSuccess(recent) ? recent.value.items : [];
  // What this page saved wins: it is the newest copy until the list has refreshed.
  return new Map([...OpenTabsView.savedIndex(links), ...get(justSaved)]);
});

/** The moment the page's ages count from: when the tabs' answer was last read. */
const now: Atom.Atom<DateTime.Utc> = Atom.make((get) => {
  get(tabs);
  return DateTime.nowUnsafe();
});

/** The tabs grouped by device, without the hidden ones, each with its saved link if it has one. */
export const view: Atom.Atom<
  AsyncResult.AsyncResult<ReadonlyArray<OpenTabsView.DeviceGroup>, unknown>
> = Atom.make((get) =>
  AsyncResult.map(get(tabs), (all) =>
    OpenTabsView.group(all, { hidden: get(hidden), saved: get(saved), now: get(now) }),
  ),
);

/** The text in the filter field. */
export const query: Atom.Writable<string> = Atom.make("");

/** The groups the page shows: the device's tabs and the stale ones, with the filter applied. */
export const sections: Atom.Atom<
  AsyncResult.AsyncResult<ReadonlyArray<OpenTabsView.Section>, unknown>
> = Atom.make((get) =>
  AsyncResult.map(get(view), (groups) =>
    OpenTabsView.sections(OpenTabsView.search(groups, get(query)), get(now)),
  ),
);

/** The groups that are folded, by section id. Kept while the app is open. */
export const folded: Atom.Writable<ReadonlySet<string>> = Atom.make<ReadonlySet<string>>(
  new Set<string>(),
).pipe(Atom.keepAlive);

/**
 * An action on one tab with optimistic UI: the tab disappears at once, and if the request fails
 * it comes back and a toast says what went wrong. `concurrent`, so acting on a second tab doesn't
 * interrupt the request for the first.
 */
const optimistic = <A, E>(
  failure: string,
  invalidates: ApiAtoms.Keys,
  run: (client: ApiAtoms.Client, tab: OpenTabsView.TabRow) => Effect.Effect<A, E>,
) =>
  StashApiClient.runtime.fn<OpenTabsView.TabRow>()(
    (tab, get) =>
      Effect.gen(function* () {
        // Through the registry, not `get(...)`, so the action doesn't depend on these atoms.
        const registry = get.registry;
        const entry: OpenTabsView.Hidden = {
          deviceId: tab.deviceId,
          url: tab.url,
          since: yield* DateTime.now,
        };
        registry.update(hidden, (all) => [...all, entry]);
        return yield* StashApiClient.use((client) => run(client, tab)).pipe(
          Reactivity.mutation(invalidates),
          Effect.onError(() =>
            Effect.sync(() => {
              registry.update(hidden, (all) => all.filter((other) => other !== entry));
              toast(registry, {
                title: failure,
                description: tab.title ?? tab.url,
                variant: "destructive",
              });
            }),
          ),
        );
      }),
    { concurrent: true },
  );

/** Saves the tab as a link and queues a `close-tab` command for its device. */
export const archive = optimistic("Couldn't archive the tab", ["tabs", "links"], (client, tab) =>
  client.tabs.archive({
    payload: {
      deviceId: tab.deviceId,
      url: tab.url,
      // A link title is 1–1000 characters; without one the api falls back to enrichment.
      ...(tab.title ? { title: tab.title.slice(0, 1000) } : {}),
    },
  }),
);

/** Queues a `close-tab` command for the tab's device. */
export const closeOnDevice = optimistic("Couldn't close the tab", ["tabs"], (client, tab) =>
  client.devices.sendCommand({
    params: { id: tab.deviceId },
    payload: { kind: "close-tab", url: tab.url },
  }),
);

const saveInput = (tab: OpenTabsView.TabRow): Link.SaveLinkInput => ({
  url: tab.url,
  ...(tab.title ? { title: tab.title.slice(0, 1000) } : {}),
  deviceId: tab.deviceId,
});

/**
 * Saves tabs to Stash and leaves them open (unlike `archive`): one request for one tab or many.
 * Tabs that are saved already, and second tabs of one page, are left out. The rows say Saved as
 * soon as the api answers; if it fails a toast says so and nothing changes.
 */
export const save = StashApiClient.runtime.fn<ReadonlyArray<OpenTabsView.TabRow>>()(
  (tabs, get) =>
    Effect.gen(function* () {
      const registry = get.registry;
      const fresh = new Map<string, OpenTabsView.TabRow>();
      for (const tab of tabs) {
        const key = OpenTabsView.pageKey(tab.url);
        if (tab.saved === null && !fresh.has(key)) fresh.set(key, tab);
      }
      // One call carries at most `maxBatchSize` links; nobody selects more tabs than that.
      const wanted = [...fresh.values()].slice(0, LinksGroup.maxBatchSize);
      if (wanted.length === 0) return 0;
      const links = yield* StashApiClient.use((client) =>
        wanted.length === 1
          ? Effect.map(client.links.save({ payload: saveInput(wanted[0]!) }), (link) => [link])
          : Effect.map(
              client.links.saveBatch({ payload: { links: wanted.map(saveInput) } }),
              (answer) => answer.links,
            ),
      ).pipe(
        Reactivity.mutation(["links"]),
        Effect.onError(() =>
          Effect.sync(() =>
            toast(registry, {
              title:
                wanted.length === 1
                  ? "Couldn't save the tab"
                  : `Couldn't save ${wanted.length} tabs`,
              ...(wanted.length === 1 ? { description: wanted[0]!.title ?? wanted[0]!.url } : {}),
              variant: "destructive",
            }),
          ),
        ),
      );
      // The api answers the links in the order they were sent.
      registry.update(justSaved, (all) => {
        const next = new Map(all);
        wanted.forEach((tab, index) => {
          const link = links[index];
          if (link !== undefined) next.set(OpenTabsView.pageKey(tab.url), link);
        });
        return next;
      });
      if (wanted.length > 1) toast(registry, { title: `Saved ${wanted.length} tabs` });
      return wanted.length;
    }),
  { concurrent: true },
);

/**
 * The `Clipboard` that `copy` writes to. Defaults to the browser's, from `@stash/web-platform`.
 * Tests replace it per registry through `initialValues`.
 */
export const clipboard: Atom.Writable<Layer.Layer<Clipboard.Clipboard>> = Atom.make(
  WebPlatform.layerClipboard,
).pipe(Atom.keepAlive);

const clipboardRuntime = Atom.runtime((get) => get(clipboard));

/** Copies a tab's address and says so in a toast (or that it couldn't). */
export const copy = clipboardRuntime.fn((url: string, get) =>
  Effect.flatMap(Clipboard.Clipboard, (clipboard) => clipboard.writeString(url)).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.sync(() => toast(get.registry, { title: "Link copied" })),
      onFailure: () =>
        Effect.sync(() =>
          toast(get.registry, { title: "Couldn't copy the link", variant: "destructive" }),
        ),
    }),
  ),
);
