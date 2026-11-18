import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchContent from "../src/fetch-content.ts";
import * as FetchXPost from "../src/fetch-x-post.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeHttp from "./fake-http.ts";
import * as X from "./x-post-fixtures.ts";

const target = { handle: X.handle, id: X.postId };
const url = `https://x.com/${X.handle}/status/${X.postId}`;
const syndication = FetchXPost.syndicationUrl(X.postId);
const oembed = FetchXPost.oembedUrl(target);
const json = "application/json";

const requested = FakeHttp.FakeHttp.use((http) => http.requests).pipe(
  Effect.map((requests) => requests.map((request) => request.url)),
);

describe("FetchXPost", () => {
  it("asks the public endpoints, with the token derived from the id", () => {
    // The token of the first public post, as X's own embed script computes it.
    expect(FetchXPost.syndicationToken("20")).toBe("6dq1a2xwd93");
    expect(syndication).toBe(
      `https://cdn.syndication.twimg.com/tweet-result?id=${X.postId}&token=${FetchXPost.syndicationToken(X.postId)}&lang=en`,
    );
    expect(oembed).toBe(
      `https://publish.twitter.com/oembed?url=https%3A%2F%2Ftwitter.com%2F${X.handle}%2Fstatus%2F${X.postId}&omit_script=1&dnt=true`,
    );
  });

  it.effect("reads a post from syndication alone, and never from x.com", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent(`${url}?s=20`);
      expect(content).toMatchObject({
        title: Option.some(
          "Example Writer: An example post 🙂 about parsers & tools, see example.com/parsers by @example_reader #parsing $EXMPL",
        ),
        author: Option.some(`@${X.handle}`),
        imageUrl: Option.none(),
        language: Option.some("en"),
        source: "post",
        post: { state: "available", id: X.postId },
      });
      expect(content.text).toContain(`Example Writer (@${X.handle}):`);
      expect(content.text).toContain("about parsers & tools");
      expect(yield* requested).toEqual([syndication]);
    }).pipe(
      Effect.provide(FakeHttp.layer({ [syndication]: { body: X.textPost, contentType: json } })),
    ),
  );

  it.effect("previews a post by its first photo, row-sized, or by a video's poster", () =>
    Effect.gen(function* () {
      const photos = yield* FetchXPost.fetchXPost(target);
      expect(photos.imageUrl).toEqual(
        Option.some("https://pbs.twimg.com/media/Synthetic1.jpg?name=small"),
      );
    }).pipe(
      Effect.provide(
        FakeHttp.layer({ [syndication]: { body: X.photoPost(2), contentType: json } }),
      ),
    ),
  );

  it.effect("puts the quoted post into the text search reads", () =>
    Effect.gen(function* () {
      const content = yield* FetchXPost.fetchXPost(target);
      expect(content.text).toBe(
        [
          `Example Writer (@${X.handle}):`,
          "I agree with this example.",
          "",
          "Quoted Example Quoted (@example_quoted):",
          "The quoted example, in one line",
        ].join("\n"),
      );
    }).pipe(
      Effect.provide(FakeHttp.layer({ [syndication]: { body: X.quotePost, contentType: json } })),
    ),
  );

  it.effect("falls back to oEmbed when syndication has no answer", () =>
    Effect.gen(function* () {
      const content = yield* FetchXPost.fetchXPost(target);
      expect(content).toMatchObject({
        title: Option.some("Example Writer: An example post about parsers & tools"),
        author: Option.some(`@${X.handle}`),
        source: "post",
        post: { state: "available", author: { avatarUrl: null } },
      });
      expect(yield* requested).toEqual([syndication, oembed]);
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [syndication]: { status: 404, body: X.notFoundPage },
          [oembed]: { body: X.oembed, contentType: json },
        }),
      ),
    ),
  );

  it.effect("a deleted post is unavailable, and oEmbed is not asked", () =>
    Effect.gen(function* () {
      const content = yield* FetchXPost.fetchXPost(target);
      expect(content).toMatchObject({
        title: Option.none(),
        author: Option.some(`@${X.handle}`),
        text: "",
        source: "metadata",
        post: { state: "unavailable", id: X.postId, url },
      });
      expect(yield* requested).toEqual([syndication]);
    }).pipe(
      Effect.provide(FakeHttp.layer({ [syndication]: { body: X.tombstone, contentType: json } })),
    ),
  );

  it.effect("a post neither source has is unavailable", () =>
    Effect.gen(function* () {
      const content = yield* FetchXPost.fetchXPost(target);
      expect(content.post).toEqual({ state: "unavailable", id: X.postId, url });
    }).pipe(
      Effect.provide(
        FakeHttp.layer({
          [syndication]: { status: 404, body: X.notFoundPage },
          [oembed]: { status: 404, body: X.notFoundPage },
        }),
      ),
    ),
  );

  it.effect("fails when a source fails transiently, so the link is read later", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(FetchXPost.fetchXPost(target));
      expect(error).toMatchObject({ reason: "Status", status: 503, isTransient: true });
    }).pipe(
      EnrichmentTestLayer.noDelays,
      Effect.provide(FakeHttp.layer({ [syndication]: { status: 503 } })),
    ),
  );

  it.effect("fetches nothing for a page on X that is not a post", () =>
    Effect.gen(function* () {
      const content = yield* FetchContent.fetchContent("https://x.com/example_writer");
      expect(content).toMatchObject({ title: Option.none(), text: "", source: "metadata" });
      expect(content.post).toBeUndefined();
      expect(yield* FetchContent.fetchMetadata("https://twitter.com/search?q=example")).toEqual(
        content,
      );
      expect(yield* requested).toEqual([]);
    }).pipe(Effect.provide(FakeHttp.layer({}))),
  );

  it("a post is unavailable when nothing may be fetched any more", () => {
    expect(Option.getOrThrow(FetchContent.withoutFetch(url)).post).toEqual({
      state: "unavailable",
      id: X.postId,
      url,
    });
  });
});
