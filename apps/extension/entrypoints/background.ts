import * as SaveAllAndClose from "@stash/ext-capture/save-all-and-close";
import * as SaveCurrentTab from "@stash/ext-capture/save-current-tab";
import * as CommandsPoller from "@stash/ext-device-commands/commands-poller";
import * as ExtensionPages from "@stash/ext-platform/extension-pages";
import * as Live from "@stash/ext-platform/live";
import * as TabSync from "@stash/ext-tab-sync/tab-sync";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { defineBackground } from "wxt/utils/define-background";

/** The page the `save-all-and-close` command opens to confirm (`entrypoints/save-all-and-close/`). */
export const saveAllConfirmPage = "/save-all-and-close.html";

/**
 * First run: a fresh install opens the options page, where the browser is connected to Stash. The
 * listener starts at once, so the browser sees it before the page's first `await`.
 */
export const firstRun: Layer.Layer<never, never, ExtensionPages.ExtensionPages> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const pages = yield* ExtensionPages.ExtensionPages;
      yield* Effect.forkScoped(
        Stream.runForEach(pages.installed, () => Effect.ignore(pages.openOptions, { log: "Warn" })),
        { startImmediately: true },
      );
    }),
  );

/**
 * Everything the background page runs. Each feature package (`@stash/ext-capture`,
 * `@stash/ext-tab-sync`, `@stash/ext-device-commands`) merges its layer in here.
 */
export const layer: Layer.Layer<never, never, Live.Services> = Layer.mergeAll(
  SaveCurrentTab.layer,
  SaveAllAndClose.layer({ confirmPage: saveAllConfirmPage }),
  CommandsPoller.layer,
  TabSync.layer(),
  firstRun,
);

/** `layer` on top of the platform services, running until the background page unloads. */
export const main = (platform: Layer.Layer<Live.Services>): Effect.Effect<never> =>
  Layer.launch(layer.pipe(Layer.provide(platform)));

export default defineBackground(() => {
  Effect.runFork(main(Live.layer));
});
