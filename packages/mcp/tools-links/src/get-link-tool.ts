import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import type * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import * as LinkText from "./link-text.ts";

export const tool = Tool.make("get_link", {
  description: "Get one saved link by id, with its summary, tags and status.",
  parameters: Schema.Struct({
    id: Link.LinkId.annotate({ description: "Link id from search_links or list_links" }),
  }),
  success: Link.Link,
  failure: Errors.NotFound,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.OpenWorld, false);

export const handle =
  (api: ApiClient.StashApiClient["Service"]) =>
  ({ id }: typeof tool.parametersSchema.Type) =>
    api.links
      .get({ params: { id } })
      .pipe(
        Effect.catch((error) =>
          Schema.is(Errors.NotFound)(error) ? Effect.fail(error) : Effect.die(error),
        ),
      );

export const text = LinkText.details;
