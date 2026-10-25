import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { tryCall, type BrowserError } from "./browser-error.ts";

/** A badge on the toolbar button: a few characters on a colored background. */
export interface Badge {
  /** Keep it to about four characters, the browser cuts off the rest. */
  readonly text: string;
  /** A CSS color, for example `#2e7d32`. */
  readonly color: string;
  /** The tooltip while the badge is shown. `null` keeps the manifest's default title. */
  readonly title: string | null;
}

/**
 * The extension's toolbar button (`browser.browserAction` in Manifest V2, `browser.action` in
 * Manifest V3). The badge is global, not per tab.
 */
export class ToolbarAction extends Context.Service<
  ToolbarAction,
  {
    /** Shows `badge`, or removes the badge and restores the default title with `null`. */
    readonly setBadge: (badge: Badge | null) => Effect.Effect<void, BrowserError>;
    /**
     * Every click on the button from now on. Run it when the background page starts, like
     * `Alarms.fired`. Only fires while the button has no popup.
     */
    readonly clicked: Stream.Stream<void>;
  }
>()("@stash/ext-platform/ToolbarAction") {}

// Firefox builds Manifest V2, where only `browserAction` exists. `action` is the V3 name.
const api = () => browser.action ?? browser.browserAction;

/**
 * The live service. Needs `browser_action` (V2) or `action` (V3) in the manifest.
 */
export const layer: Layer.Layer<ToolbarAction> = Layer.succeed(ToolbarAction)({
  setBadge: (badge) =>
    Effect.all(
      [
        tryCall("action.setBadgeText", () => api().setBadgeText({ text: badge?.text ?? "" })),
        ...(badge === null
          ? []
          : [
              tryCall("action.setBadgeBackgroundColor", () =>
                api().setBadgeBackgroundColor({ color: badge.color }),
              ),
            ]),
        tryCall("action.setTitle", () => api().setTitle({ title: badge?.title ?? null })),
      ],
      { discard: true },
    ),
  clicked: Stream.callback<void>((queue) => {
    const listener = () => Queue.offerUnsafe(queue, undefined);
    return Effect.acquireRelease(
      Effect.sync(() => api().onClicked.addListener(listener)),
      () => Effect.sync(() => api().onClicked.removeListener(listener)),
    );
  }),
});
