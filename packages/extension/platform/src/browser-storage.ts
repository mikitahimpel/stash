import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { tryCall, type BrowserError } from "./browser-error.ts";

/** A key that changed, with its new value (`None` when it was removed). */
export interface StorageChange {
  readonly key: string;
  readonly value: Option.Option<unknown>;
}

/**
 * The extension's local storage (`browser.storage.local`). Values are JSON-compatible; decode
 * them with a schema before use.
 */
export class Storage extends Context.Service<
  Storage,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<unknown>, BrowserError>;
    readonly set: (key: string, value: unknown) => Effect.Effect<void, BrowserError>;
    readonly remove: (key: string) => Effect.Effect<void, BrowserError>;
    /** Every change from now on, including those made by other extension pages. */
    readonly changes: Stream.Stream<StorageChange>;
  }
>()("@stash/ext-platform/Storage") {}

/**
 * The live service, backed by `browser.storage.local`. Needs the `storage` permission.
 */
export const layer: Layer.Layer<Storage> = Layer.succeed(Storage)({
  get: (key) =>
    Effect.map(
      tryCall("storage.local.get", () => browser.storage.local.get(key)),
      (items) => (Object.hasOwn(items, key) ? Option.some(items[key]) : Option.none()),
    ),
  set: (key, value) =>
    tryCall("storage.local.set", () => browser.storage.local.set({ [key]: value })),
  remove: (key) => tryCall("storage.local.remove", () => browser.storage.local.remove(key)),
  changes: Stream.callback<StorageChange>((queue) => {
    const listener = (changes: Record<string, browser.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      for (const [key, change] of Object.entries(changes)) {
        Queue.offerUnsafe(queue, {
          key,
          value: Object.hasOwn(change, "newValue") ? Option.some(change.newValue) : Option.none(),
        });
      }
    };
    return Effect.acquireRelease(
      Effect.sync(() => browser.storage.onChanged.addListener(listener)),
      () => Effect.sync(() => browser.storage.onChanged.removeListener(listener)),
    );
  }),
});
