import * as ServiceContext from "@stash/backend-platform/service-context";
import type * as Blobs from "@stash/backend-platform/blobs";
import type * as D1Database from "@stash/backend-platform/d1-database";
import type * as LinkEvents from "@stash/backend-platform/link-events";
import type * as Vectors from "@stash/backend-platform/vectors";
import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import type * as AiQuota from "../ai-quota.ts";
import * as UsersRepo from "../users-repo.ts";
import * as GetAccount from "./get-account.ts";
import * as RemoveMember from "./remove-member.ts";
import * as RequireOwner from "./require-owner.ts";

// Database, Vectorize and R2 failures are defects here: the endpoints declare no error for them,
// so they answer 500, and a removal that failed halfway is finished by asking again.

/**
 * The `members` group of the `StashApi`. Needs `UsersRepo`, `AiQuota`, `Database`, `Vectors`,
 * `Blobs`, `LinkEvents` and the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "members", (handlers) =>
  Effect.gen(function* () {
    const context = yield* ServiceContext.capture<
      | UsersRepo.UsersRepo
      | AiQuota.AiQuota
      | D1Database.Database
      | Vectors.Vectors
      | Blobs.Blobs
      | LinkEvents.LinkEvents
    >();
    const withServices = Effect.provideContext(context);
    return handlers
      .handle("me", () =>
        GetAccount.getAccount.pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("list", () =>
        Effect.gen(function* () {
          yield* RequireOwner.requireOwner;
          const repo = yield* UsersRepo.UsersRepo;
          return yield* repo.list;
        }).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("remove", ({ params }) =>
        RemoveMember.removeMember(params.id).pipe(
          withServices,
          Effect.catchTag(["DatabaseError", "VectorsError", "BlobsError"], Effect.die),
        ),
      );
  }),
);
