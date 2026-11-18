import * as Keyboard from "@stash/web-platform/keyboard";
import * as WebPlatform from "@stash/web-platform/live";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

/**
 * The `Keyboard` service of the app. Defaults to the browser's (`document`, from
 * `@stash/web-platform`). Tests replace it per registry with `@stash/web-platform/testing`.
 */
export const layer: Atom.Writable<Layer.Layer<Keyboard.Keyboard>> = Atom.make(
  WebPlatform.layerKeyboard,
).pipe(Atom.keepAlive);

const runtime = Atom.runtime((get) => get(layer));

/** The search field in the app header (`<SearchBox />`), where both shortcuts put the focus. */
export const searchField = "header input[type=search]";

/** ⌘K or Ctrl+K, anywhere; `/`, unless the focus is in a text field. */
export const isShortcut = (press: Keyboard.KeyPress): boolean => {
  if (press.altKey || press.shiftKey) return false;
  if (press.key.toLowerCase() === "k" && press.metaKey !== press.ctrlKey) return true;
  return press.key === "/" && !press.typing && !press.metaKey && !press.ctrlKey;
};

/** Focuses the header's search field on each shortcut, while it runs. */
export const listen = runtime.fn(() =>
  Keyboard.Keyboard.use((keyboard) =>
    keyboard.presses(isShortcut).pipe(Stream.runForEach(() => keyboard.focus(searchField))),
  ),
);
