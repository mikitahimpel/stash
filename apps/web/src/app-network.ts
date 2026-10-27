import * as WebPlatform from "@stash/web-platform/live";
import * as Network from "@stash/web-platform/network";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

/**
 * The `Network` service of the app. Defaults to the browser's (`navigator.onLine`, from
 * `@stash/web-platform`). Tests replace it per registry with `@stash/web-platform/testing`.
 */
export const layer: Atom.Writable<Layer.Layer<Network.Network>> = Atom.make(
  WebPlatform.layerNetwork,
).pipe(Atom.keepAlive);

const runtime = Atom.runtime((get) => get(layer));

/** Whether the device is online: the header's sync status. */
export const online = runtime.atom(
  Stream.unwrap(Network.Network.use((network) => Effect.succeed(network.changes))),
);
