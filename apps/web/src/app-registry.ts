import * as LiveLinks from "@stash/web-api-client/live-links";
import * as StashApiClient from "@stash/web-api-client/stash-api-client";
import * as InboxShortcuts from "@stash/web-links/inbox-shortcuts";
import type * as Keyboard from "@stash/web-platform/keyboard";
import type * as LiveSocket from "@stash/web-platform/live-socket";
import * as WebPlatform from "@stash/web-platform/live";
import type * as Network from "@stash/web-platform/network";
import type * as RecentSearches from "@stash/web-platform/recent-searches";
import * as SearchAtoms from "@stash/web-search/search-atoms";
import type * as Theme from "@stash/web-platform/theme";
import type * as Visibility from "@stash/web-platform/visibility";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as AppNetwork from "./app-network.ts";
import * as AppShortcuts from "./app-shortcuts.ts";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";

/** The layers the app runs on. Each defaults to the browser's. */
export interface Layers {
  readonly transport?: Layer.Layer<HttpClient.HttpClient>;
  readonly theme?: Layer.Layer<Theme.Theme>;
  readonly network?: Layer.Layer<Network.Network>;
  readonly keyboard?: Layer.Layer<Keyboard.Keyboard>;
  readonly recentSearches?: Layer.Layer<RecentSearches.RecentSearches>;
  /** What the live link updates run on: the event stream and the tab's visibility. */
  readonly live?: Layer.Layer<LiveSocket.LiveSocket | Visibility.Visibility>;
}

/**
 * The atom registry of the app. It provides the live layers: the api client talks to the api
 * through the browser's `fetch`, the theme and the recent searches live in `localStorage` (the theme
 * also on `<html>`), the live link updates come over a `WebSocket` while the tab is visible, and the network
 * state and shortcuts (the app's and the Inbox's) come from `navigator` and `document`, all from `@stash/web-platform`. Tests
 * pass a stub `transport` (`@stash/web-api-client/testing`) and in-memory platform layers
 * (`@stash/web-platform/testing`).
 */
export const make = (layers: Layers = {}): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({
    initialValues: [
      [StashApiClient.transport, layers.transport ?? WebPlatform.layerHttpClient],
      [ThemeAtoms.layer, layers.theme ?? WebPlatform.layerTheme],
      [AppNetwork.layer, layers.network ?? WebPlatform.layerNetwork],
      [AppShortcuts.layer, layers.keyboard ?? WebPlatform.layerKeyboard],
      [InboxShortcuts.keyboard, layers.keyboard ?? WebPlatform.layerKeyboard],
      [SearchAtoms.recentLayer, layers.recentSearches ?? WebPlatform.layerRecentSearches],
      [
        LiveLinks.layer,
        layers.live ?? Layer.mergeAll(WebPlatform.layerLiveSocket, WebPlatform.layerVisibility),
      ],
    ],
  });
