import { assert, describe, it } from "@effect/vitest";
import * as Testing from "@stash/mcp-platform/testing";
import { Effect } from "effect";
import * as Fixtures from "./link-fixtures.ts";
import * as McpClient from "./mcp-client.ts";

describe("set_link_status", () => {
  it.effect("updates the status through the api", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("set_link_status", {
        id: Fixtures.video.id,
        status: "done",
      });

      assert.isFalse(result.isError);
      assert.deepStrictEqual(result.content, [
        { type: "text", text: "A video about economics (seed-video) is now done." },
      ]);
      assert.strictEqual(result.structuredContent.status, "done");

      const test = yield* Testing.TestApi;
      const links = yield* test.links;
      assert.strictEqual(links.find((link) => link.id === Fixtures.video.id)?.status, "done");
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("rejects an unknown status", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("set_link_status", {
        id: Fixtures.video.id,
        status: "deleted",
      });
      assert.isTrue(result.isError);
      assert.include(result.content[0]!.text, "Invalid parameters for tool 'set_link_status'");
      const test = yield* Testing.TestApi;
      const links = yield* test.links;
      assert.strictEqual(links.find((link) => link.id === Fixtures.video.id)?.status, "new");
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );

  it.effect("answers a tool error for an unknown id", () =>
    Effect.gen(function* () {
      const client = yield* McpClient.McpClient;
      const result = yield* client.callTool("set_link_status", { id: "missing", status: "seen" });
      assert.isTrue(result.isError);
      assert.include(result.content[0]!.text, "NotFound");
    }).pipe(Effect.provide(McpClient.layer(Fixtures.seed))),
  );
});
