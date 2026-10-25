import * as ApiTokensRepo from "@stash/backend-auth/api-tokens-repo";
import * as AuthorizationLive from "@stash/backend-auth/authorization-live";
import * as SessionVerifier from "@stash/backend-auth/session-verifier";
import type * as Ai from "@stash/backend-platform/ai";
import type * as D1Database from "@stash/backend-platform/d1-database";
import * as StashConfig from "@stash/backend-platform/stash-config";
import type * as Vectors from "@stash/backend-platform/vectors";
import * as SearchRepo from "@stash/backend-search/search-repo";
import * as SearchService from "@stash/backend-search/search-service";
import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";
import * as Handlers from "./handlers.ts";

/** The platform services the composed API needs. The Worker builds them from `env`. */
export type Requirements = D1Database.Database | StashConfig.StashConfig | Ai.Ai | Vectors.Vectors;

/** Unauthenticated liveness probe. */
const health = HttpRouter.add("GET", "/health", HttpServerResponse.jsonUnsafe({ status: "ok" }));

/** CORS for the web app's origin only. It sends the session cookie, so credentials are allowed. */
const cors = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* StashConfig.StashConfig;
    return HttpRouter.cors({
      allowedOrigins: [config.webOrigin],
      allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["authorization", "content-type"],
      credentials: true,
      maxAge: 86_400,
    });
  }),
);

/**
 * `GET /health` and the `StashApi`, guarded by `Authorization` (API tokens; sessions arrive with
 * GitHub OAuth), with CORS for the web origin. Needs an `HttpRouter` and the platform services.
 */
export const layer: Layer.Layer<never, never, HttpRouter.HttpRouter | Requirements> =
  Layer.mergeAll(
    HttpApiBuilder.layer(Api.StashApi).pipe(
      Layer.provide(Handlers.layer),
      Layer.provide(AuthorizationLive.layer),
      Layer.provide(SessionVerifier.layerDenyAll),
      Layer.provide(ApiTokensRepo.layer),
      Layer.provide(SearchService.layer),
      Layer.provide(SearchRepo.layer),
    ),
    health,
    cors,
  ).pipe(Layer.provide(HttpServer.layerServices));
