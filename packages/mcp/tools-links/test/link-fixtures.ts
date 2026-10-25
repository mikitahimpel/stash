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

export const seed: Testing.Seed = { links: [video, article, bare] };
