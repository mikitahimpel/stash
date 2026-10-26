import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiTest from "effect/http-api/HttpApiTest";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as DevicesHandlers from "../src/devices-handlers.ts";
import * as TabsHandlers from "../src/tabs-handlers.ts";
import * as TabsTestLayer from "./tabs-test-layer.ts";

// End to end through the contracts `StashApi`: request encoding, routing and the `tabs` and
// `devices` handlers, on an in-memory D1, queue and KV. `Authorization` is stubbed: a bearer token
// names a synthetic device, and anything else is `Unauthorized`.

const tokens: Record<string, Security.Principal> = {
  "token-zen-a": TabsTestLayer.asDevice(TabsTestLayer.zenA),
  "token-zen-b": TabsTestLayer.asDevice(TabsTestLayer.zenB),
};

const unauthorized = new Errors.Unauthorized({ message: "Invalid token" });

const layerAuthorizationStub = Layer.succeed(Security.Authorization)({
  bearer: (handler, { credential }) => {
    const principal = tokens[Redacted.value(credential)];
    return principal === undefined
      ? Effect.fail(unauthorized)
      : Effect.provideService(handler, Security.CurrentPrincipal, principal);
  },
  session: () => Effect.fail(unauthorized),
});

const server = Layer.mergeAll(TabsHandlers.layer, DevicesHandlers.layer).pipe(
  Layer.provideMerge(layerAuthorizationStub),
  Layer.provideMerge(TabsTestLayer.layer),
  Layer.merge(HttpServer.layerServices),
);

/** A client that sends `token` as its bearer token, or no credential at all. */
const clientAs = (token?: string) =>
  HttpApiTest.groups(Api.StashApi, ["tabs", "devices"]).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
        next(token === undefined ? request : HttpClientRequest.bearerToken(request, token)),
      ),
    ),
  );

const url = (value: string) => Link.Url.make(value);
const takenAt = DateTime.makeUnsafe("2026-02-01T10:00:00.000Z");
const tab = (value: string) => ({
  url: url(value),
  title: null,
  openedAt: null,
  lastSeenAt: takenAt,
});

