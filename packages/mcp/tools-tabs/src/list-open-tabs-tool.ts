import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as ApiClient from "@stash/mcp-platform/api-client";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";

const OpenTab = Schema.Struct({
  url: Link.Url,
  title: Schema.NullOr(Schema.String),
  openedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});

const DeviceTabs = Schema.Struct({
  deviceId: Device.DeviceId,
  name: Schema.String,
  kind: Device.DeviceKind,
  reportedAt: Schema.NullOr(Schema.DateTimeUtcFromString).annotate({
    description: "When the device last reported its tabs, or null if it never did.",
  }),
  tabs: Schema.Array(OpenTab),
});

export const tool = Tool.make("list_open_tabs", {
  description: "List the tabs open on each device, as each device last reported them.",
  parameters: Schema.Struct({
    deviceId: Schema.optionalKey(
      Device.DeviceId.annotate({ description: "Only list this device's tabs." }),
    ),
  }),
  success: Schema.Struct({ devices: Schema.Array(DeviceTabs) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const handler = Effect.gen(function* () {
  const client = yield* ApiClient.StashApiClient;
  return Effect.fn("list_open_tabs")(function* (params: Tool.Parameters<typeof tool>) {
    const all = yield* client.tabs.list().pipe(Effect.orDie);
    return {
      devices: all.devices
        .filter(({ device }) => params.deviceId === undefined || device.id === params.deviceId)
        .map(({ device, snapshot }) => ({
          deviceId: device.id,
          name: device.name,
          kind: device.kind,
          reportedAt: snapshot?.takenAt ?? null,
          tabs: (snapshot?.tabs ?? []).map((tab) => ({
            url: tab.url,
            title: tab.title,
            openedAt: tab.openedAt,
          })),
        })),
    };
  });
});
