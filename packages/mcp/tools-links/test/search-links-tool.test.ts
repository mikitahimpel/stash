import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Fixtures from "./link-fixtures.ts";
import * as McpClient from "./mcp-client.ts";

describe("search_links", () => {
  it.effect("returns ranked hits as text and structured content", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("search_links", { query: "economics" });

      assert.isFalse(result.isError);
      assert.strictEqual(
        result.content[0]!.text,
        [
          "2 matching links, best first:",
          "- A video about economics — https://example.com/videos/economics (id seed-video, new, video, #economics)",
          "  How markets set prices.",
          "- https://example.com/economics/notes (id seed-bare, new)",
        ].join("\n"),
      );
      assert.deepStrictEqual(
        result.structuredContent.hits.map((hit: any) => hit.link.id),
        [Fixtures.video.id, Fixtures.bare.id],
      );
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("passes filters to the api and caps the hits at limit", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const filtered = yield* client.callTool("search_links", {
        query: "economics",
        mode: "keyword",
        type: "video",
      });
      assert.deepStrictEqual(
        filtered.structuredContent.hits.map((hit: any) => hit.link.id),
        [Fixtures.video.id],
      );

      const capped = yield* client.callTool("search_links", { query: "example.com", limit: 1 });
      assert.strictEqual(capped.structuredContent.hits.length, 1);
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("says so when nothing matches", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("search_links", { query: "astronomy" });
      assert.isFalse(result.isError);
      assert.strictEqual(result.content[0]!.text, "No saved links match.");
      assert.deepStrictEqual(result.structuredContent, { hits: [] });
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );
});
