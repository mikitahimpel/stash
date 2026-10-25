import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * Whether the device has network connectivity, as the browser reports it.
 */
export class Network extends Context.Service<
  Network,
  {
    /** The current state: `true` when online. */
    readonly isOnline: Effect.Effect<boolean>;
    /** Emits the current state first, then every change. Repeated values are dropped. */
    readonly changes: Stream.Stream<boolean>;
  }
>()("@stash/web-platform/Network") {}

/**
 * The live service, backed by `navigator.onLine` and the window `online` / `offline` events.
 */
export const layer: Layer.Layer<Network> = Layer.succeed(Network)({
  isOnline: Effect.sync(() => navigator.onLine),
  changes: Stream.callback<boolean>((queue) => {
    const online = () => Queue.offerUnsafe(queue, true);
    const offline = () => Queue.offerUnsafe(queue, false);
    return Effect.acquireRelease(
      Effect.sync(() => {
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        Queue.offerUnsafe(queue, navigator.onLine);
      }),
      () =>
        Effect.sync(() => {
          window.removeEventListener("online", online);
          window.removeEventListener("offline", offline);
        }),
    );
  }).pipe(Stream.changes),
});
