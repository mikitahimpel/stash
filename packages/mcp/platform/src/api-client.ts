import * as Api from "@stash/contracts-api/api";
import * as InternalApi from "@stash/contracts-api/internal-api";
import * as Security from "@stash/contracts-api/security";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";

/** The bindings of the `Mcp` Worker this package reads. Only the app entry passes `env` in. */
export interface ApiEnv {
  /**
   * Service Binding to the `Api` Worker's `InternalApi` entrypoint: the public `StashApi` plus the
   * internal `POST /internal/mcp-tokens`.
   */
  readonly API: Fetcher;
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

/**
 * The api token of the OAuth grant the current MCP request was authorized with. The app entry
 * provides it per request (the grant's props hold it), so one client serves every grant.
 */
export class GrantApiToken extends Context.Service<GrantApiToken, Redacted.Redacted<string>>()(
  "@stash/mcp-platform/GrantApiToken",
) {}

/** Sends every request through the Service Binding instead of the global `fetch`. */
export const layerHttpClient = (binding: Fetcher) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch)(((input, init) =>
        binding.fetch(input, init)) as typeof globalThis.fetch),
    ),
  );

/**
 * Forwards the principal: every request carries `Authorization: Bearer <token>`, with the current
 * request's `GrantApiToken`, else `fallback`. Without either the request goes out without one and
 * the api answers 401.
 */
export const layerAuthorization = (fallback: Option.Option<Redacted.Redacted<string>>) =>
  HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
    Effect.flatMap(Effect.serviceOption(GrantApiToken), (grant) =>
      Option.match(
        Option.orElse(grant, () => fallback),
        {
          onNone: () => next(request),
          onSome: (token) => next(HttpClientRequest.bearerToken(request, Redacted.value(token))),
        },
      ),
    ),
  );

export interface Options {
  /** The token to send when the request provides no `GrantApiToken`. Tests use it. */
  readonly token?: Redacted.Redacted<string>;
}

/** The live client, built from the Worker `env`. */
export const layer = (env: ApiEnv, options: Options = {}): Layer.Layer<StashApiClient> =>
  Layer.effect(StashApiClient)(HttpApiClient.make(Api.StashApi, { baseUrl })).pipe(
    Layer.provide([
      layerHttpClient(env.API),
      layerAuthorization(Option.fromNullishOr(options.token)),
    ]),
  );

/**
 * Mints the api token for a grant: a user token named `Claude (MCP)` for the Stash user of the
 * GitHub account the OAuth flow verified, listed and revocable in that user's Settings. The api
 * decides who the account is; it fails with `LoginNotAllowed` if it is nobody (not the owner and
 * not a member).
 */
export const createMcpToken = (
  env: ApiEnv,
  account: { readonly login: string; readonly id: string },
) =>
  HttpApiClient.make(InternalApi.InternalApi, { baseUrl }).pipe(
    Effect.flatMap((client) =>
      client.internal.createMcpToken({ payload: { login: account.login, githubId: account.id } }),
    ),
    Effect.map((created) => created.token),
    Effect.provide(layerHttpClient(env.API)),
  );

/**
 * Mints the api token of a grant for whoever the web session `session` (the `stash_session`
 * cookie the browser sent to the MCP sign-in on the site's own host) signs in. Fails with
 * `Unauthorized` for a session that is unknown or expired.
 */
export const createMcpTokenForSession = (env: ApiEnv, session: Redacted.Redacted<string>) =>
  HttpApiClient.make(InternalApi.InternalApi, { baseUrl }).pipe(
    Effect.flatMap((client) =>
      client.internal.createMcpTokenForSession({
        payload: { session: Redacted.value(session) },
      }),
    ),
    Effect.map((created) => ({ token: created.token, userId: created.userId })),
    Effect.provide(layerHttpClient(env.API)),
  );

/**
 * Whether the api still accepts `token`. `false` only when the api answers 401 (revoked or
 * unknown). Any other failure counts as active, so an api outage surfaces as tool errors instead
 * of a sign-in loop.
 */
export const isTokenActive = (env: ApiEnv, token: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const client = yield* StashApiClient;
    return yield* client.auth.me().pipe(
      Effect.as(true),
      Effect.catchTag("Unauthorized", () => Effect.succeed(false)),
      Effect.catch(() => Effect.succeed(true)),
    );
  }).pipe(Effect.provide(layer(env, { token })));
