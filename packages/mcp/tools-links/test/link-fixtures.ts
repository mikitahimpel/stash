import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Testing from "@stash/mcp-platform/testing";
import { Schema } from "effect";

// Synthetic links for the fake api. Invented URLs and titles only.

export const url = (value: string) => Schema.decodeUnknownSync(Link.Url)(value);

export const video = Testing.makeLink({
  id: Link.LinkId.make("seed-video"),
  url: url("https://example.com/videos/economics"),
  title: "A video about economics",
  type: "video",
  summary: "How markets set prices.",
  tags: [Tag.TagName.make("economics")],
  imageUrl: url("https://example.com/videos/economics.jpg"),
  author: "Example Channel",
  enrichedAt: Testing.now,
});

export const article = Testing.makeLink({
  id: Link.LinkId.make("seed-article"),
  url: url("https://example.com/articles/gardening"),
  title: "Gardening basics",
  type: "article",
  status: "seen",
  tags: [Tag.TagName.make("garden")],
});

export const bare = Testing.makeLink({
  id: Link.LinkId.make("seed-bare"),
  url: url("https://example.com/economics/notes"),
});

const postUrl = url("https://x.com/example_writer/status/1700000000000000001");

/** A link to a short post on X: its text is also the link's summary. */
export const post = Testing.makeLink({
  id: Link.LinkId.make("seed-post"),
  url: postUrl,
  title: "Example Writer: An example post about tiny parsers",
  type: "other",
  summary: "An example post about tiny parsers",
  author: "@example_writer",
  enrichedAt: Testing.now,
  post: {
    state: "available",
    id: "1700000000000000001",
    url: postUrl,
    author: { name: "Example Writer", handle: "example_writer", avatarUrl: null, verified: true },
    text: "An example post about tiny parsers",
    entities: [],
    createdAt: Testing.now,
    media: [
      {
        kind: "photo",
        url: url("https://pbs.twimg.com/media/Synthetic1.jpg"),
        width: 1200,
        height: 800,
      },
    ],
    replyTo: null,
    counts: { likes: 12, replies: 3 },
    long: false,
    quoted: {
      id: "1700000000000000004",
      url: url("https://x.com/example_quoted/status/1700000000000000004"),
      author: {
        name: "Example Quoted",
        handle: "example_quoted",
        avatarUrl: null,
        verified: false,
      },
      text: "The quoted example",
      entities: [],
      createdAt: null,
      media: [],
      replyTo: null,
      counts: null,
      long: false,
    },
  },
});

/** A link to a post that is gone. */
export const gonePost = Testing.makeLink({
  id: Link.LinkId.make("seed-gone-post"),
  url: url("https://x.com/example_writer/status/1700000000000000009"),
  author: "@example_writer",
  enrichedAt: Testing.now,
  post: {
    state: "unavailable",
    id: "1700000000000000009",
    url: url("https://x.com/example_writer/status/1700000000000000009"),
  },
});

export const seed: Testing.Seed = { links: [video, article, bare] };

export const postSeed: Testing.Seed = { links: [post, gonePost] };
