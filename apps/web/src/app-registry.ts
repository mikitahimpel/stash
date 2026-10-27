import * as StashApiClient from "@stash/web-api-client/stash-api-client";
import * as InboxShortcuts from "@stash/web-links/inbox-shortcuts";
import type * as Keyboard from "@stash/web-platform/keyboard";
import * as WebPlatform from "@stash/web-platform/live";
import type * as Network from "@stash/web-platform/network";
import type * as Theme from "@stash/web-platform/theme";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Layer from "effect/Layer";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as AppNetwork from "./app-network.ts";
import * as AppShortcuts from "./app-shortcuts.ts";
import * as AppTheme from "./app-theme.ts";

/** The layers the app runs on. Each defaults to the browser's. */
export interface Layers {
  readonly transport?: Layer.Layer<HttpClient.HttpClient>;
  readonly theme?: Layer.Layer<Theme.Theme>;
  readonly network?: Layer.Layer<Network.Network>;
  readonly keyboard?: Layer.Layer<Keyboard.Keyboard>;
}

/**
 * The atom registry of the app. It provides the live layers: the api client talks to the api
 * through the browser's `fetch`, the theme lives in `localStorage` and on `<html>`, and the network
 * state and shortcuts (the app's and the Inbox's) come from `navigator` and `document`, all from `@stash/web-platform`. Tests
 * pass a stub `transport` (`@stash/web-api-client/testing`) and in-memory platform layers
 * (`@stash/web-platform/testing`).
 */
export const make = (layers: Layers = {}): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({
    initialValues: [
      [StashApiClient.transport, layers.transport ?? WebPlatform.layerHttpClient],
      [AppTheme.layer, layers.theme ?? WebPlatform.layerTheme],
      [AppNetwork.layer, layers.network ?? WebPlatform.layerNetwork],
      [AppShortcuts.layer, layers.keyboard ?? WebPlatform.layerKeyboard],
      [InboxShortcuts.keyboard, layers.keyboard ?? WebPlatform.layerKeyboard],
    ],
  });
