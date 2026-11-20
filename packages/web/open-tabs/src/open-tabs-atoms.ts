import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as LinksGroup from "@stash/contracts-api/links";
import type * as TabsGroup from "@stash/contracts-api/tabs";
import type * as Link from "@stash/contracts-domain/link";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as LinkPatches from "@stash/web-api-client/link-patches";
import { StashApiClient } from "@stash/web-api-client/stash-api-client";
import * as TabPatches from "@stash/web-api-client/tab-patches";
import * as WebPlatform from "@stash/web-platform/live";
import type { ToastMessage } from "@stash/web-ui/toast-message";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as OpenTabsView from "./open-tabs-view.ts";

/**
 * Every device with its latest tabs snapshot and which of its tabs are saved: the api's own
 * answer, cached (it outlives the page and is revalidated when the page opens again). Refreshes
 * when a `tabs` mutation succeeds.
 */
export const tabs = ApiAtoms.query(["tabs"], (client) => client.tabs.list());

// The gap count each registry has asked again for, so one gap is one request.
const gapsAsked = new WeakMap<AtomRegistry.AtomRegistry, number>();

/** Asks for `tabs` again once per gap of the stream that happens while Open now is read. */
const askAfterGap: Atom.Atom<number> = Atom.make((get) => {
  const count = get(TabPatches.gaps);
  const asked = gapsAsked.get(get.registry);
  gapsAsked.set(get.registry, count);
  if (asked !== undefined && asked !== count) get.registry.refresh(tabs);
  return count;
});

/**
 * `tabs` with what the live stream said since laid over it (`TabPatches`): a device that reported
 * new tabs shows them at once, with no request. Everything the page shows is derived from it, so
 * a change (a refresh, or a patch) changes the rows in place. After a gap of the stream it asks
 * the api again, in the background.
 */
export const live: Atom.Atom<AsyncResult.AsyncResult<TabsGroup.AllTabs, unknown>> = Atom.make(
  (get) => {
    get(askAfterGap);
    return AsyncResult.map(get(tabs), (all) => TabPatches.apply(all, get(TabPatches.state)));
  },
);

/**
 * Links this page saved a moment ago, by their tab's address: the row says Saved as soon as the
 * api answers, before the device reports its tabs again.
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
const toast = (registry: AtomRegistry.AtomRegistry, message: Omit<ToastMessage, "id">): string => {
  const id = `open-tabs-${++toastCount}`;
  registry.update(toasts, (all) => [...all, { ...message, id }]);
  return id;
};

/**
 * What the page knows about saved links besides the api's `saved`: the links the live stream
 * reported (saved on any device since) and what this page saved, by page address, and the links
 * it reported deleted.
 */
const saved: Atom.Atom<OpenTabsView.SavedOverlay> = Atom.make((get) => {
  const streamed: Array<Link.Link> = [];
  const deleted = new Set<string>();
  for (const [id, patch] of get(LinkPatches.state)) {
    if (patch._tag === "Updated") streamed.push(patch.link);
    else deleted.add(id);
  }
  // Newest first, as `savedIndex` keeps the first link of a page; what this page saved wins.
  const index = new Map([...OpenTabsView.savedIndex(streamed.reverse()), ...get(justSaved)]);
  return { index, deleted };
});

/** How often the ages on the page are counted again. */
export const tickMillis = 60_000;

/**
 * The moment the page's ages count from: now, again every minute and whenever the tabs change,
 * so `open 5 min`, `active 2 min ago` and `synced …` move on by themselves.
 */
const now: Atom.Atom<DateTime.Utc> = Atom.make((get) => {
  get(live);
  const timer = setInterval(() => get.setSelf(DateTime.nowUnsafe()), tickMillis);
  get.addFinalizer(() => clearInterval(timer));
  return DateTime.nowUnsafe();
});

/** The tabs grouped by device, without the hidden ones, each with its saved link if it has one. */
export const view: Atom.Atom<
  AsyncResult.AsyncResult<ReadonlyArray<OpenTabsView.DeviceGroup>, unknown>
