import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import { Context, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";

/** The bindings of the `Mcp` Worker this package reads. Only the app entry passes `env` in. */
export interface ApiEnv {
  /** Service Binding to the `Api` Worker. */
  readonly API: Fetcher;
  /** API token the api resolves to the principal the MCP server acts as. A Worker secret. */
  readonly API_TOKEN: string;
}

/**
 * Service Bindings ignore the host, but `HttpApiClient` needs an absolute URL. This one never
 * leaves the binding.
 */
export const baseUrl = "https://api.internal";

/** The typed client for `apps/api`. Tool packages depend on this service only. */
export class StashApiClient extends Context.Service<
  StashApiClient,
  HttpApiClient.ForApi<typeof Api.StashApi>
>()("@stash/mcp-platform/StashApiClient") {}

/** Sends every request through the Service Binding instead of the global `fetch`. */
export const layerHttpClient = (binding: Fetcher) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch)(((input, init) =>
        binding.fetch(input, init)) as typeof globalThis.fetch),
    ),
  );

/** Forwards the principal: every request carries `Authorization: Bearer <API_TOKEN>`. */
export const layerAuthorization = (token: Redacted.Redacted<string>) =>
  HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, Redacted.value(token))),
  );

/** The live client, built from the Worker `env`. */
export const layer = (env: ApiEnv): Layer.Layer<StashApiClient> =>
  Layer.effect(StashApiClient)(HttpApiClient.make(Api.StashApi, { baseUrl })).pipe(
    Layer.provide([
      layerHttpClient(env.API),
      layerAuthorization(Redacted.make(env.API_TOKEN, { label: "API_TOKEN" })),
    ]),
  );
