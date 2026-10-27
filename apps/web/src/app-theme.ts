import * as WebPlatform from "@stash/web-platform/live";
import * as Theme from "@stash/web-platform/theme";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

/**
 * The `Theme` service of the app. Defaults to the browser's (`localStorage` and `matchMedia`, from
 * `@stash/web-platform`). Tests replace it per registry with `@stash/web-platform/testing`.
 */
export const layer: Atom.Writable<Layer.Layer<Theme.Theme>> = Atom.make(
  WebPlatform.layerTheme,
).pipe(Atom.keepAlive);

const runtime = Atom.runtime((get) => get(layer));

/**
 * The theme preference and the scheme on screen. It is kept alive, so the service keeps
 * following the OS scheme once `main.ts` mounts it.
 */
export const state = runtime
  .atom(Stream.unwrap(Theme.Theme.use((theme) => Effect.succeed(theme.changes))))
  .pipe(Atom.keepAlive);

/** Stores a new preference and applies it. */
export const setPreference = runtime.fn((preference: Theme.Preference) =>
  Theme.Theme.use((theme) => theme.setPreference(preference)),
);
