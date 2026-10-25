import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Fixtures from "./link-fixtures.ts";
import * as McpClient from "./mcp-client.ts";

const ids = (result: McpClient.CallToolResult) =>
  result.structuredContent.items.map((link: any) => link.id);

describe("list_links", () => {
  it.effect("lists recent links", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("list_links", {});
      assert.isFalse(result.isError);
      assert.deepStrictEqual(ids(result), [
        Fixtures.video.id,
        Fixtures.article.id,
        Fixtures.bare.id,
      ]);
      assert.match(result.content[0]!.text, /^3 links, newest first:\n- A video about economics/);
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("lists links not yet seen", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("list_links", { view: "unseen" });
      assert.deepStrictEqual(ids(result), [Fixtures.video.id, Fixtures.bare.id]);
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("lists links by tag", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("list_links", { tag: "garden" });
      assert.deepStrictEqual(ids(result), [Fixtures.article.id]);
      assert.strictEqual(
        result.content[0]!.text,
        "1 link, newest first:\n- Gardening basics — https://example.com/articles/gardening (id seed-article, seen, article, #garden)",
      );
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("pages with the cursor from the text", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const first = yield* client.callTool("list_links", { limit: 2 });
      assert.deepStrictEqual(ids(first), [Fixtures.video.id, Fixtures.article.id]);
      const cursor = first.structuredContent.nextCursor;
      assert.include(first.content[0]!.text, `call again with cursor "${cursor}"`);

      const rest = yield* client.callTool("list_links", { limit: 2, cursor });
      assert.deepStrictEqual(ids(rest), [Fixtures.bare.id]);
      assert.isNull(rest.structuredContent.nextCursor);
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("says so when the stash is empty", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("list_links", {});
      assert.strictEqual(result.content[0]!.text, "No saved links match.");
    }).pipe(Effect.provide(McpClient.layer())),
  );
});
