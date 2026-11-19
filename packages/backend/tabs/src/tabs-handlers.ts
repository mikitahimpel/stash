import * as ServiceContext from "@stash/backend-platform/service-context";
import type * as SaveRateLimiter from "@stash/backend-links/save-rate-limiter";
import type * as LinksRepo from "@stash/backend-links/links-repo";
import type * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import type * as LinkEvents from "@stash/backend-platform/link-events";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ArchiveTab from "./archive-tab.ts";
import type * as CommandsRepo from "./commands/commands-repo.ts";
import type * as DevicesRepo from "./devices/devices-repo.ts";
import * as ListOpenTabs from "./snapshots/list-open-tabs.ts";
import type * as OpenTabsRepo from "./snapshots/open-tabs-repo.ts";
import * as ReplaceTabsSnapshot from "./snapshots/replace-tabs-snapshot.ts";

// Database, queue and KV failures are defects here: the endpoints declare no error for them, so
// they answer 500.

/**
 * The `tabs` group of the `StashApi`. Needs `DevicesRepo`, `OpenTabsRepo`, `CommandsRepo`, the
 * links services that `archive` saves through (`LinksRepo`, `SaveRateLimiter`, `EnrichmentQueue`, `LinkEvents`)
 * and the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "tabs", (handlers) =>
  Effect.gen(function* () {
    const context = yield* ServiceContext.capture<
      | DevicesRepo.DevicesRepo
      | OpenTabsRepo.OpenTabsRepo
      | CommandsRepo.CommandsRepo
      | LinksRepo.LinksRepo
      | LinkEvents.LinkEvents
      | SaveRateLimiter.SaveRateLimiter
      | EnrichmentQueue.EnrichmentQueue
    >();
    const withServices = Effect.provideContext(context);
    return handlers
      .handle("report", ({ params, payload }) =>
        Effect.gen(function* () {
          const principal = yield* Security.CurrentPrincipal;
          yield* ReplaceTabsSnapshot.replaceTabsSnapshot(principal, params.id, payload);
        }).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("list", () =>
        ListOpenTabs.listOpenTabs.pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("archive", ({ payload }) =>
        Effect.gen(function* () {
          const principal = yield* Security.CurrentPrincipal;
          return yield* ArchiveTab.archiveTab(principal, payload);
        }).pipe(
          withServices,
          Effect.catchTag(["DatabaseError", "EnrichmentQueueError", "KvError"], Effect.die),
        ),
      );
  }),
);
