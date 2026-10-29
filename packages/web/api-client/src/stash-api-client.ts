import * as StashApi from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as WebPlatform from "@stash/web-platform/live";
import * as Effect from "effect/Effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as AtomHttpApi from "effect/reactivity/AtomHttpApi";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as ApiBaseUrl from "./api-base-url.ts";
import * as Unauthenticated from "./unauthenticated.ts";

/**
 * The `HttpClient` that carries api requests. Defaults to the browser's `fetch` from
 * `@stash/web-platform`. Tests replace it per registry (see `./testing`).
 */
export const transport: Atom.Writable<Layer.Layer<HttpClient.HttpClient>> = Atom.make(
  WebPlatform.layerHttpClient,
).pipe(Atom.keepAlive);

// The browser attaches the session cookie itself, so the client side of `Authorization` forwards
// requests unchanged.
const layerAuthorization = HttpApiMiddleware.layerClient(
  Security.Authorization,
  ({ request, next }) => next(request),
);

// Sends the session cookie (`credentials: include`, which also covers an api on another origin set
// by `VITE_API_BASE_URL`) and emits `unauthenticated` on every 401. Trace headers (`traceparent`,
// `b3`) stay off: the api's CORS doesn't allow them, so a cross-origin preflight would fail.
const withSession = (
  client: HttpClient.HttpClient,
  registry: AtomRegistry.AtomRegistry,
): HttpClient.HttpClient =>
  HttpClient.transform(client, (effect) =>
    effect.pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.tap((response) =>
        response.status === 401 ? Effect.sync(() => Unauthenticated.emit(registry)) : Effect.void,
      ),
    ),
  );

const layerHttpClient = (get: Atom.AtomContext) =>
  Layer.effect(HttpClient.HttpClient)(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return withSession(client, get.registry);
    }),
  ).pipe(Layer.provide(get(transport)));

/**
 * The typed Stash api client, derived from `@stash/contracts-api`. Besides the client service it
 * carries the atom `runtime` and the `query` / `mutation` atom helpers of `AtomHttpApi`. Prefer the
 * helpers in `./api-atoms`, which add invalidation by group.
 */
export class StashApiClient extends AtomHttpApi.Service<StashApiClient>()(
  "@stash/web-api-client/StashApiClient",
  {
    api: StashApi.StashApi,
    httpClient: (get) => Layer.merge(layerHttpClient(get), layerAuthorization),
    baseUrl: ApiBaseUrl.fromEnv,
  },
) {}