describe("tabs and devices handlers", () => {
  it.effect("reports a snapshot and lists it grouped by device", () =>
    Effect.gen(function* () {
      const { tabs } = yield* clientAs("token-zen-a");
      yield* tabs.report({
        params: { id: TabsTestLayer.zenA },
        payload: { takenAt, tabs: [tab("https://example.com/a")] },
      });
      const { devices } = yield* tabs.list();
      expect(
        devices.map((entry) => [entry.device.id, entry.snapshot?.tabs.length ?? null]),
      ).toEqual([
        [TabsTestLayer.zenA, 1],
        [TabsTestLayer.zenB, null],
        [TabsTestLayer.macAgent, null],
        [TabsTestLayer.iphone, null],
      ]);
    }).pipe(Effect.provide(server)),
  );

  it.effect("answers 403 when a device writes another device's tabs or reads its commands", () =>
    Effect.gen(function* () {
      const asA = yield* clientAs("token-zen-a");
      const asB = yield* clientAs("token-zen-b");

      const report = yield* asB.tabs
        .report({ params: { id: TabsTestLayer.zenA }, payload: { takenAt, tabs: [] } })
        .pipe(Effect.flip);
      expect(report).toBeInstanceOf(Errors.Forbidden);

      const command = yield* asA.devices.sendCommand({
        params: { id: TabsTestLayer.zenA },
        payload: { kind: "close-tab", url: url("https://example.com/a") },
      });
      const list = yield* asB.devices
        .listCommands({ params: { id: TabsTestLayer.zenA }, query: {} })
        .pipe(Effect.flip);
      expect(list).toBeInstanceOf(Errors.Forbidden);
      const ack = yield* asB.devices
        .ackCommand({ params: { id: command.id }, payload: { status: "done" } })
        .pipe(Effect.flip);
      expect(ack).toBeInstanceOf(Errors.Forbidden);
    }).pipe(Effect.provide(server)),
  );

  it.effect("answers 401 without a valid credential", () =>
    Effect.gen(function* () {
      for (const token of [undefined, "token-unknown"]) {
        const { tabs, devices } = yield* clientAs(token);
        expect(
          yield* tabs
            .report({ params: { id: TabsTestLayer.zenA }, payload: { takenAt, tabs: [] } })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Errors.Unauthorized);
        expect(yield* tabs.list().pipe(Effect.flip)).toBeInstanceOf(Errors.Unauthorized);
        expect(
          yield* devices
            .listCommands({ params: { id: TabsTestLayer.zenA }, query: {} })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Errors.Unauthorized);
      }
    }).pipe(Effect.provide(server)),
  );

  it.effect("runs a command from pending to done over HTTP", () =>
    Effect.gen(function* () {
      const { devices } = yield* clientAs("token-zen-a");
      const command = yield* devices.sendCommand({
        params: { id: TabsTestLayer.zenA },
        payload: { kind: "close-tab", url: url("https://example.com/a") },
      });
      expect(command.status).toBe("pending");
      const pending = { params: { id: TabsTestLayer.zenA }, query: { status: "pending" } } as const;
      expect(yield* devices.listCommands(pending)).toEqual([command]);

      const done = yield* devices.ackCommand({
        params: { id: command.id },
        payload: { status: "done" },
      });
      expect(done.status).toBe("done");
      expect(yield* devices.listCommands(pending)).toEqual([]);

      const again = yield* devices
        .ackCommand({ params: { id: command.id }, payload: { status: "done" } })
        .pipe(Effect.flip);
      expect(again).toBeInstanceOf(Errors.Conflict);
    }).pipe(Effect.provide(server)),
  );

  it.effect("registers and lists devices", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-03-01T00:00:00.000Z"));
      const { devices } = yield* clientAs("token-zen-a");
      const registered = yield* devices.register({
        payload: { name: "Synthetic iPad", kind: "ios" },
      });
      expect(registered).toMatchObject({ name: "Synthetic iPad", kind: "ios" });
      const listed = yield* devices.list();
      expect(listed.map((device) => device.id)).toEqual([
        TabsTestLayer.zenA,
        TabsTestLayer.zenB,
        TabsTestLayer.macAgent,
        TabsTestLayer.iphone,
        registered.id,
      ]);
    }).pipe(Effect.provide(server)),
  );

  it.effect("archives a tab: saves the link and queues close-tab for its device", () =>
    Effect.gen(function* () {
      const { tabs } = yield* clientAs("token-zen-a");
      const archived = yield* tabs.archive({
        payload: {
          deviceId: TabsTestLayer.zenB,
          url: url("https://www.example.com/read-later?utm_source=x"),
          title: "Read later",
        },
      });
      expect(archived.link).toMatchObject({
        canonicalUrl: "https://example.com/read-later",
        title: "Read later",
        sourceDeviceId: TabsTestLayer.zenA,
      });
      expect(archived.command).toMatchObject({
        deviceId: TabsTestLayer.zenB,
        status: "pending",
        payload: { kind: "close-tab", url: "https://www.example.com/read-later?utm_source=x" },
      });
      const queued = yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain);
      expect(queued).toEqual([{ linkId: archived.link.id }]);

      const asB = yield* clientAs("token-zen-b");
      expect(
        yield* asB.devices.listCommands({
          params: { id: TabsTestLayer.zenB },
          query: { status: "pending" },
        }),
      ).toEqual([archived.command]);

      const unknown = yield* tabs
        .archive({
          payload: {
            deviceId: Device.DeviceId.make("device-unknown"),
            url: url("https://example.com/x"),
          },
        })
        .pipe(Effect.flip);
      expect(unknown).toBeInstanceOf(Errors.NotFound);
    }).pipe(Effect.provide(server)),
  );
});
