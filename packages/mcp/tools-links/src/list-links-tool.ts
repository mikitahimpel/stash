import * as Links from "@stash/contracts-api/links";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import type * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import * as LinkText from "./link-text.ts";

export const tool = Tool.make("list_links", {
  description:
    "List saved links, newest first: all recent ones, or only those not yet seen. Filter by tag, type or status.",
  parameters: Schema.Struct({
    view: Schema.optionalKey(
      Schema.Literals(["recent", "unseen"]).annotate({
        description: "recent (default): every link; unseen: links still in status new",
      }),
    ),
    tag: Schema.optionalKey(Tag.TagName),
    type: Schema.optionalKey(Link.LinkType),
    status: Schema.optionalKey(Link.LinkStatus),
    limit: Schema.optionalKey(Links.PageSize.annotate({ description: "Page size (default 20)" })),
    cursor: Schema.optionalKey(
      Schema.String.pipe(Schema.check(Schema.isNonEmpty())).annotate({
        description: "nextCursor of the previous page",
      }),
    ),
  }),
  success: Links.LinksPage,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.OpenWorld, false);

export const handle =
  (api: ApiClient.StashApiClient["Service"]) =>
  ({ view, ...filters }: typeof tool.parametersSchema.Type) =>
    api.links
      .list({
        query: { ...filters, ...(view === "unseen" ? { seen: false } : {}), sort: "recent" },
      })
      .pipe(Effect.orDie);

export const text = ({ items, nextCursor }: typeof Links.LinksPage.Encoded) => {
  const page = LinkText.list(
    `${items.length} link${items.length === 1 ? "" : "s"}, newest first:`,
    items,
    "No saved links match.",
  );
  return nextCursor === null
    ? page
    : `${page}\nMore links: call again with cursor "${nextCursor}".`;
};
