import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import type * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";

export const tool = Tool.make("save_link", {
  description:
    "Save a link to the stash. Tags, type and summary are added automatically in the background.",
  parameters: Schema.Struct({
    url: Link.Url.annotate({ description: "Absolute http(s) URL" }),
    title: Schema.optionalKey(Link.LinkTitle.annotate({ description: "Page title, if known" })),
    tags: Schema.optionalKey(
      Schema.Array(Tag.TagName).annotate({ description: "Lowercase tags to add right away" }),
    ),
  }),
  success: Link.Link,
  failure: Errors.RateLimited,
}).annotate(Tool.OpenWorld, false);

export const handle = (api: ApiClient.StashApiClient["Service"]) => (payload: Link.SaveLinkInput) =>
  api.links
    .save({ payload })
    .pipe(
      Effect.catch((error) =>
        Schema.is(Errors.RateLimited)(error) ? Effect.fail(error) : Effect.die(error),
      ),
    );

export const text = (link: typeof Link.Link.Encoded) =>
  `Saved ${link.url} as ${link.id}.${link.enrichedAt === null ? " Enrichment runs in the background." : ""}`;
