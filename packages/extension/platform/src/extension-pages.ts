import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { tryCall, type BrowserError } from "./browser-error.ts";

/**
 * The extension's own pages: the options page, and the page the calling code runs in (the toolbar
 * popup).
 */
export class ExtensionPages extends Context.Service<
  ExtensionPages,
  {
    /** Opens the options page (`options_ui` in the manifest), or focuses it when it is open. */
    readonly openOptions: Effect.Effect<void, BrowserError>;
    /**
     * Closes the page this code runs in. For the toolbar popup that dismisses it; a page in a
     * normal tab the user opened stays open, as the browser only lets scripts close their own.
     */
    readonly closeCurrent: Effect.Effect<void>;
    /**
     * Emits once when the extension was just installed (not on an update or a browser start). Run
     * it when the background page starts, like `Alarms.fired`.
     */
    readonly installed: Stream.Stream<void>;
  }
>()("@stash/ext-platform/ExtensionPages") {}

/** The live service, backed by `browser.runtime` and `window.close`. */
export const layer: Layer.Layer<ExtensionPages> = Layer.succeed(ExtensionPages)({
  openOptions: tryCall("runtime.openOptionsPage", () => browser.runtime.openOptionsPage()),
  closeCurrent: Effect.sync(() => window.close()),
  installed: Stream.callback<void>((queue) => {
    const listener = (details: browser.runtime._OnInstalledDetails) => {
      if (details.reason === "install") Queue.offerUnsafe(queue, undefined);
    };
    return Effect.acquireRelease(
      Effect.sync(() => browser.runtime.onInstalled.addListener(listener)),
      () => Effect.sync(() => browser.runtime.onInstalled.removeListener(listener)),
    );
  }),
});
