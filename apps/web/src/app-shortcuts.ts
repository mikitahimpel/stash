import * as Keyboard from "@stash/web-platform/keyboard";
import * as WebPlatform from "@stash/web-platform/live";
import * as Effect from "effect/Effect";
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

/**
 * The search or filter field of the current page, where the shortcuts put the focus. Pages mark
 * it as a search input (`<SearchField />` from `@stash/web-ui` is one).
 */
export const pageSearchField = "main input[type=search]";

/** `search`: ⌘K or Ctrl+K, anywhere. `filter`: `/`, unless the focus is in a text field. */
export type Shortcut = "search" | "filter";

export const shortcut = (press: Keyboard.KeyPress): Shortcut | undefined => {
  if (press.altKey || press.shiftKey) return undefined;
  if (press.key.toLowerCase() === "k" && press.metaKey !== press.ctrlKey) return "search";
  if (press.key === "/" && !press.typing && !press.metaKey && !press.ctrlKey) return "filter";
  return undefined;
};

/** Focuses the current page's search or filter field, if it has one. */
export const focusPageSearch = runtime.fn(() =>
  Keyboard.Keyboard.use((keyboard) => keyboard.focus(pageSearchField)),
);

/**
 * Handles the shortcuts while it runs: ⌘K / Ctrl+K calls `openSearch` (which navigates to the
 * search page and resolves once it is on screen) and focuses its field; `/` focuses the current
 * page's field. `openSearch` comes in an object, because a function passed to an atom setter is
 * taken as an updater.
 */
export const listen = runtime.fn(
  ({ openSearch }: { readonly openSearch: () => Promise<unknown> }) =>
    Keyboard.Keyboard.use((keyboard) =>
      keyboard
        .presses((press) => shortcut(press) !== undefined)
        .pipe(
          Stream.runForEach((press) =>
            (shortcut(press) === "search" ? Effect.promise(openSearch) : Effect.void).pipe(
              Effect.andThen(keyboard.focus(pageSearchField)),
            ),
          ),
        ),
    ),
);
