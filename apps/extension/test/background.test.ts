import { describe, expect, it } from "@effect/vitest";
import * as CommandsPoller from "@stash/ext-device-commands/commands-poller";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Background from "../entrypoints/background.ts";

describe("background", () => {
  it.effect("builds its layer on the platform services", () =>
    Effect.scoped(Effect.asVoid(Effect.provide(Effect.void, Background.layer))).pipe(
      Effect.provide(Testing.layer),
    ),
  );

  it.effect("keeps running until interrupted", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Background.main(Testing.layer));
      yield* Effect.yieldNow;
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("polls device commands on an alarm", () => {
    const requests: Array<string> = [];
    const platform = Testing.make({
      // Synthetic placeholders, not real tokens.
      config: { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token" },
      handler: (request) =>
        Effect.sync(() => {
          requests.push(`${request.method} ${new URL(request.url).pathname}`);
          return request.url.endsWith("/auth/me")
            ? Response.json({ kind: "device", deviceId: "device-1" })
            : Response.json([]);
        }),
    });
    return Effect.gen(function* () {
      yield* Layer.build(Background.layer);
      yield* Effect.repeat(Effect.yieldNow, { times: 20 });
      const alarms = yield* (yield* Alarms.Alarms).list;
      expect(alarms.map((alarm) => alarm.name)).toContain(CommandsPoller.alarmName);
      expect(requests).toEqual(["GET /auth/me", "GET /devices/device-1/commands"]);
    }).pipe(Effect.scoped, Effect.provide(platform));
  });
});
