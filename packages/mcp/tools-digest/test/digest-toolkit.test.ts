import { assert, describe, it } from "@effect/vitest";
import * as Digest from "@stash/contracts-domain/digest";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Testing from "@stash/mcp-platform/testing";
import { DateTime, Effect, Layer, Option, Schema, Stream } from "effect";
import * as DigestToolkit from "../src/digest-toolkit.ts";

const digest: Digest.Digest = {
  periodStart: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
  periodEnd: DateTime.makeUnsafe("2026-01-08T00:00:00.000Z"),
  generatedAt: DateTime.makeUnsafe("2026-01-08T00:00:00.000Z"),
  totals: { saved: 3, seen: 2, done: 1, archived: 0 },
  topTags: [{ name: Tag.TagName.make("economics"), count: 2 }],
  topTypes: [{ type: "video", count: 1 }],
  highlights: [
    {
      linkId: Link.LinkId.make("link-1"),
      url: Schema.decodeUnknownSync(Link.Url)("https://example.com/videos/economics"),
      title: "A video about economics",
      summary: null,
    },
  ],
};

const layer = (seed: Testing.Seed = {}) =>
  DigestToolkit.layer.pipe(Layer.provideMerge(Testing.layer(seed)));

/** Calls the tool the way the MCP server does and returns its final result. */
const getLatestDigest = Effect.gen(function* () {
  const toolkit = yield* DigestToolkit.toolkit;
  const results = yield* toolkit.handle("get_latest_digest", {});
  return yield* Stream.runLast(results).pipe(Effect.map(Option.getOrThrow));
});

describe("get_latest_digest", () => {
  it.effect("returns the latest digest, encoded for the model", () =>
    Effect.gen(function* () {
      const result = yield* getLatestDigest;
      assert.isFalse(result.isFailure);
      assert.deepStrictEqual(result.encodedResult, {
        digest: {
          periodStart: "2026-01-01T00:00:00.000Z",
          periodEnd: "2026-01-08T00:00:00.000Z",
          generatedAt: "2026-01-08T00:00:00.000Z",
          totals: { saved: 3, seen: 2, done: 1, archived: 0 },
          topTags: [{ name: "economics", count: 2 }],
          topTypes: [{ type: "video", count: 1 }],
          highlights: [
            {
              linkId: "link-1",
              url: "https://example.com/videos/economics",
              title: "A video about economics",
              summary: null,
            },
          ],
        },
      });
    }).pipe(Effect.provide(layer({ digest }))),
  );

  it.effect("returns null before the first digest is built", () =>
    Effect.gen(function* () {
      const result = yield* getLatestDigest;
      assert.isFalse(result.isFailure);
      assert.deepStrictEqual(result.encodedResult, { digest: null });
    }).pipe(Effect.provide(layer())),
  );
});
