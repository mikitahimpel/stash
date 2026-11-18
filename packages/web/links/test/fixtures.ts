import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as UrlParams from "effect/http/UrlParams";

// Synthetic links in their wire (JSON) form.
export const link = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: `https://www.example.com/articles/${id}`,
  canonicalUrl: null,
  title: `Example article ${id}`,
  status: "new",
  type: "article",
  summary: `A summary of article ${id}.`,
  language: "en",
  tags: ["economics"],
  sourceDeviceId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  imageUrl: null,
  author: null,
  enrichedAt: "2026-01-01T00:01:00.000Z",
  ...overrides,
});

export const page = (
  links: ReadonlyArray<ReturnType<typeof link>>,
  nextCursor: string | null = null,
) => ApiTesting.json({ items: links, nextCursor });

/** The query string of a request, as a plain record. */
export const query = (request: HttpClientRequest.HttpClientRequest): Record<string, string> =>
  Object.fromEntries(
    Object.entries(UrlParams.toRecord(request.urlParams)).map(([key, value]) => [
      key,
      typeof value === "string" ? value : value[0],
    ]),
  );

/** The JSON body of a request. */
export const body = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<unknown> =>
  Effect.sync(() =>
    request.body._tag === "Uint8Array"
      ? JSON.parse(new TextDecoder().decode(request.body.body))
      : undefined,
  );

/** A synthetic post on X in its wire form: invented people, `example` words, drawn images. */
export const quotedPost = (overrides: Record<string, unknown> = {}) => ({
  id: "1700000000000000001",
  url: "https://x.com/example_writer/status/1700000000000000001",
  author: {
    name: "Example Writer",
    handle: "example_writer",
    avatarUrl: "https://pbs.twimg.com/profile_images/1000000000000000001/synthetic_normal.jpg",
    verified: true,
  },
  text: "An example post about tiny parsers,\nsee example.com/parsers by @example_reader #parsing",
  entities: [
    { kind: "link", start: 40, end: 59, url: "https://example.com/parsers?from=post" },
    { kind: "mention", start: 63, end: 78, url: "https://x.com/example_reader" },
    { kind: "hashtag", start: 79, end: 87, url: "https://x.com/hashtag/parsing" },
  ],
  createdAt: "2026-01-02T03:04:05.000Z",
  media: [],
  replyTo: null,
  counts: { likes: 1234, replies: 56 },
  long: false,
  ...overrides,
});

export const post = (overrides: Record<string, unknown> = {}) => ({
  state: "available",
  ...quotedPost(),
  quoted: null,
  ...overrides,
});

export const photo = (n: number) => ({
  kind: "photo",
  url: `https://pbs.twimg.com/media/Synthetic${n}.jpg`,
  width: 1200,
  height: 800,
});

export const video = {
  kind: "video",
  posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1700000000000000002/pu/img/synthetic.jpg",
  videoUrl: "https://video.twimg.com/ext_tw_video/1700000000000000002/pu/vid/1280x720/c.mp4?tag=12",
  width: 1920,
  height: 1080,
  durationMs: 42_000,
};

/** A link to that post, as enrichment stores it: named after it, with its words as the summary. */
export const postLink = (
  id: string,
  postOverrides: Record<string, unknown> = {},
  linkOverrides: Record<string, unknown> = {},
) => {
  const value = post(postOverrides);
  return link(id, {
    url: value.url,
    canonicalUrl: value.url,
    title: "Example Writer: An example post about tiny parsers,",
    type: "other",
    summary: value.text,
    author: "@example_writer",
    post: value,
    ...linkOverrides,
  });
};
