import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Digest from "../src/digest.ts";

const digest = {
  periodStart: "2026-01-05T00:00:00.000Z",
  periodEnd: "2026-01-12T00:00:00.000Z",
  generatedAt: "2026-01-12T06:00:00.000Z",
  totals: { saved: 12, seen: 5, done: 3, archived: 4 },
  topTags: [{ name: "economics", count: 4 }],
  topTypes: [{ type: "article", count: 7 }],
  highlights: [
    {
      linkId: "link-1",
      url: "https://example.com/talk",
      title: "An invented talk",
      summary: null,
    },
  ],
};

describe("Digest", () => {
  it("round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Digest.Digest)(digest);
    expect(Schema.encodeSync(Digest.Digest)(decoded)).toEqual(digest);
  });

  it("accepts an empty week", () => {
    const empty = {
      ...digest,
      totals: { saved: 0, seen: 0, done: 0, archived: 0 },
      topTags: [],
      topTypes: [],
      highlights: [],
    };
    expect(
      Schema.encodeSync(Digest.Digest)(Schema.decodeUnknownSync(Digest.Digest)(empty)),
    ).toEqual(empty);
  });

  it.each([
    ["a negative total", { totals: { ...digest.totals, saved: -1 } }],
    ["a missing total", { totals: { saved: 1, seen: 0, done: 0 } }],
    ["a highlight with a bad url", { highlights: [{ ...digest.highlights[0], url: "x" }] }],
    ["an unknown type", { topTypes: [{ type: "podcast", count: 1 }] }],
    ["a bad period", { periodStart: "last monday" }],
  ])("rejects %s", (_, patch) => {
    expect(() => Schema.decodeUnknownSync(Digest.Digest)({ ...digest, ...patch })).toThrow();
  });
});
