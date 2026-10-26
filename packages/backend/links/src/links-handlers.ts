import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiError from "effect/http-api/HttpApiError";
import * as DeleteLink from "./details/delete-link.ts";
import * as GetLink from "./details/get-link.ts";
import * as UpdateLink from "./details/update-link.ts";
import * as LinksRepo from "./links-repo.ts";
import * as ListLinks from "./list/list-links.ts";
import * as SaveLink from "./save/save-link.ts";
import * as SaveLinksBatch from "./save/save-links-batch.ts";
import * as SaveRateLimiter from "./save/save-rate-limiter.ts";

// Database, queue and KV failures are defects here: the endpoints declare no error for them, so
// they answer 500. An unknown cursor answers 400 through the respondable `BadRequest`.

/**
 * The `links` group of the `StashApi`. Needs `LinksRepo`, `SaveRateLimiter`, `EnrichmentQueue`
 * and the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "links", (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<
      LinksRepo.LinksRepo | SaveRateLimiter.SaveRateLimiter | EnrichmentQueue.EnrichmentQueue
    >();
    const withServices = Effect.provideContext(context);
    return handlers
      .handle("save", ({ payload }) =>
        Effect.gen(function* () {
          const principal = yield* Security.CurrentPrincipal;
          return yield* SaveLink.saveLink(principal, payload);
        }).pipe(
          withServices,
          Effect.catchTag(["DatabaseError", "EnrichmentQueueError", "KvError"], Effect.die),
        ),
      )
      .handle("saveBatch", ({ payload }) =>
        Effect.gen(function* () {
          const principal = yield* Security.CurrentPrincipal;
          return { links: yield* SaveLinksBatch.saveLinksBatch(principal, payload.links) };
        }).pipe(
          withServices,
          Effect.catchTag(["DatabaseError", "EnrichmentQueueError", "KvError"], Effect.die),
        ),
      )
      .handle("list", ({ query }) =>
        ListLinks.listLinks(query).pipe(
          withServices,
          Effect.catchTag("DatabaseError", Effect.die),
          Effect.catchTag("InvalidCursor", () => Effect.die(new HttpApiError.BadRequest({}))),
        ),
      )
      .handle("get", ({ params }) =>
        GetLink.getLink(params.id).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("update", ({ params, payload }) =>
        UpdateLink.updateLink(params.id, payload).pipe(
          withServices,
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      )
      .handle("remove", ({ params }) =>
        DeleteLink.deleteLink(params.id).pipe(
          withServices,
          Effect.catchTag("DatabaseError", Effect.die),
        ),
      );
  }),
);
