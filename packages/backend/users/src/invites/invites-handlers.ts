import * as ServiceContext from "@stash/backend-platform/service-context";
import * as Api from "@stash/contracts-api/api";
import * as Errors from "@stash/contracts-domain/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Option from "effect/Option";
import * as RequireOwner from "../members/require-owner.ts";
import * as UsersRepo from "../users-repo.ts";
import * as AcceptInvite from "./accept-invite.ts";
import * as CreateInvite from "./create-invite.ts";
import * as InvitesRepo from "./invites-repo.ts";

// Database failures are defects here: the endpoints declare no error for them, so they answer 500.

/**
 * The `invites` group of the `StashApi`. Needs `InvitesRepo`, `UsersRepo` and the `Authorization`
 * middleware (`check` is open).
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "invites", (handlers) =>
  Effect.gen(function* () {
    const context = yield* ServiceContext.capture<InvitesRepo.InvitesRepo | UsersRepo.UsersRepo>();
    const withServices = Effect.provideContext(context);
    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          yield* RequireOwner.requireOwner;
          const repo = yield* InvitesRepo.InvitesRepo;
          return yield* repo.list;
        }).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("create", () =>
        CreateInvite.createInvite.pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("revoke", ({ params }) =>
        Effect.gen(function* () {
          yield* RequireOwner.requireOwner;
          const repo = yield* InvitesRepo.InvitesRepo;
          const outcome = yield* repo.revoke(params.id, yield* DateTime.now);
          if (outcome === "missing") {
            return yield* new Errors.NotFound({ resource: "invite", id: params.id });
          }
          if (outcome === "accepted") {
            return yield* new Errors.Conflict({ message: "This invite was already accepted" });
          }
        }).pipe(withServices, Effect.catchTag("DatabaseError", Effect.die)),
      )
      .handle("check", ({ payload }) =>
        AcceptInvite.findOpenInvite(payload.token).pipe(
          withServices,
          Effect.catchTag("DatabaseError", Effect.die),
          Effect.flatMap(
            Option.match({
              // Never which of unknown, used, revoked or expired: the endpoint is open.
              onNone: () => Effect.fail(new Errors.NotFound({ resource: "invite", id: "token" })),
              onSome: (invite) => Effect.succeed({ expiresAt: invite.expiresAt }),
            }),
          ),
        ),
      );
  }),
);
