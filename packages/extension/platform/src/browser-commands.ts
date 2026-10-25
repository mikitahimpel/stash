import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { tryCall, type BrowserError } from "./browser-error.ts";

/** A keyboard command declared in the manifest. */
export interface Command {
  readonly name: string;
  readonly description: string | null;
  /** The bound shortcut, or `null` when the user removed it. */
  readonly shortcut: string | null;
}

/**
 * The extension's keyboard commands (`browser.commands`).
 */
export class Commands extends Context.Service<
  Commands,
  {
    readonly list: Effect.Effect<ReadonlyArray<Command>, BrowserError>;
    /**
     * The name of every command the user triggers from now on. Run it when the background page
     * starts, like `Alarms.fired`.
     */
    readonly triggered: Stream.Stream<string>;
  }
>()("@stash/ext-platform/Commands") {}

/**
 * The live service, backed by `browser.commands`.
 */
export const layer: Layer.Layer<Commands> = Layer.succeed(Commands)({
  list: Effect.map(
    tryCall("commands.getAll", () => browser.commands.getAll()),
    (commands) =>
      commands.flatMap((command) =>
        command.name === undefined
          ? []
          : [
              {
                name: command.name,
                description: command.description || null,
                shortcut: command.shortcut || null,
              },
            ],
      ),
  ),
  triggered: Stream.callback<string>((queue) => {
    const listener = (name: string) => Queue.offerUnsafe(queue, name);
    return Effect.acquireRelease(
      Effect.sync(() => browser.commands.onCommand.addListener(listener)),
      () => Effect.sync(() => browser.commands.onCommand.removeListener(listener)),
    );
  }),
});
