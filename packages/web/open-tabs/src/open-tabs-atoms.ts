import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import { StashApiClient } from "@stash/web-api-client/stash-api-client";
import type * as Device from "@stash/contracts-domain/device";
import type { ToastMessage } from "@stash/web-ui/toast-message";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as OpenTabsView from "./open-tabs-view.ts";

/** Every device with its latest tabs snapshot. Refreshes when a `tabs` mutation succeeds. */
export const tabs = ApiAtoms.query(["tabs"], (client) => client.tabs.list());

/**
 * Tabs hidden by an archive or close that is running or done (see `OpenTabsView.Hidden`). Kept
 * alive so a closed tab stays hidden when the user leaves the page and comes back.
 */
export const hidden: Atom.Writable<ReadonlyArray<OpenTabsView.Hidden>> = Atom.make<
  ReadonlyArray<OpenTabsView.Hidden>
>([]).pipe(Atom.keepAlive);

/** Failed actions, shown as toasts. The page removes a toast when it is dismissed. */
export const toasts: Atom.Writable<ReadonlyArray<ToastMessage>> = Atom.make<
  ReadonlyArray<ToastMessage>
>([]).pipe(Atom.keepAlive);

export const dismissToast = (registry: AtomRegistry.AtomRegistry, id: string): void =>
  registry.update(toasts, (all) => all.filter((toast) => toast.id !== id));

/** The tabs grouped by device, without the hidden ones. */
export const view: Atom.Atom<
  AsyncResult.AsyncResult<ReadonlyArray<OpenTabsView.DeviceGroup>, unknown>
> = Atom.make((get) =>
  AsyncResult.map(get(tabs), (all) => OpenTabsView.group(all, get(hidden), DateTime.nowUnsafe())),
);

/** The text in the filter field. */
export const query: Atom.Writable<string> = Atom.make("");

/** The device chip that is on, `null` for All. */
export const device: Atom.Writable<Device.DeviceId | null> = Atom.make<Device.DeviceId | null>(
  null,
);

/** The groups that match the filter text, on every device: what the device chips count. */
export const searched: Atom.Atom<
  AsyncResult.AsyncResult<ReadonlyArray<OpenTabsView.DeviceGroup>, unknown>
> = Atom.make((get) =>
  AsyncResult.map(get(view), (groups) => OpenTabsView.search(groups, get(query))),
);

/** The groups the page shows: the filter text and the device chip applied. */
export const shown: Atom.Atom<
  AsyncResult.AsyncResult<ReadonlyArray<OpenTabsView.DeviceGroup>, unknown>
> = Atom.make((get) =>
  AsyncResult.map(get(view), (groups) =>
    OpenTabsView.apply(groups, { device: get(device), query: get(query) }),
  ),
);

let toastCount = 0;

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
              const toast: ToastMessage = {
                id: `open-tabs-${++toastCount}`,
                title: failure,
                description: tab.title ?? tab.url,
                variant: "destructive",
              };
              registry.update(toasts, (all) => [...all, toast]);
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
