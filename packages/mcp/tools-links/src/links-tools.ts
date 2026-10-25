import * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Layer } from "effect";
import { McpSchema, McpServer, Toolkit } from "effect/ai";
import * as GetLinkTool from "./get-link-tool.ts";
import * as ListLinksTool from "./list-links-tool.ts";
import * as SaveLinkTool from "./save-link-tool.ts";
import * as SearchLinksTool from "./search-links-tool.ts";
import * as SetLinkStatusTool from "./set-link-status-tool.ts";

/** Every link tool, by name. */
export const toolkit = Toolkit.make(
  SaveLinkTool.tool,
  SearchLinksTool.tool,
  ListLinksTool.tool,
  GetLinkTool.tool,
  SetLinkStatusTool.tool,
);

const handlers = toolkit.toLayer(
  Effect.gen(function* () {
    const api = yield* ApiClient.StashApiClient;
    return toolkit.of({
      save_link: SaveLinkTool.handle(api),
      search_links: SearchLinksTool.handle(api),
      list_links: ListLinksTool.handle(api),
      get_link: GetLinkTool.handle(api),
      set_link_status: SetLinkStatusTool.handle(api),
    });
  }),
);

// The text the model reads for a successful call. Each one gets the encoded success value, which
// is also the call's `structuredContent`.
const texts: Record<string, (structured: any) => string> = {
  [SaveLinkTool.tool.name]: SaveLinkTool.text,
  [SearchLinksTool.tool.name]: SearchLinksTool.text,
  [ListLinksTool.tool.name]: ListLinksTool.text,
  [GetLinkTool.tool.name]: GetLinkTool.text,
  [SetLinkStatusTool.tool.name]: SetLinkStatusTool.text,
};

// `McpServer` sends the result serialized as JSON for text content. Replace it with concise text
// and keep the JSON as `structuredContent`. Errors keep the server's message.
const withText = (
  name: string,
  result: McpSchema.CallToolResult | McpSchema.InputRequired,
): McpSchema.CallToolResult | McpSchema.InputRequired => {
  const text = texts[name];
  return result instanceof McpSchema.CallToolResult &&
    result.isError !== true &&
    result.structuredContent !== undefined &&
    text !== undefined
    ? new McpSchema.CallToolResult({
        ...result,
        content: [{ type: "text", text: text(result.structuredContent) }],
      })
    : result;
};

/** Registers the link tools with the `McpServer`. Their handlers call the api only. */
export const layer: Layer.Layer<never, never, ApiClient.StashApiClient> = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    yield* McpServer.registerToolkit(toolkit).pipe(
      Effect.provideService(
        McpServer.McpServer,
        McpServer.McpServer.of({
          ...server,
          addTool: (options) =>
            server.addTool({
              ...options,
              handle: (payload) =>
                Effect.map(options.handle(payload), (result) =>
                  withText(options.tool.name, result),
                ),
            }),
        }),
      ),
    );
  }),
).pipe(Layer.provide(handlers), Layer.provide(McpServer.McpServer.layer));
