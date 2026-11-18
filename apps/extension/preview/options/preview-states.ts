import type * as OptionsActions from "../../entrypoints/options/options-actions.ts";
import type * as OptionsView from "../../entrypoints/options/options-view.ts";

// Made-up states of the options page for `scripts/options-screenshots.ts`: no api, no browser.
// The Stash address, the device and the saved page are invented.

const webOrigin = "https://stash.example.com";
const minute = 60_000;

const notPaired: OptionsView.View = { _tag: "NotPaired", webOrigin };

const views = {
  unpaired: notPaired,
  // The same page after a click on "Connect to Stash": `connect` below never answers.
  pairing: notPaired,
  paired: {
    _tag: "Paired",
    webOrigin,
    deviceName: "Zen on the desk",
    lastSave: {
      title: "Small tools that earn their place on a crowded toolbar",
      at: Date.now() - 12 * minute,
    },
    tabSync: { at: Date.now() - 3 * minute, tabs: 14 },
  },
  error: { _tag: "Unreachable", webOrigin },
} satisfies Record<string, OptionsView.View>;

export type State = keyof typeof views;

export const states = Object.keys(views) as ReadonlyArray<State>;

/** The options page's actions for one made-up state. Nothing leaves the page. */
export const actions = (state: State): OptionsActions.Actions => ({
  load: async () => views[state],
  connect: (_webOrigin, onCheck, signal) => {
    onCheck("k3Xf");
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")));
    });
  },
  saveToken: async () => ({ _tag: "Failed", message: "The preview saves nothing." }),
  openStash: async () => {},
  syncTabs: async () => ({ _tag: "Synced" }),
  disconnect: async () => {},
});
