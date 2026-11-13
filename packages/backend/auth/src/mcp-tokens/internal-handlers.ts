import * as StashConfig from "@stash/backend-platform/stash-config";
import * as InternalApi from "@stash/contracts-api/internal-api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ApiTokensRepo from "../api-tokens/api-tokens-repo.ts";
import * as CreateMcpToken from "./create-mcp-token.ts";

/**
 * The `internal` group of the `InternalApi`. Needs `ApiTokensRepo` and `StashConfig`. Serve it only
 * where a Service Binding is the sole caller: it has no auth middleware.
 */
export const layer = HttpApiBuilder.group(InternalApi.InternalApi, "internal", (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<ApiTokensRepo.ApiTokensRepo | StashConfig.StashConfig>();
    return handlers.handle("createMcpToken", ({ payload }) =>
      CreateMcpToken.createMcpToken(payload.login).pipe(
        Effect.provideContext(context),
        Effect.catchTag("DatabaseError", Effect.die),
      ),
    );
  }),
);
