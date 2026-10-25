import * as TabsGroup from "@stash/contracts-api/tabs";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";

export const tool = Tool.make("archive_tab", {
  description:
    "Save an open tab to the stash as a link, then close it on its device. " +
    "The device closes the tab the next time it checks for commands.",
  parameters: Schema.Struct({
    deviceId: Device.DeviceId.annotate({ description: "The device the tab is open on." }),
    url: Link.Url.annotate({ description: "The tab's URL, as listed by list_open_tabs." }),
    title: Schema.optionalKey(Link.LinkTitle.annotate({ description: "The tab's title." })),
  }),
  success: TabsGroup.ArchivedTab,
  failure: Schema.Union([Errors.NotFound, Errors.RateLimited]),
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

// Only the declared failures reach the model. A bad token or a broken api is a bug, not a tool result.
const defects = { HttpClientError: Effect.die, SchemaError: Effect.die, Unauthorized: Effect.die };

export const handler = Effect.gen(function* () {
  const client = yield* ApiClient.StashApiClient;
  return Effect.fn("archive_tab")(function* (params: Tool.Parameters<typeof tool>) {
    return yield* client.tabs.archive({ payload: params }).pipe(Effect.catchTags(defects));
  });
});
