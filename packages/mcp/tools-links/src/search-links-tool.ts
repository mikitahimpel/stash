import * as Search from "@stash/contracts-api/search";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import type * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import * as LinkText from "./link-text.ts";

/** How many hits the tool returns when the model does not ask for a number. */
export const defaultLimit = 10;

export const tool = Tool.make("search_links", {
  description:
    "Search saved links by meaning and keywords. Use it to find a link the user half remembers.",
  parameters: Schema.Struct({
    query: Search.SearchQuery.fields.q.annotate({
      description: "What to look for, in any language",
    }),
    mode: Schema.optionalKey(
      Search.SearchMode.annotate({
        description: "hybrid (default) combines semantic and keyword; keyword matches exact words",
      }),
    ),
    type: Schema.optionalKey(Link.LinkType),
    status: Schema.optionalKey(Link.LinkStatus),
    tag: Schema.optionalKey(Tag.TagName),
    limit: Schema.optionalKey(
      Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
        description: `Most hits to return (default ${defaultLimit})`,
      }),
    ),
  }),
  success: Search.SearchResults,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.OpenWorld, false);

export const handle =
  (api: ApiClient.StashApiClient["Service"]) =>
  ({ query: q, limit = defaultLimit, ...filters }: typeof tool.parametersSchema.Type) =>
    api.search.search({ query: { q, ...filters } }).pipe(
      Effect.map(({ hits }) => ({ hits: hits.slice(0, limit) })),
      Effect.orDie,
    );

export const text = ({ hits }: typeof Search.SearchResults.Encoded) =>
  LinkText.list(
    `${hits.length} matching link${hits.length === 1 ? "" : "s"}, best first:`,
    hits.map((hit) => hit.link),
    "No saved links match.",
  );
