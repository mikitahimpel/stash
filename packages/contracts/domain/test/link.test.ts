import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import * as Link from "../src/link.ts";

const link = {
  id: "link-1",
  url: "https://example.com/articles/economics?ref=feed",
  canonicalUrl: "https://example.com/articles/economics",
  title: "An invented article",
  status: "new",
  type: "article",
  summary: "A synthetic summary.",
  language: "en",
  tags: ["economics", "video essays"],
  sourceDeviceId: "device-1",
  createdAt: "2026-01-02T03:04:05.000Z",
  enrichedAt: null,
};

describe("Url", () => {
  it("accepts absolute http(s) URLs", () => {
    const decode = Schema.decodeUnknownSync(Link.Url);
    expect(decode("https://example.com")).toBe("https://example.com");
    expect(decode("http://example.com/a%20b?q=1#top")).toBe("http://example.com/a%20b?q=1#top");
  });

  it.each(["", "example.com", "ftp://example.com", "https://", "https://exa mple.com", 42])(
    "rejects %j",
    (input) => {
      expect(Schema.is(Link.Url)(input)).toBe(false);
    },
  );
});

describe("LinkStatus and LinkType", () => {
  it("accept the documented literals only", () => {
    for (const status of ["new", "seen", "done", "archived"]) {
      expect(Schema.is(Link.LinkStatus)(status)).toBe(true);
    }
    for (const type of ["article", "video", "tool", "repo", "other"]) {
      expect(Schema.is(Link.LinkType)(type)).toBe(true);
    }
    expect(Schema.is(Link.LinkStatus)("deleted")).toBe(false);
    expect(Schema.is(Link.LinkType)("podcast")).toBe(false);
  });
});

describe("Link", () => {
  it.effect("round-trips a valid link", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)(link);
      expect(decoded.id).toBe("link-1");
      expect(DateTime.toEpochMillis(decoded.createdAt)).toBe(Date.parse(link.createdAt));
      const encoded = yield* Schema.encodeEffect(Link.Link)(decoded);
      expect(encoded).toEqual(link);
    }),
  );

  it.effect("accepts nulls for fields enrichment fills later", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)({
        ...link,
        canonicalUrl: null,
        title: null,
        type: null,
        summary: null,
        language: null,
        sourceDeviceId: null,
        tags: [],
      });
      expect(decoded.type).toBeNull();
    }),
  );

  it.each([
    ["an invalid url", { url: "not a url" }],
    ["an unknown status", { status: "deleted" }],
    ["an empty id", { id: "" }],
    ["a bad timestamp", { createdAt: "yesterday" }],
    ["an uppercase tag", { tags: ["Economics"] }],
  ])("rejects %s", (_, patch) => {
    expect(() => Schema.decodeUnknownSync(Link.Link)({ ...link, ...patch })).toThrow();
  });

  it("rejects a missing field", () => {
    const { title: _, ...rest } = link;
    expect(() => Schema.decodeUnknownSync(Link.Link)(rest)).toThrow();
  });
});

describe("SaveLinkInput", () => {
  it("round-trips with and without optional fields", () => {
    for (const input of [
      { url: "https://example.com/video" },
      { url: "https://example.com/video", title: "A video", tags: ["talks"] },
    ]) {
      const decoded = Schema.decodeUnknownSync(Link.SaveLinkInput)(input);
      expect(Schema.encodeSync(Link.SaveLinkInput)(decoded)).toEqual(input);
    }
  });

  it("rejects a missing or invalid url", () => {
    expect(() => Schema.decodeUnknownSync(Link.SaveLinkInput)({})).toThrow();
    expect(() => Schema.decodeUnknownSync(Link.SaveLinkInput)({ url: "nope" })).toThrow();
  });

  it("rejects an empty title", () => {
    expect(() =>
      Schema.decodeUnknownSync(Link.SaveLinkInput)({ url: "https://example.com", title: "" }),
    ).toThrow();
  });
});

describe("LinkPatch", () => {
  it("accepts an empty patch and a full patch", () => {
    const full = { title: "Renamed", status: "done", type: "repo", tags: ["tools"] };
    expect(Schema.decodeUnknownSync(Link.LinkPatch)({})).toEqual({});
    expect(
      Schema.encodeSync(Link.LinkPatch)(Schema.decodeUnknownSync(Link.LinkPatch)(full)),
    ).toEqual(full);
  });

  it("rejects invalid values", () => {
    expect(() => Schema.decodeUnknownSync(Link.LinkPatch)({ status: "gone" })).toThrow();
    expect(() => Schema.decodeUnknownSync(Link.LinkPatch)({ type: "book" })).toThrow();
  });
});
