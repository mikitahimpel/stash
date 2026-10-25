import { assert, describe, it } from "@effect/vitest";
import * as Testing from "@stash/mcp-platform/testing";
import { Effect } from "effect";
import * as McpClient from "./mcp-client.ts";

describe("save_link", () => {
  it.effect("saves the link through the api and answers with text and the link", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("save_link", {
        url: "https://example.com/new",
        title: "Something new",
        tags: ["reading"],
      });

      assert.isFalse(result.isError);
      assert.deepStrictEqual(result.content, [
        {
          type: "text",
          text: "Saved https://example.com/new as link-1. Enrichment runs in the background.",
        },
      ]);
      assert.deepInclude(result.structuredContent, {
        id: "link-1",
        url: "https://example.com/new",
        title: "Something new",
        status: "new",
        tags: ["reading"],
      });

      const test = yield* Testing.TestApi;
      const links = yield* test.links;
      assert.deepStrictEqual(
        links.map((link) => [link.id, link.url, link.title]),
        [["link-1", "https://example.com/new", "Something new"]],
      );
    }).pipe(Effect.provide(McpClient.layer())),
  );
});
