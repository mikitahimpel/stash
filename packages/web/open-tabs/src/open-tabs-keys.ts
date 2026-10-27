import * as Keyboard from "@stash/web-platform/keyboard";
import * as WebPlatform from "@stash/web-platform/live";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

/**
 * The `Keyboard` service of the page. Defaults to the browser's (`document`, from
 * `@stash/web-platform`). Tests replace it per registry with `@stash/web-platform/testing`.
 */
export const layer: Atom.Writable<Layer.Layer<Keyboard.Keyboard>> = Atom.make(
  WebPlatform.layerKeyboard,
).pipe(Atom.keepAlive);

const runtime = Atom.runtime((get) => get(layer));

/** `up` / `down` move the selection, `archive` (E) and `close` (W) act on the selected tab. */
export type Command = "up" | "down" | "archive" | "close";

/**
 * The page's shortcuts: plain keys outside text fields. Enter is left to the browser: the
 * selected row's link has the focus, so Enter opens it.
 */
export const command = (press: Keyboard.KeyPress): Command | undefined => {
  if (press.typing || press.metaKey || press.ctrlKey || press.altKey) return undefined;
  if (press.key === "ArrowUp") return "up";
  if (press.key === "ArrowDown") return "down";
  if (press.shiftKey) return undefined;
  if (press.key.toLowerCase() === "e") return "archive";
  if (press.key.toLowerCase() === "w") return "close";
  return undefined;
};

/**
 * Calls `run` with every shortcut while it runs, unless `enabled` says no (for example while a
 * dialog is open), in which case the key goes on as usual. Both come in an object, because a
 * function passed to an atom setter is taken as an updater.
 */
export const listen = runtime.fn(
  ({
    enabled,
    run,
  }: {
    readonly enabled: () => boolean;
    readonly run: (command: Command) => void;
  }) =>
    Keyboard.Keyboard.use((keyboard) =>
      keyboard
        .presses((press) => enabled() && command(press) !== undefined)
        .pipe(
          Stream.runForEach((press) =>
            Effect.sync(() => {
              const next = command(press);
              if (next !== undefined) run(next);
            }),
          ),
        ),
    ),
);
