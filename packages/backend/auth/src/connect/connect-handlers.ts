import * as StashConfig from "@stash/backend-platform/stash-config";
import * as Api from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

/** The MCP endpoint Claude connects to: always the `/mcp` path of the MCP Worker's origin. */
export const mcpUrl = (mcpOrigin: string | undefined): string | null =>
  mcpOrigin === undefined ? null : `${mcpOrigin}/mcp`;

/** The `connect` group of the `StashApi`. Needs `StashConfig` and the `Authorization` middleware. */
export const layer = HttpApiBuilder.group(Api.StashApi, "connect", (handlers) =>
  Effect.gen(function* () {
    const config = yield* StashConfig.StashConfig;
    return handlers.handle("info", () => Effect.succeed({ mcpUrl: mcpUrl(config.mcpOrigin) }));
  }),
);
