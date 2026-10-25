import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { tryCall, type BrowserError } from "./browser-error.ts";

/** A browser window. */
export interface Window {
  readonly id: number;
  readonly focused: boolean;
  readonly incognito: boolean;
}

/**
 * The browser's windows (`browser.windows`).
 */
export class Windows extends Context.Service<
  Windows,
  {
    /** Every normal window (no popups or devtools). */
    readonly list: Effect.Effect<ReadonlyArray<Window>, BrowserError>;
    /** The window that is focused, or was focused last. */
    readonly lastFocused: Effect.Effect<Option.Option<Window>, BrowserError>;
    /** Closes the window and every tab in it. */
    readonly remove: (id: number) => Effect.Effect<void, BrowserError>;
  }
>()("@stash/ext-platform/Windows") {}

const fromBrowser = (window: browser.windows.Window): Option.Option<Window> =>
  window.id === undefined || window.id === browser.windows.WINDOW_ID_NONE
    ? Option.none()
    : Option.some({ id: window.id, focused: window.focused, incognito: window.incognito });

/**
 * The live service, backed by `browser.windows`.
 */
export const layer: Layer.Layer<Windows> = Layer.succeed(Windows)({
  list: Effect.map(
    tryCall("windows.getAll", () => browser.windows.getAll({ windowTypes: ["normal"] })),
    (windows) => windows.flatMap((window) => Option.toArray(fromBrowser(window))),
  ),
  lastFocused: Effect.map(
    tryCall("windows.getLastFocused", () =>
      browser.windows.getLastFocused({ windowTypes: ["normal"] }),
    ),
    fromBrowser,
  ),
  remove: (id) => tryCall("windows.remove", () => browser.windows.remove(id)),
});
