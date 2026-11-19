import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
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

const tokens: Record<
  string,
  { readonly principal: Security.Principal; readonly user: Security.CurrentUser["Service"] }
> = {
  "token-zen-a": { principal: TabsTestLayer.asDevice(TabsTestLayer.zenA), user: Testing.owner },
  "token-zen-b": { principal: TabsTestLayer.asDevice(TabsTestLayer.zenB), user: Testing.owner },
  "token-owner": { principal: { kind: "user" }, user: Testing.owner },
  "token-member": { principal: { kind: "user" }, user: Testing.member },
  "token-member-zen": {
    principal: TabsTestLayer.asDevice(TabsTestLayer.memberZen),
    user: Testing.member,
  },
};

const unauthorized = new Errors.Unauthorized({ message: "Invalid token" });

const layerAuthorizationStub = Layer.succeed(Security.Authorization)({
  bearer: (handler, { credential }) => {
    const known = tokens[Redacted.value(credential)];
    return known === undefined
      ? Effect.fail(unauthorized)
      : handler.pipe(
          Effect.provideService(Security.CurrentPrincipal, known.principal),
          Effect.provideService(Security.CurrentUser, known.user),
        );
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

  it.effect("reports each device's activity: token use, tabs snapshot and last save", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-03-01T00:00:00.000Z"));
      const { devices, tabs } = yield* clientAs("token-zen-a");
      const none = yield* devices.activity();
      expect(none.map((it) => [it.deviceId, it.lastSeenAt, it.lastSave])).toEqual([
        [TabsTestLayer.zenA, null, null],
        [TabsTestLayer.zenB, null, null],
        [TabsTestLayer.macAgent, null, null],
        [TabsTestLayer.iphone, null, null],
      ]);

      // A tabs snapshot from zen A, a save from zen B, a token use by the Mac.
      yield* tabs.report({
        params: { id: TabsTestLayer.zenA },
        payload: { takenAt, tabs: [tab("https://example.com/open")] },
      });
      const archived = yield* (yield* clientAs("token-zen-b")).tabs.archive({
        payload: {
          deviceId: TabsTestLayer.zenB,
          url: url("https://example.com/saved"),
          title: "A synthetic save",
        },
      });
      yield* D1Database.Database.use((db) =>
        db.run(
          D1Database.sql`INSERT INTO api_tokens (user_id, id, device_id, hash, last_used_at)
            VALUES ('owner', 'token-mac', ${TabsTestLayer.macAgent}, 'hash-mac', '2026-02-15T00:00:00.000Z')`,
        ),
      );

      const [zenA, zenB, mac, iphone] = yield* devices.activity();
      expect(zenA?.lastSeenAt).toEqual(takenAt);
      expect(zenA?.lastSave).toBeNull();
      expect(zenB?.lastSave).toEqual({
        at: DateTime.makeUnsafe("2026-03-01T00:00:00.000Z"),
        linkId: archived.link.id,
        url: "https://example.com/saved",
        title: "A synthetic save",
      });
      expect(mac?.lastSeenAt).toEqual(DateTime.makeUnsafe("2026-02-15T00:00:00.000Z"));
      expect(iphone).toEqual({ deviceId: TabsTestLayer.iphone, lastSeenAt: null, lastSave: null });
    }).pipe(Effect.provide(server)),
  );
});

