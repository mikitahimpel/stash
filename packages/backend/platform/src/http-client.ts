import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Layer from "effect/Layer";

/**
 * Outbound HTTP over the Worker's `fetch`. Feature packages depend on `HttpClient` and tests provide
 * their own client, so no test reaches the network.
 */
export const layer: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer;
