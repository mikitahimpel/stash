import * as ApiClient from "@stash/mcp-platform/api-client";
import { Layer } from "effect";
import { McpProtocol, McpServer, Toolkit } from "effect/ai";

/** The MCP endpoint. The OAuth provider protects this path and everything under it. */
export const path = "/mcp";

// `2026-07-28` is sessionless, so any isolate can answer any request. The older revisions keep
// their session in isolate memory: when an isolate is recycled the client gets 404 for its
// `Mcp-Session-Id` and initializes again, as the spec requires.
const protocols = [
  McpProtocol.v2026_07_28,
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
] as const;

// Tools from `packages/mcp/tools-*` are registered here. Their handlers depend on
// `StashApiClient` only.
const tools = McpServer.toolkit(Toolkit.empty);

/** The Streamable HTTP MCP endpoint at `path`, with every tool registered. */
export const layer = (api: Layer.Layer<ApiClient.StashApiClient>) =>
  tools.pipe(
    Layer.provideMerge(McpServer.layerHttp({ name: "stash", version: "0.0.0", path, protocols })),
    Layer.provide(api),
    Layer.orDie,
  );
