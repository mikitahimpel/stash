import * as Link from "@stash/contracts-domain/link";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import * as PostDisplay from "../src/post-display.ts";
import * as Fixtures from "./fixtures.ts";

const decode = (wire: unknown) => Schema.decodeUnknownSync(Link.Link)(wire);
const postOf = (overrides: Record<string, unknown> = {}) => {
  const post = PostDisplay.available(decode(Fixtures.postLink("p", overrides)));
  if (post === undefined) throw new Error("expected a post");
  return post;
};

describe("PostDisplay", () => {
  it("tells a read post, an unavailable one and any other link apart", () => {
    const gone = decode(
      Fixtures.link("g", {
        post: { state: "unavailable", id: "1", url: "https://x.com/a/status/1" },
      }),
    );
    expect(PostDisplay.available(gone)).toBeUndefined();
    expect(PostDisplay.isUnavailable(gone)).toBe(true);
    const plain = decode(Fixtures.link("a"));
    expect(PostDisplay.available(plain)).toBeUndefined();
    expect(PostDisplay.isUnavailable(plain)).toBe(false);
  });

  it("asks X's image host for the size it shows, and leaves other hosts alone", () => {
    const post = postOf({ media: [Fixtures.photo(1), Fixtures.video] });
    expect(PostDisplay.avatar(post.author)).toBe(
      "https://pbs.twimg.com/profile_images/1000000000000000001/synthetic_normal.jpg",
    );
    expect(PostDisplay.avatar(post.author, "large")).toBe(
      "https://pbs.twimg.com/profile_images/1000000000000000001/synthetic_200x200.jpg",
    );
    expect(PostDisplay.media(post)).toEqual([
      {
        kind: "photo",
        url: "https://pbs.twimg.com/media/Synthetic1.jpg?name=medium",
        fullUrl: "https://pbs.twimg.com/media/Synthetic1.jpg?name=large",
        width: 1200,
        height: 800,
      },
      Fixtures.video,
    ]);

    const elsewhere = postOf({
      author: { ...Fixtures.post().author, avatarUrl: "https://example.com/previews/avatar.svg" },
      media: [{ ...Fixtures.photo(1), url: "https://example.com/previews/photo.svg" }],
    });
    expect(PostDisplay.avatar(elsewhere.author, "large")).toBe(
      "https://example.com/previews/avatar.svg",
    );
    expect(PostDisplay.media(elsewhere)[0]).toMatchObject({
      url: "https://example.com/previews/photo.svg",
      fullUrl: "https://example.com/previews/photo.svg",
    });
  });

  it("puts a post's words on one run for a row, and names the media of a post without words", () => {
    expect(PostDisplay.rowText(postOf())).toBe(
      "An example post about tiny parsers, see example.com/parsers by @example_reader #parsing",
    );
    expect(
      PostDisplay.rowText(postOf({ text: "", entities: [], media: [Fixtures.photo(1)] })),
    ).toBe("Photo");
    expect(
      PostDisplay.rowText(
        postOf({ text: "", entities: [], media: [Fixtures.photo(1), Fixtures.photo(2)] }),
      ),
    ).toBe("2 photos");
    expect(PostDisplay.rowText(postOf({ text: " ", entities: [], media: [Fixtures.video] }))).toBe(
      "Video",
    );
  });

  it("writes the counts short, and only the ones the source gave", () => {
    expect(PostDisplay.counts(postOf())).toEqual(["56 replies", "1.2K likes"]);
    expect(PostDisplay.counts(postOf({ counts: { likes: 1, replies: null } }))).toEqual(["1 like"]);
    expect(PostDisplay.counts(postOf({ counts: null }))).toEqual([]);
  });
});
