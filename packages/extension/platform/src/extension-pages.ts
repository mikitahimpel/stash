import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  }
>()("@stash/ext-platform/ExtensionPages") {}

/** The live service, backed by `browser.runtime` and `window.close`. */
export const layer: Layer.Layer<ExtensionPages> = Layer.succeed(ExtensionPages)({
  openOptions: tryCall("runtime.openOptionsPage", () => browser.runtime.openOptionsPage()),
  closeCurrent: Effect.sync(() => window.close()),
});
