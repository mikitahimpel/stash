import * as StashApiClient from "@stash/web-api-client/stash-api-client";
import * as WebPlatform from "@stash/web-platform/live";
import type * as Theme from "@stash/web-platform/theme";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Layer from "effect/Layer";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as AppTheme from "./app-theme.ts";

/**
 * The atom registry of the app. It provides the live layers: the api client talks to the api
 * through the browser's `fetch`, and the theme lives in `localStorage` and on `<html>`, both from
 * `@stash/web-platform`. Tests pass a stub `transport` (`@stash/web-api-client/testing`) and an
 * in-memory `theme` (`@stash/web-platform/testing`).
 */
export const make = (
  transport: Layer.Layer<HttpClient.HttpClient> = WebPlatform.layerHttpClient,
  theme: Layer.Layer<Theme.Theme> = WebPlatform.layerTheme,
): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({
    initialValues: [
      [StashApiClient.transport, transport],
      [AppTheme.layer, theme],
    ],
  });
