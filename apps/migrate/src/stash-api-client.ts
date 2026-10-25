import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import { Config, Context, Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";

/** Env var with the api's base URL, for example `https://<worker>.workers.dev`. */
export const urlEnvVar = "STASH_API_URL";

/** Env var with the API token the import authenticates with. Only ever read through `pp run`. */
export const tokenEnvVar = "STASH_API_TOKEN";

/** The typed client for `apps/api`. The importer depends on this service only. */
export class StashApiClient extends Context.Service<
  StashApiClient,
  HttpApiClient.ForApi<typeof Api.StashApi>
>()("@stash/migrate/StashApiClient") {}

export interface Options {
  readonly baseUrl: string;
  readonly token: Redacted.Redacted<string>;
}

/** Every request carries `Authorization: Bearer <token>`. */
export const layerAuthorization = (token: Redacted.Redacted<string>) =>
  HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, Redacted.value(token))),
  );

/** The client over whatever `HttpClient` is provided: Node's in the CLI, a stub in tests. */
export const layer = (
  options: Options,
): Layer.Layer<StashApiClient, never, HttpClient.HttpClient> =>
  Layer.effect(StashApiClient)(HttpApiClient.make(Api.StashApi, { baseUrl: options.baseUrl })).pipe(
    Layer.provide(layerAuthorization(options.token)),
  );

/** The client configured from `STASH_API_URL` and `STASH_API_TOKEN`. */
export const layerConfig: Layer.Layer<StashApiClient, Config.ConfigError, HttpClient.HttpClient> =
  Layer.unwrap(
    Effect.gen(function* () {
      const baseUrl = yield* Config.String(urlEnvVar);
      const token = yield* Config.Redacted(tokenEnvVar);
      return layer({ baseUrl, token });
    }),
  );
