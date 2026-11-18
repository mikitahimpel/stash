import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import type * as Live from "@stash/ext-platform/live";
import * as TabSync from "@stash/ext-tab-sync/tab-sync";
import * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as OptionsView from "./options-view.ts";
import * as PairExtension from "./pair-extension.ts";
import * as SaveConfig from "./save-config.ts";

/** What became of "Sync tabs now". */
export type SyncResult =
  | { readonly _tag: "Synced" }
  | { readonly _tag: "Failed"; readonly message: string };

/** What the options page can ask for. */
export interface Actions {
  /** The connection and what this browser did last. */
  readonly load: () => Promise<OptionsView.View>;
  /**
   * Pairs with the Stash at `webOrigin` (see `pair-extension.ts`). Resolves when the owner
   * approved, or with the reason it failed. Aborting `signal` stops the wait and rejects.
   */
  readonly connect: (
    webOrigin: string,
    onCheck: (check: string) => void,
    signal: AbortSignal,
  ) => Promise<PairExtension.Result>;
  /** Saves an API URL and device token entered by hand. */
  readonly saveToken: (input: SaveConfig.Input) => Promise<SaveConfig.Result>;
  /** Switches to a Stash tab when one is open, and opens one otherwise. */
  readonly openStash: (webOrigin: string) => Promise<void>;
  /** Sends the open tabs now, also when nothing changed. */
  readonly syncTabs: () => Promise<SyncResult>;
  /** Forgets the device token. The device stays listed in Stash until it is removed there. */
  readonly disconnect: () => Promise<void>;
}

const isAt = (origin: string) => (tab: Tabs.Tab) =>
  tab.url !== null && (tab.url === origin || tab.url.startsWith(`${origin}/`));

/** Unlike the popup's, this one leaves its own page open. */
export const openStash = (webOrigin: string) =>
  Effect.gen(function* () {
    const tabs = yield* Tabs.Tabs;
    const open = (yield* tabs.query()).find(isAt(webOrigin));
    yield* open === undefined ? tabs.open(`${webOrigin}/`) : tabs.focus(open.id);
  }).pipe(Effect.ignore({ log: "Warn" }));

export const syncTabs = TabSync.syncNow.pipe(
  Effect.as<SyncResult>({ _tag: "Synced" }),
  Effect.catchCause(() =>
    Effect.succeed<SyncResult>({
      _tag: "Failed",
      message: "Could not send the open tabs. Stash did not answer.",
    }),
  ),
);

export const disconnect = Effect.flatMap(
  ExtensionConfig.ExtensionConfig,
  (config) => config.clear,
).pipe(Effect.ignore({ log: "Warn" }));

/**
 * The options page's actions on `runtime`: the live platform in the page, in-memory layers in
 * tests. `builtInOrigin` is the Stash this build belongs to (`build-origin.ts`).
 */
export const make = (
  runtime: ManagedRuntime.ManagedRuntime<Live.Services, never>,
  builtInOrigin: string,
): Actions => ({
  load: () => runtime.runPromise(OptionsView.load(builtInOrigin)),
  connect: (webOrigin, onCheck, signal) =>
    runtime.runPromise(PairExtension.connect(webOrigin, onCheck), { signal }),
  saveToken: (input) => runtime.runPromise(SaveConfig.submit(input)),
  openStash: (webOrigin) => runtime.runPromise(openStash(webOrigin)),
  syncTabs: () => runtime.runPromise(syncTabs),
  disconnect: () => runtime.runPromise(disconnect),
});
