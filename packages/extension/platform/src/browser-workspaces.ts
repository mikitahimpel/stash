import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

/** A Zen workspace. */
export interface Workspace {
  readonly id: string;
  readonly name: string;
}

/**
 * Zen workspaces.
 *
 * Limits: Zen keeps workspaces in browser chrome code and exposes no WebExtension API for them,
 * and Firefox and Safari have no workspaces at all. The live service therefore always answers
 * `None`, and features fall back to the window (`Tabs.query({ currentWindow: true })`). When a
 * browser adds an API, only this module changes.
 */
export class Workspaces extends Context.Service<
  Workspaces,
  {
    /** The workspace shown in the current window, or `None` when the browser can't tell. */
    readonly current: Effect.Effect<Option.Option<Workspace>>;
    /** The ids of the tabs in `workspace`. */
    readonly tabIds: (workspace: Workspace) => Effect.Effect<ReadonlyArray<number>>;
  }
>()("@stash/ext-platform/Workspaces") {}

/**
 * The live service. See the limits on `Workspaces`.
 */
export const layer: Layer.Layer<Workspaces> = Layer.succeed(Workspaces)({
  current: Effect.succeedNone,
  tabIds: () => Effect.succeed([]),
});
