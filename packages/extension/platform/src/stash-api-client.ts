import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as Layer from "effect/Layer";
import * as ExtensionConfig from "./extension-config.ts";

// Every request reads the config, so a token saved on the options page applies without a restart.
// That is why the bearer token is set by the HTTP client and not by the `Authorization` client
// middleware: a client middleware can't fail with `ConfigError`.
const make = Effect.gen(function* () {
  const config = yield* ExtensionConfig.ExtensionConfig;
  const httpClient = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequestEffect((request) =>
      Effect.map(config.get, ({ apiBaseUrl, deviceToken }) =>
        request.pipe(
          HttpClientRequest.prependUrl(apiBaseUrl.toString()),
          HttpClientRequest.bearerToken(deviceToken),
        ),
      ),
    ),
  );
  return yield* HttpApiClient.makeWith(Api.StashApi, { httpClient }).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) => next(request)),
    ),
  );
});

/**
 * The typed Stash API client (`HttpApiClient` from `@stash/contracts-api`), authenticated with
 * the device token from `ExtensionConfig`. Every method can also fail with `ConfigError` (no
 * token saved yet) or `BrowserError` (storage failed).
 */
export class StashApiClient extends Context.Service<StashApiClient, Effect.Success<typeof make>>()(
  "@stash/ext-platform/StashApiClient",
) {}

/** Needs an `HttpClient`: `fetch` in `./live`, a handler in `./testing`. */
export const layer: Layer.Layer<
  StashApiClient,
  never,
  ExtensionConfig.ExtensionConfig | HttpClient.HttpClient
> = Layer.effect(StashApiClient)(make);
