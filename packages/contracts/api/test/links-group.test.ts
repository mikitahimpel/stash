import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Link from "@stash/contracts-domain/link";
import * as LinksGroup from "../src/links-group.ts";

const link = {
  id: "link-1",
  url: "https://example.com/articles/one",
  canonicalUrl: "https://example.com/articles/one",
  title: "An invented article",
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  imageUrl: null,
  author: null,
  enrichedAt: null,
};

describe("SavedLink", () => {
  it.effect("round-trips a link with whether the save created it", () =>
    Effect.gen(function* () {
      for (const created of [true, false]) {
        const decoded = yield* Schema.decodeUnknownEffect(LinksGroup.SavedLink)({
          ...link,
          created,
        });
        expect(decoded.created).toBe(created);
        expect(yield* Schema.encodeEffect(LinksGroup.SavedLink)(decoded)).toEqual({
          ...link,
          created,
        });
      }
    }),
  );

  it("requires `created`", () => {
    expect(Schema.is(LinksGroup.SavedLink)(Schema.decodeUnknownSync(Link.Link)(link))).toBe(false);
  });

  it.effect("still decodes as a plain Link for clients that ignore `created`", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)({ ...link, created: true });
      expect(decoded.id).toBe("link-1");
    }),
  );
});

describe("ListLinksQuery", () => {
  it("takes a `url` to look a link up by, and only an http(s) one", () => {
    const decode = Schema.decodeUnknownOption(LinksGroup.ListLinksQuery);
    expect(decode({ url: "https://example.com/articles/one?utm_source=x" })._tag).toBe("Some");
    expect(decode({})._tag).toBe("Some");
    expect(decode({ url: "about:blank" })._tag).toBe("None");
  });

  it("takes `updatedSince` as a moment and `ids` as one comma-separated parameter", () => {
    const decode = Schema.decodeUnknownOption(LinksGroup.ListLinksQuery);
    const query = Schema.decodeUnknownSync(LinksGroup.ListLinksQuery)({
      updatedSince: "2026-01-02T03:04:05.000Z",
      ids: "link-1,link-2",
    });
    expect(query.ids).toEqual(["link-1", "link-2"]);
    expect(Schema.encodeSync(LinksGroup.ListLinksQuery)(query)).toEqual({
      updatedSince: "2026-01-02T03:04:05.000Z",
      ids: "link-1,link-2",
    });
    expect(decode({ updatedSince: "yesterday" })._tag).toBe("None");
    expect(decode({ ids: "" })._tag).toBe("None");
    expect(decode({ ids: "link-1,,link-2" })._tag).toBe("None");
    const tooMany = Array.from({ length: LinksGroup.maxPageSize + 1 }, (_, i) => `link-${i}`);
    expect(decode({ ids: tooMany.join(",") })._tag).toBe("None");
  });
});