> = Atom.make((get) =>
  AsyncResult.map(get(live), (all) =>
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

/**
 * How long Close on device waits before it sends the command, with an Undo in a toast. A command
 * that was sent can't be taken back: the device closes the tab when it next checks in.
 */
export const closeDelay: Atom.Writable<Duration.Duration> = Atom.make(Duration.seconds(5)).pipe(
  Atom.keepAlive,
);

// The closes that wait for their delay, by the id of their toast: completing one undoes it.
const pendingCloses = new WeakMap<
  AtomRegistry.AtomRegistry,
  Map<string, Deferred.Deferred<void>>
>();

/** Takes back the close whose toast has this id, if it has not been sent yet. */
export const undoClose = (registry: AtomRegistry.AtomRegistry, toastId: string): void => {
  const pending = pendingCloses.get(registry)?.get(toastId);
  if (pending !== undefined) Deferred.doneUnsafe(pending, Effect.void);
};

/**
 * Closes the tab on its device, with a way back: the tab disappears at once and a toast offers
 * Undo for `closeDelay`; only then is the `close-tab` command queued. Undo brings the tab back
 * and sends nothing. If the request fails the tab comes back and a toast says so. Kept alive, so
 * leaving the page within the delay still closes the tab.
 */
export const closeOnDevice = StashApiClient.runtime
  .fn<OpenTabsView.TabRow>()(
    (tab, get) =>
      Effect.gen(function* () {
        const registry = get.registry;
        const entry: OpenTabsView.Hidden = {
          deviceId: tab.deviceId,
          url: tab.url,
          since: yield* DateTime.now,
        };
        const show = () => registry.update(hidden, (all) => all.filter((other) => other !== entry));
        registry.update(hidden, (all) => [...all, entry]);

        const delay = registry.get(closeDelay);
        const undone = yield* Deferred.make<void>();
        const id = toast(registry, {
          title: `Closing on ${tab.deviceName}`,
          description: tab.title ?? tab.url,
          action: "Undo",
          duration: Duration.toMillis(delay),
        });
        let pending = pendingCloses.get(registry);
        if (pending === undefined) pendingCloses.set(registry, (pending = new Map()));
        pending.set(id, undone);
        const waited = yield* Effect.raceFirst(
          Effect.as(Effect.sleep(delay), "send" as const),
          Effect.as(Deferred.await(undone), "undo" as const),
        ).pipe(Effect.ensuring(Effect.sync(() => pendingCloses.get(registry)?.delete(id))));
        dismissToast(registry, id);
        if (waited === "undo") {
          show();
          return null;
        }
        return yield* StashApiClient.use((client) =>
          client.devices.sendCommand({
            params: { id: tab.deviceId },
            payload: { kind: "close-tab", url: tab.url },
          }),
        ).pipe(
          Reactivity.mutation(["tabs"]),
          Effect.onError(() =>
            Effect.sync(() => {
              show();
              toast(registry, {
                title: "Couldn't close the tab",
                description: tab.title ?? tab.url,
                variant: "destructive",
              });
            }),
          ),
        );
      }),
    { concurrent: true },
  )
  .pipe(Atom.keepAlive);

const saveInput = (tab: OpenTabsView.TabRow): Link.SaveLinkInput => ({
  url: tab.url,
  ...(tab.title ? { title: tab.title.slice(0, 1000) } : {}),
  deviceId: tab.deviceId,
});

/**
 * Saves tabs to Stash and leaves them open (unlike `archive`): one request for one tab or many.
 * Tabs that are saved already, and second tabs of one page, are left out. The rows say Saved as
 * soon as the api answers; if it fails a toast says so and nothing changes. More tabs than one
 * request carries (`maxBatchSize`) are saved up to that many, and the toast says how many are left.
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
      // One call carries at most `maxBatchSize` links; what is over that is left for a second
      // go, and the toast says how many.
      const wanted = [...fresh.values()].slice(0, LinksGroup.maxBatchSize);
      const left = fresh.size - wanted.length;
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
          if (link !== undefined) {
            next.set(OpenTabsView.pageKey(tab.url), { id: link.id, imageUrl: link.imageUrl });
          }
        });
        return next;
      });
      if (wanted.length > 1) {
        toast(registry, {
          title: `Saved ${wanted.length} tabs`,
          ...(left > 0
            ? { description: `${left} more are not saved yet: save again for the rest.` }
            : {}),
        });
      }
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
