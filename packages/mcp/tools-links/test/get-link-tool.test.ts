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
          "By: Example Channel",
          "Tags: economics",
          "Saved: 2026-01-02T03:04:05.000Z",
          "Image: https://example.com/videos/economics.jpg",
          "Summary: How markets set prices.",
        ].join("\n"),
      );
      assert.deepInclude(result.structuredContent, {
        id: Fixtures.video.id,
        url: Fixtures.video.url,
        imageUrl: "https://example.com/videos/economics.jpg",
        createdAt: "2026-01-02T03:04:05.000Z",
      });
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("returns a post on X with its text and author, and no second copy as a summary", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("get_link", { id: Fixtures.post.id });

      assert.isFalse(result.isError);
      assert.strictEqual(
        result.content[0]!.text,
        [
          "Example Writer: An example post about tiny parsers",
          "URL: https://x.com/example_writer/status/1700000000000000001",
          "ID: seed-post",
          "Status: new",
          "Type: other",
          "By: @example_writer",
          "Saved: 2026-01-02T03:04:05.000Z",
          "Post on X by Example Writer (@example_writer), 2026-01-02T03:04:05.000Z:",
          "An example post about tiny parsers",
          "Media: 1 photo",
          "Quotes Example Quoted (@example_quoted): The quoted example",
        ].join("\n"),
      );
      assert.deepNestedInclude(result.structuredContent, {
        "post.text": "An example post about tiny parsers",
        "post.author.handle": "example_writer",
      });
    }).pipe(Effect.provide(McpClient.layer(Fixtures.postSeed))),
  );

  it.effect("says so when a post is unavailable", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("get_link", { id: Fixtures.gonePost.id });
      assert.include(
        result.content[0]!.text,
        "Post on X: unavailable (deleted, protected, or X gave no answer).",
      );
    }).pipe(Effect.provide(McpClient.layer(Fixtures.postSeed))),
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
