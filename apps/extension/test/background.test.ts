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
      // Tab sync runs too; only the poller's request is checked here.
      expect(requests).toContain("GET /devices/device-1/commands");
    }).pipe(Effect.scoped, Effect.provide(platform));
  });

  it.effect("runs tab sync: reports the open tabs on start", () =>
    Effect.gen(function* () {
      const reported: Array<string> = [];
      // Synthetic config, tabs and API.
      const platform = Testing.make({
        tabs: [Testing.tab({ id: 1, url: "https://example.com/a" })],
        config: { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token" },
        handler: (request) =>
          Effect.sync(() => {
            const path = new URL(request.url).pathname;
            if (path === "/auth/me") return Response.json({ kind: "device", deviceId: "device-1" });
            if (request.method === "PUT") reported.push(`${request.method} ${path}`);
            return request.method === "PUT"
              ? new Response(null, { status: 204 })
              : Response.json([]);
          }),
      });
      const fiber = yield* Effect.forkChild(Background.main(platform));
      yield* Effect.repeat(Effect.yieldNow, { times: 50 });
      expect(reported).toEqual(["PUT /devices/device-1/tabs"]);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
