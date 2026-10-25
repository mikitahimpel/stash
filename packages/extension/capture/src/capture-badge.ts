import * as ToolbarAction from "@stash/ext-platform/browser-action";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import type * as Scope from "effect/Scope";

/** How long a result stays on the toolbar button. */
export const visibleSeconds = 4;

/**
 * What the toolbar button shows:
 * - `Saving`: the request is in flight.
 * - `Saved`: stored.
 * - `RateLimited` / `Offline`: queued, the retry alarm sends it after `retryInSeconds`.
 * - `NeedsSetup`: queued, the options page has no working API URL and device token.
 * - `Unsupported`: no tab, or a page that is not http(s) (for example `about:` pages).
 * - `Failed`: the API rejected it, or extension storage failed.
 */
export type State =
  | { readonly _tag: "Saving" }
  | { readonly _tag: "Saved" }
  | { readonly _tag: "RateLimited"; readonly retryInSeconds: number }
  | { readonly _tag: "Offline"; readonly retryInSeconds: number }
  | { readonly _tag: "NeedsSetup" }
  | { readonly _tag: "Unsupported" }
  | { readonly _tag: "Failed" };

const green = "#2e7d32";
const amber = "#f9a825";
const red = "#c62828";
const grey = "#616161";

export const badge = (state: State): ToolbarAction.Badge => {
  switch (state._tag) {
    case "Saving":
      return { text: "…", color: grey, title: "Saving to Stash…" };
    case "Saved":
      return { text: "✓", color: green, title: "Saved to Stash" };
    case "RateLimited":
      return {
        text: "wait",
        color: amber,
        title: `Stash is rate limiting saves. Queued, retrying in ${state.retryInSeconds} s.`,
      };
    case "Offline":
      return {
        text: "off",
        color: amber,
        title: `Stash is unreachable. Queued, retrying in ${state.retryInSeconds} s.`,
      };
    case "NeedsSetup":
      return {
        text: "!",
        color: red,
        title: "Queued. Set the API URL and device token in the Stash settings.",
      };
    case "Unsupported":
      return { text: "!", color: red, title: "Only http(s) pages can be saved to Stash." };
    case "Failed":
      return { text: "!", color: red, title: "Stash could not save this tab." };
  }
};

/** Shows a `State` on the toolbar button. */
export interface CaptureBadge {
  /**
   * Replaces the badge at once. Every state but `Saving` is removed after `visibleSeconds`. The
   * timer is a plain sleep and not an alarm: if the page is suspended first, the badge stays
   * until the next save, which is harmless.
   */
  readonly show: (state: State) => Effect.Effect<void>;
}

export const make: Effect.Effect<CaptureBadge, never, ToolbarAction.ToolbarAction | Scope.Scope> =
  Effect.gen(function* () {
    const action = yield* ToolbarAction.ToolbarAction;
    // One fiber owns the badge, so a new state cancels the pending removal of the previous one.
    const handle = yield* FiberHandle.make<void, never>();
    const show = (state: State) =>
      Effect.asVoid(
        FiberHandle.run(
          handle,
          action
            .setBadge(badge(state))
            .pipe(
              Effect.andThen(
                state._tag === "Saving"
                  ? Effect.void
                  : Effect.andThen(
                      Effect.sleep(`${visibleSeconds} seconds`),
                      action.setBadge(null),
                    ),
              ),
              Effect.ignore({ log: "Warn" }),
            ),
        ),
      );
    return { show };
  });
