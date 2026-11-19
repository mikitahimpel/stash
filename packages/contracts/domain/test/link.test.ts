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
  imageUrl: null,
  author: null,
  enrichedAt: null,
};

const quoted = {
  id: "1700000000000000004",
  url: "https://x.com/example_quoted/status/1700000000000000004",
  author: { name: "Example Quoted", handle: "example_quoted", avatarUrl: null, verified: false },
  text: "The quoted example",
  entities: [],
  createdAt: null,
  media: [],
  replyTo: null,
  counts: null,
  long: false,
};

const post = {
  state: "available",
  id: "1700000000000000001",
  url: "https://x.com/example_writer/status/1700000000000000001",
  author: {
    name: "Example Writer",
    handle: "example_writer",
    avatarUrl: "https://pbs.twimg.com/profile_images/1/synthetic_normal.jpg",
    verified: true,
  },
  text: "An example post, see example.com/a #parsing",
  entities: [
    { kind: "link", start: 21, end: 34, url: "https://example.com/a" },
    { kind: "hashtag", start: 35, end: 43, url: "https://x.com/hashtag/parsing" },
  ],
  createdAt: "2026-01-02T03:04:05.000Z",
  media: [
    { kind: "photo", url: "https://pbs.twimg.com/media/Synthetic1.jpg", width: 1200, height: 800 },
    {
      kind: "video",
      posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/synthetic.jpg",
      videoUrl: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/synthetic.mp4",
      width: 1280,
      height: 720,
      durationMs: 42000,
    },
  ],
  replyTo: "example_reader",
  counts: { likes: 12, replies: null },
  long: false,
  quoted,
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

  it.effect("carries a preview image URL", () =>
    Effect.gen(function* () {
      const imageUrl = "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg";
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)({ ...link, imageUrl });
      expect(decoded.imageUrl).toBe(imageUrl);
      expect((yield* Schema.encodeEffect(Link.Link)(decoded)).imageUrl).toBe(imageUrl);
    }),
  );

  it.effect("round-trips a post on X, with its media and the post it quotes", () =>
    Effect.gen(function* () {
      const withPost = { ...link, post };
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)(withPost);
      expect(decoded.post?.state).toBe("available");
      expect(yield* Schema.encodeEffect(Link.Link)(decoded)).toEqual(withPost);
    }),
  );

  it.effect("round-trips an unavailable post, and a link with no post has no key", () =>
    Effect.gen(function* () {
      const unavailable = { state: "unavailable", id: post.id, url: post.url };
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)({ ...link, post: unavailable });
      expect((yield* Schema.encodeEffect(Link.Link)(decoded)).post).toEqual(unavailable);
      const plain = yield* Schema.decodeUnknownEffect(Link.Link)(link);
      expect(plain).not.toHaveProperty("post");
    }),
  );

  it.each([
    ["an unknown state", { state: "hidden" }],
    ["a handle with an @", { author: { ...post.author, handle: "@example_writer" } }],
    [
      "media that is not http(s)",
      { media: [{ ...post.media[0], url: "data:image/png;base64,AA" }] },
    ],
    ["an entity without a URL", { entities: [{ kind: "link", start: 0, end: 2 }] }],
    [
      "a quote that quotes",
      { quoted: { ...post.quoted, quoted: null, state: "available" }, id: 7 },
    ],
    ["a null post", null],
  ])("rejects a post with %s", (_, patch) => {
    expect(() =>
      Schema.decodeUnknownSync(Link.Link)({
        ...link,
        post: patch === null ? null : { ...post, ...patch },
      }),
    ).toThrow();
  });

  it.effect("accepts nulls for fields enrichment fills later", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(Link.Link)({
        ...link,
        canonicalUrl: null,
        title: null,
        type: null,
        summary: null,
        language: null,
        imageUrl: null,
        author: null,
        sourceDeviceId: null,
        tags: [],
      });
      expect(decoded.type).toBeNull();
    }),
  );

  it.each([
    ["an invalid url", { url: "not a url" }],
    ["an image that is not http(s)", { imageUrl: "data:image/png;base64,AAAA" }],
    ["a missing image field", { imageUrl: undefined }],
    ["an empty author", { author: "" }],
    ["a missing author field", { author: undefined }],
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
      { url: "https://example.com/video", deviceId: "device-1" },
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
