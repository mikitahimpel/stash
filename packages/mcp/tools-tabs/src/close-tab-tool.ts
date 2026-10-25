import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";

export const tool = Tool.make("close_tab_on_device", {
  description:
    "Close every tab with this URL on a device, without saving it. Use archive_tab to keep it. " +
    "The device closes the tab the next time it checks for commands.",
  parameters: Schema.Struct({
    deviceId: Device.DeviceId.annotate({ description: "The device the tab is open on." }),
    url: Link.Url.annotate({ description: "The tab's URL, as listed by list_open_tabs." }),
  }),
  success: Command.Command,
  failure: Errors.NotFound,
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

// Only the declared failures reach the model. A bad token or a broken api is a bug, not a tool result.
const defects = { HttpClientError: Effect.die, SchemaError: Effect.die, Unauthorized: Effect.die };

export const handler = Effect.gen(function* () {
  const client = yield* ApiClient.StashApiClient;
  return Effect.fn("close_tab_on_device")(function* (params: Tool.Parameters<typeof tool>) {
    return yield* client.devices
      .sendCommand({
        params: { id: params.deviceId },
        payload: { kind: "close-tab", url: params.url },
      })
      .pipe(Effect.catchTags(defects));
  });
});
