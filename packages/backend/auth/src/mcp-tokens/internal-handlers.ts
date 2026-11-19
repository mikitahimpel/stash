import * as ServiceContext from "@stash/backend-platform/service-context";
import * as StashConfig from "@stash/backend-platform/stash-config";
import * as InternalApi from "@stash/contracts-api/internal-api";
import type * as InvitesRepo from "@stash/backend-users/invites-repo";
import type * as UsersRepo from "@stash/backend-users/users-repo";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import * as CreateMcpToken from "./create-mcp-token.ts";

/**
 * The `internal` group of the `InternalApi`. Needs `ApiTokensRepo`, `UsersRepo`, `InvitesRepo`
 * and `StashConfig`. Serve it only
 * where a Service Binding is the sole caller: it has no auth middleware.
 */
export const layer = HttpApiBuilder.group(InternalApi.InternalApi, "internal", (handlers) =>
  Effect.gen(function* () {
    const context = yield* ServiceContext.capture<
      | ApiTokensRepo.ApiTokensRepo
      | UsersRepo.UsersRepo
      | InvitesRepo.InvitesRepo
      | StashConfig.StashConfig
    >();
    return handlers.handle("createMcpToken", ({ payload }) =>
      CreateMcpToken.createMcpToken({ id: payload.githubId, login: payload.login }).pipe(
        Effect.provideContext(context),
        Effect.catchTag("DatabaseError", Effect.die),
      ),
    );
  }),
);
