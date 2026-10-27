import * as Keyboard from "@stash/web-platform/keyboard";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

/**
 * The `Keyboard` service the Inbox listens on. The default hears no keys: `apps/web` sets the
 * browser's (`@stash/web-platform/live`) in its registry, and tests set the in-memory one
 * (`@stash/web-platform/testing`).
 */
export const keyboard: Atom.Writable<Layer.Layer<Keyboard.Keyboard>> = Atom.make(
  Layer.succeed(Keyboard.Keyboard)({
    presses: () => Stream.never,
    focus: () => Effect.succeed(false),
  }),
).pipe(Atom.keepAlive);

const runtime = Atom.runtime((get) => get(keyboard));

/** ↑/↓ select a row, ↵ opens it, S marks it seen, D done, E archives it. */
export type Command = "previous" | "next" | "open" | "seen" | "done" | "archive";

const commands: Readonly<Record<string, Command>> = {
  ArrowUp: "previous",
  ArrowDown: "next",
  Enter: "open",
  s: "seen",
  d: "done",
  e: "archive",
};

/**
 * The command of `press`, if it is one. Keys typed into a field, keys a control on the page
 * already handled (such as arrows on the feed tabs) and keys with a modifier are not commands, and
 * neither is ↵ on a link or button, which follows or presses it.
 */
export const command = (press: Keyboard.KeyPress): Command | undefined => {
  if (press.typing || press.handled || press.metaKey || press.ctrlKey || press.altKey) {
    return undefined;
  }
  const found = commands[press.key.length === 1 ? press.key.toLowerCase() : press.key];
  return found === "open" && press.control ? undefined : found;
};

/**
 * Calls `run` with each command while it runs. `run` comes in an object, because a function
 * passed to an atom setter is taken as an updater.
 */
export const listen = runtime.fn(({ run }: { readonly run: (command: Command) => void }) =>
  Keyboard.Keyboard.use((keyboard) =>
    keyboard
      .presses((press) => command(press) !== undefined)
      .pipe(
        Stream.runForEach((press) => {
          const found = command(press);
          return found === undefined ? Effect.void : Effect.sync(() => run(found));
        }),
      ),
  ),
);
