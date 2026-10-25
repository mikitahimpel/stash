import * as StashApiClient from "@stash/web-api-client/stash-api-client";
import * as WebPlatform from "@stash/web-platform/live";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Layer from "effect/Layer";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

/**
 * The atom registry of the app. It provides the live layers: the api client talks to the api
 * through the browser's `fetch` from `@stash/web-platform`. Tests pass a stub `transport`
 * (`@stash/web-api-client/testing`).
 */
export const make = (
  transport: Layer.Layer<HttpClient.HttpClient> = WebPlatform.layerHttpClient,
): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({ initialValues: [[StashApiClient.transport, transport]] });
