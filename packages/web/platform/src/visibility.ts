import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

export type VisibilityState = "visible" | "hidden";

/**
 * Whether the page is visible to the user (Page Visibility API).
 */
export class Visibility extends Context.Service<
  Visibility,
  {
    /** The current state. */
    readonly current: Effect.Effect<VisibilityState>;
    /** Emits the current state first, then every change. Repeated values are dropped. */
    readonly changes: Stream.Stream<VisibilityState>;
  }
>()("@stash/web-platform/Visibility") {}

/**
 * The live service, backed by `document.visibilityState` and the `visibilitychange` event.
 */
export const layer: Layer.Layer<Visibility> = Layer.succeed(Visibility)({
  current: Effect.sync(() => document.visibilityState),
  changes: Stream.callback<VisibilityState>((queue) => {
    const emit = () => Queue.offerUnsafe(queue, document.visibilityState);
    return Effect.acquireRelease(
      Effect.sync(() => {
        document.addEventListener("visibilitychange", emit);
        emit();
      }),
      () => Effect.sync(() => document.removeEventListener("visibilitychange", emit)),
    );
  }).pipe(Stream.changes),
});