// Two users (#177): the owner's devices and the member's one Zen. Whatever a user asks about a
// device, a tab or a command of the other, the answer is the one for a thing that does not exist.
describe("tabs and devices of two users", () => {
  it.effect("each user lists their own devices, tabs and activity only", () =>
    Effect.gen(function* () {
      const owner = yield* clientAs("token-owner");
      const member = yield* clientAs("token-member");
      const memberZen = yield* clientAs("token-member-zen");
      yield* memberZen.tabs.report({
        params: { id: TabsTestLayer.memberZen },
        payload: { takenAt, tabs: [tab("https://example.com/member-tab")] },
      });
      yield* (yield* clientAs("token-zen-a")).tabs.report({
        params: { id: TabsTestLayer.zenA },
        payload: { takenAt, tabs: [tab("https://example.com/owner-tab")] },
      });

      const ownerIds = [
        TabsTestLayer.zenA,
        TabsTestLayer.zenB,
        TabsTestLayer.macAgent,
        TabsTestLayer.iphone,
      ];
      expect((yield* owner.devices.list()).map((device) => device.id)).toEqual(ownerIds);
      expect((yield* owner.devices.activity()).map((entry) => entry.deviceId)).toEqual(ownerIds);
      expect((yield* member.devices.list()).map((device) => device.id)).toEqual([
        TabsTestLayer.memberZen,
      ]);
      expect((yield* member.devices.activity()).map((entry) => entry.deviceId)).toEqual([
        TabsTestLayer.memberZen,
      ]);

      const ownerTabs = JSON.stringify(yield* owner.tabs.list());
      expect(ownerTabs).toContain("owner-tab");
      expect(ownerTabs).not.toContain("member");
      const memberTabs = yield* member.tabs.list();
      expect(memberTabs.devices.map((entry) => entry.device.id)).toEqual([TabsTestLayer.memberZen]);
      expect(JSON.stringify(memberTabs)).not.toContain("owner-tab");
    }).pipe(Effect.provide(server)),
  );

  it.effect("answers 404 for another user's device, tabs and commands, and changes nothing", () =>
    Effect.gen(function* () {
      const owner = yield* clientAs("token-owner");
      const member = yield* clientAs("token-member");
      const closeTab = { kind: "close-tab", url: url("https://example.com/member-tab") } as const;
      const theirs = yield* member.devices.sendCommand({
        params: { id: TabsTestLayer.memberZen },
        payload: closeTab,
      });

      const attempts = [
        owner.devices.sendCommand({ params: { id: TabsTestLayer.memberZen }, payload: closeTab }),
        owner.devices.listCommands({ params: { id: TabsTestLayer.memberZen }, query: {} }),
        owner.devices.ackCommand({ params: { id: theirs.id }, payload: { status: "done" } }),
        owner.tabs.report({
          params: { id: TabsTestLayer.memberZen },
          payload: { takenAt, tabs: [] },
        }),
        owner.tabs.archive({
          payload: { deviceId: TabsTestLayer.memberZen, url: url("https://example.com/x") },
        }),
        // And the other way round: a member and the owner's device.
        member.devices.sendCommand({ params: { id: TabsTestLayer.zenA }, payload: closeTab }),
        member.devices.listCommands({ params: { id: TabsTestLayer.zenA }, query: {} }),
      ];
      for (const attempt of attempts) {
        expect(yield* Effect.flip(attempt as Effect.Effect<unknown, unknown>)).toBeInstanceOf(
          Errors.NotFound,
        );
      }

      // The member's command is as it was, and the only one.
      const commands = yield* member.devices.listCommands({
        params: { id: TabsTestLayer.memberZen },
        query: {},
      });
      expect(commands.map((command) => [command.id, command.status])).toEqual([
        [theirs.id, "pending"],
      ]);
    }).pipe(Effect.provide(server)),
  );

  it.effect("a device token of one user is no way into another user's device", () =>
    Effect.gen(function* () {
      const memberZen = yield* clientAs("token-member-zen");
      const error = yield* memberZen.tabs
        .report({ params: { id: TabsTestLayer.zenA }, payload: { takenAt, tabs: [] } })
        .pipe(Effect.flip);
      // Not even 403, which would say the device exists: for this user it does not.
      expect(error).toBeInstanceOf(Errors.NotFound);
      const { devices } = yield* (yield* clientAs("token-owner")).tabs.list();
      expect(devices.find((entry) => entry.device.id === TabsTestLayer.zenA)?.snapshot).toBeNull();
    }).pipe(Effect.provide(server)),
  );
});
