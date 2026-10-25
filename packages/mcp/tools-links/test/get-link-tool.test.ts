import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Fixtures from "./link-fixtures.ts";
import * as McpClient from "./mcp-client.ts";

describe("get_link", () => {
  it.effect("returns the link's details as text and the link as structured content", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("get_link", { id: Fixtures.video.id });

      assert.isFalse(result.isError);
      assert.strictEqual(
        result.content[0]!.text,
        [
          "A video about economics",
          "URL: https://example.com/videos/economics",
          "ID: seed-video",
          "Status: new",
          "Type: video",
          "Tags: economics",
          "Saved: 2026-01-02T03:04:05.000Z",
          "Summary: How markets set prices.",
        ].join("\n"),
      );
      assert.deepInclude(result.structuredContent, {
        id: Fixtures.video.id,
        url: Fixtures.video.url,
        createdAt: "2026-01-02T03:04:05.000Z",
      });
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("answers a tool error for an unknown id", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("get_link", { id: "missing" });
      assert.isTrue(result.isError);
      assert.isUndefined(result.structuredContent);
      assert.include(result.content[0]!.text, "NotFound");
      assert.include(result.content[0]!.text, "missing");
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );
});
