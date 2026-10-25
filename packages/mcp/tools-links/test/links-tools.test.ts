import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as McpClient from "./mcp-client.ts";

describe("LinksTools.layer", () => {
  it.effect("lists every link tool with JSON Schema input and output", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const { result } = yield* client.request("tools/list");
      const tools = new Map<string, any>(result.tools.map((tool: any) => [tool.name, tool]));
      assert.deepStrictEqual([...tools.keys()].sort(), [
        "get_link",
        "list_links",
        "save_link",
        "search_links",
        "set_link_status",
      ]);
      for (const tool of tools.values()) {
        assert.isString(tool.description);
        assert.strictEqual(tool.inputSchema.type, "object");
        assert.strictEqual(tool.outputSchema.type, "object");
        assert.isFalse(tool.annotations.openWorldHint);
      }
      assert.deepStrictEqual(tools.get("save_link").inputSchema.required, ["url"]);
      assert.deepStrictEqual(tools.get("search_links").inputSchema.required, ["query"]);
      assert.deepStrictEqual(tools.get("set_link_status").inputSchema.required, ["id", "status"]);
      assert.isTrue(tools.get("search_links").annotations.readOnlyHint);
      assert.isTrue(tools.get("list_links").annotations.readOnlyHint);
      assert.isTrue(tools.get("get_link").annotations.readOnlyHint);
      assert.isFalse(tools.get("save_link").annotations.readOnlyHint);
      assert.isTrue(tools.get("set_link_status").annotations.idempotentHint);
    }).pipe(Effect.provide(McpClient.layer())),
  );

  it.effect("answers invalid arguments with a tool error the model can correct", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("save_link", { url: "not a url" });
      assert.isTrue(result.isError);
      assert.include(result.content[0]!.text, "Expected an absolute http(s) URL");
    }).pipe(Effect.provide(McpClient.layer())),
  );
});
