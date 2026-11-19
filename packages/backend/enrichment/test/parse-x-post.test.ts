import { describe, expect, it } from "@effect/vitest";
import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as ParseXPost from "../src/parse-x-post.ts";
import * as X from "./x-post-fixtures.ts";

const post = (body: string): Link.Post => {
  const parsed = Option.getOrThrow(ParseXPost.parseSyndication(body));
  if (parsed._tag !== "Post") throw new Error("expected a post");
  return parsed.post;
};

const shown = (p: Link.QuotedPost) =>
  p.entities.map((entity) => [entity.kind, p.text.slice(entity.start, entity.end), entity.url]);

describe("parseSyndication", () => {
  it("reads the author, the time and the counts", () => {
    const p = post(X.textPost);
    expect(p).toMatchObject({
      state: "available",
      id: X.postId,
      url: `https://x.com/${X.handle}/status/${X.postId}`,
      author: {
        name: "Example Writer",
        handle: X.handle,
        avatarUrl: "https://pbs.twimg.com/profile_images/1000000000000000001/synthetic_normal.jpg",
        verified: true,
      },
      media: [],
      quoted: null,
      replyTo: null,
      counts: { likes: 1234, replies: 56 },
      long: false,
    });
    expect(DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(p.createdAt)))).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(Option.getOrThrow(ParseXPost.parseSyndication(X.textPost))).toMatchObject({
      language: Option.some("en"),
    });
  });

  it("unescapes the text, shows links in their display form and keeps every entity in place", () => {
    const p = post(X.textPost);
    expect(p.text).toBe(
      "An example post 🙂 about parsers & tools, see example.com/parsers by @example_reader #parsing $EXMPL",
    );
    // The offsets are UTF-16, after an emoji (two units) and an unescaped `&amp;`.
    expect(shown(p)).toEqual([
      ["link", "example.com/parsers", "https://example.com/parsers?from=post"],
      ["mention", "@example_reader", "https://x.com/example_reader"],
      ["hashtag", "#parsing", "https://x.com/hashtag/parsing"],
      ["cashtag", "$EXMPL", "https://x.com/search?q=%24EXMPL"],
    ]);
  });

  it("reads photos with their sizes and drops the media link from the text", () => {
    const p = post(X.photoPost(4));
    expect(p.text).toBe("Example photos, in a row");
    expect(p.media).toHaveLength(4);
    expect(p.media[0]).toEqual({
      kind: "photo",
      url: "https://pbs.twimg.com/media/Synthetic1.jpg",
      width: 1200,
      height: 800,
    });
  });

  it("reads a video as its poster and an mp4 a browser plays at once", () => {
    expect(post(X.videoPost).media).toEqual([
      {
        kind: "video",
        posterUrl:
          "https://pbs.twimg.com/ext_tw_video_thumb/1700000000000000002/pu/img/synthetic.jpg",
        videoUrl:
          "https://video.twimg.com/ext_tw_video/1700000000000000002/pu/vid/1280x720/c.mp4?tag=12",
        width: 1920,
        height: 1080,
        durationMs: 42_000,
      },
    ]);
  });

  it("reads a reply and the post it quotes, one level deep", () => {
    const p = post(X.quotePost);
    expect(p.text).toBe("I agree with this example.");
    expect(p.entities).toEqual([]);
    expect(p.replyTo).toBe("example_reader");
    expect(p.quoted).toMatchObject({
      id: "1700000000000000004",
      url: "https://x.com/example_quoted/status/1700000000000000004",
      author: { name: "Example Quoted", handle: "example_quoted", verified: false },
      text: "The quoted example, in one line",
      counts: { likes: 7, replies: null },
    });
    expect(p.quoted).not.toHaveProperty("quoted");
  });

  it("marks a long post", () => {
    expect(post(X.longPost).long).toBe(true);
  });

  it("knows a deleted post from its tombstone", () => {
    expect(ParseXPost.parseSyndication(X.tombstone)).toEqual(Option.some({ _tag: "Gone" }));
  });

  it.each([
    ["an HTML error page", X.notFoundPage],
    ["an empty object", "{}"],
    ["a post without an author", JSON.stringify({ id_str: "1", text: "An example" })],
    ["nothing", ""],
  ])("has no answer for %s", (_, body) => {
    expect(ParseXPost.parseSyndication(body)).toEqual(Option.none());
  });

  it("keeps a post whose optional fields are null or of a new kind", () => {
    const raw = JSON.parse(X.photoPost(1)) as Record<string, unknown>;
    const p = post(
      JSON.stringify({
        ...raw,
        lang: "qme",
        created_at: null,
        favorite_count: null,
        conversation_count: null,
        mediaDetails: [{ type: "hologram", media_url_https: "https://pbs.twimg.com/media/S.jpg" }],
        a_new_field: { anything: true },
      }),
    );
    expect(p).toMatchObject({ createdAt: null, counts: null, media: [] });
  });
});

describe("parseOembed", () => {
  const target = { handle: X.handle, id: X.postId };

  it("reads the author and the text with its entities, without the media link", () => {
    const p = Option.getOrThrow(ParseXPost.parseOembed(X.oembed, target));
    expect(p).toMatchObject({
      state: "available",
      url: `https://x.com/${X.handle}/status/${X.postId}`,
      author: { name: "Example Writer", handle: X.handle, avatarUrl: null, verified: false },
      media: [],
      quoted: null,
      counts: null,
    });
    expect(p.text).toBe(
      "An example post about parsers & tools\nsee example.com/parsers by @example_reader #parsing",
    );
    expect(shown(p)).toEqual([
      ["link", "example.com/parsers", "https://t.co/synthetic1"],
      ["mention", "@example_reader", "https://x.com/example_reader"],
      ["hashtag", "#parsing", "https://x.com/hashtag/parsing"],
    ]);
  });

  it("takes the time from the id", () => {
    // (1700000000000000001 >> 22) + the snowflake epoch.
    expect(ParseXPost.createdAtFromId(X.postId)).toBe("2023-09-08T04:15:59.129Z");
    expect(ParseXPost.createdAtFromId("20")).toBeNull();
  });

  it("has no answer for anything else", () => {
    expect(ParseXPost.parseOembed(X.notFoundPage, target)).toEqual(Option.none());
    expect(ParseXPost.parseOembed('{"author_name": "Example"}', target)).toEqual(Option.none());
  });
});
