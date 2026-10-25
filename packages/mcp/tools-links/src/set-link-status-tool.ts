import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import type * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";

export const tool = Tool.make("set_link_status", {
  description: "Mark a saved link as new, seen, done or archived.",
  parameters: Schema.Struct({
    id: Link.LinkId.annotate({ description: "Link id from search_links or list_links" }),
    status: Link.LinkStatus,
  }),
  success: Link.Link,
  failure: Errors.NotFound,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const handle =
  (api: ApiClient.StashApiClient["Service"]) =>
  ({ id, status }: typeof tool.parametersSchema.Type) =>
    api.links
      .update({ params: { id }, payload: { status } })
      .pipe(
        Effect.catch((error) =>
          Schema.is(Errors.NotFound)(error) ? Effect.fail(error) : Effect.die(error),
        ),
      );

export const text = (link: typeof Link.Link.Encoded) =>
  `${link.title ?? link.url} (${link.id}) is now ${link.status}.`;
