import { describe, expect, it } from "@effect/vitest";
import * as Alarms from "@stash/ext-platform/browser-alarms";
import { BrowserError } from "@stash/ext-platform/browser-error";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as UrlParams from "effect/http/UrlParams";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as CommandsPoller from "../src/commands-poller.ts";

// Synthetic placeholders, not real tokens.
const config = { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token" };

// Lets forked fibers run before the test looks at the state.
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

const command = (id: string, payload: unknown) => ({
  id,
  deviceId: "device-1",
  payload,
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
});

/** A fake API: `/auth/me` answers `principal`, the pending list answers `pending`. */
const fakeApi = (
  options: {
    readonly pending?: ReadonlyArray<unknown>;
    readonly principal?: unknown;
    readonly ackStatus?: number;
  } = {},
) => {
  const requests: Array<string> = [];
  const acks: Array<{ readonly id: string; readonly status: unknown }> = [];
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/auth/me") {
        return Response.json(options.principal ?? { kind: "device", deviceId: "device-1" });
      }
      if (request.method === "GET" && url.pathname === "/devices/device-1/commands") {
        return Response.json(options.pending ?? []);
      }
      const ack = /^\/commands\/([^/]+)\/ack$/.exec(url.pathname);
      if (request.method === "POST" && ack !== null) {
        const body = request.body;
        const status =
          body._tag === "Uint8Array"
            ? (JSON.parse(new TextDecoder().decode(body.body)) as { status: unknown }).status
            : undefined;
        acks.push({ id: ack[1] ?? "", status });
        const ackStatus = options.ackStatus ?? 200;
        return ackStatus === 200
          ? Response.json({
              ...command(ack[1] ?? "", { kind: "close-tab", url: "https://example.com/" }),
              status,
              completedAt: "2026-01-01T00:01:00.000Z",
            })
          : Response.json({ _tag: "Conflict", message: "Not pending" }, { status: ackStatus });
      }
      return new Response(null, { status: 404 });
    });
  return { requests, acks, handler };
};

const tabs = [
  Testing.tab({ id: 1, url: "https://example.com/read-later" }),
  Testing.tab({ id: 2, url: "https://example.com/keep" }),
  Testing.tab({ id: 3, windowId: 2, url: "https://example.com/read-later" }),
  Testing.tab({ id: 4, url: null }),
];

const openTabIds = Effect.map(
  Effect.flatMap(Testing.TestTabs, (test) => test.all),
  (all) => all.map((tab) => tab.id),
);

describe("pollOnce", () => {
  it.effect("closes every tab with the URL and acks done", () => {
    const api = fakeApi({
      pending: [command("command-1", { kind: "close-tab", url: "https://example.com/read-later" })],
    });
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([{ id: "command-1", status: "done" }]);
      expect(yield* openTabIds).toEqual([2, 4]);
      expect(api.requests).toEqual([
        "GET /auth/me",
        "GET /devices/device-1/commands",
        "POST /commands/command-1/ack",
      ]);
      expect(api.acks).toEqual([{ id: "command-1", status: "done" }]);
    }).pipe(Effect.provide(Testing.make({ config, tabs, handler: api.handler })));
  });

  it.effect("asks for pending commands only", () => {
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    const api = fakeApi();
    const handler = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.flatMap(
        Effect.sync(() => requests.push(request)),
        () => api.handler(request),
      );
    return Effect.gen(function* () {
      yield* CommandsPoller.pollOnce;
      const list = requests.find((request) => request.url.endsWith("/commands"));
      expect(UrlParams.toRecord(list?.urlParams ?? UrlParams.empty)).toEqual({ status: "pending" });
      expect(list?.headers["authorization"]).toBe("Bearer synthetic-token");
    }).pipe(Effect.provide(Testing.make({ config, handler })));
  });

  it.effect("matches URLs the way the browser prints them", () => {
    const api = fakeApi({
      pending: [command("command-1", { kind: "close-tab", url: "https://EXAMPLE.com" })],
    });
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([{ id: "command-1", status: "done" }]);
      expect(yield* openTabIds).toEqual([2]);
    }).pipe(
      Effect.provide(
        Testing.make({
          config,
          tabs: [Testing.tab({ id: 1, url: "https://example.com/" }), Testing.tab({ id: 2 })],
          handler: api.handler,
        }),
      ),
    );
  });

  it.effect("acks done when no tab has the URL", () => {
    const api = fakeApi({
      pending: [command("command-1", { kind: "close-tab", url: "https://example.com/gone" })],
    });
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([{ id: "command-1", status: "done" }]);
      expect(yield* openTabIds).toEqual([1, 2, 3, 4]);
    }).pipe(Effect.provide(Testing.make({ config, tabs, handler: api.handler })));
  });

  it.effect("acks failed when the browser can't close the tab", () => {
    const api = fakeApi({
      pending: [command("command-1", { kind: "close-tab", url: "https://example.com/read-later" })],
    });
    const failingTabs = Layer.succeed(Tabs.Tabs)({
      query: () => Effect.succeed(tabs),
      current: Effect.succeedNone,
      remove: () => Effect.fail(new BrowserError({ api: "tabs.remove" })),
      createBlank: () => Effect.fail(new BrowserError({ api: "tabs.create" })),
      changed: Stream.empty,
    });
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([{ id: "command-1", status: "failed" }]);
      expect(api.acks).toEqual([{ id: "command-1", status: "failed" }]);
    }).pipe(
      Effect.provide(failingTabs),
      Effect.provide(Testing.make({ config, handler: api.handler })),
    );
  });

  it.effect("acks commands of unknown kinds failed and still runs the rest", () => {
    const api = fakeApi({
      pending: [
        command("command-1", { kind: "reboot" }),
        command("command-2", { kind: "close-tab", url: "https://example.com/keep" }),
        { unrelated: true },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([
        { id: "command-1", status: "failed" },
        { id: "command-2", status: "done" },
      ]);
      expect(api.acks).toEqual([
        { id: "command-1", status: "failed" },
        { id: "command-2", status: "done" },
      ]);
      expect(yield* openTabIds).toEqual([1, 3, 4]);
    }).pipe(Effect.provide(Testing.make({ config, tabs, handler: api.handler })));
  });

  it.effect("skips a command whose ack is rejected and keeps going", () => {
    const api = fakeApi({
      pending: [
        command("command-1", { kind: "close-tab", url: "https://example.com/keep" }),
        command("command-2", { kind: "close-tab", url: "https://example.com/read-later" }),
      ],
      ackStatus: 409,
    });
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([]);
      expect(api.acks.map((ack) => ack.id)).toEqual(["command-1", "command-2"]);
    }).pipe(Effect.provide(Testing.make({ config, tabs, handler: api.handler })));
  });

  it.effect("does nothing before a config is saved", () => {
    const api = fakeApi();
    return Effect.gen(function* () {
      expect(yield* CommandsPoller.pollOnce).toEqual([]);
      expect(api.requests).toEqual([]);
    }).pipe(Effect.provide(Testing.make({ handler: api.handler })));
  });

  it.effect("fails when the token isn't a device token", () => {
    const api = fakeApi({ principal: { kind: "user" } });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(CommandsPoller.pollOnce);
      expect(error._tag).toBe("NotADeviceError");
      expect(api.requests).toEqual(["GET /auth/me"]);
    }).pipe(Effect.provide(Testing.make({ config, handler: api.handler })));
  });

  it.effect("fails when the API rejects the list", () => {
    const handler = (request: HttpClientRequest.HttpClientRequest) =>
      request.url.endsWith("/auth/me")
        ? Effect.succeed(Response.json({ kind: "device", deviceId: "device-1" }))
        : Effect.succeed(new Response(null, { status: 500 }));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(CommandsPoller.pollOnce);
      expect(error._tag).toBe("HttpClientError");
    }).pipe(Effect.provide(Testing.make({ config, tabs, handler })));
  });
});

describe("layer", () => {
  it.effect("polls on start, creates the alarm and polls on every alarm", () => {
    let pending: ReadonlyArray<unknown> = [];
    const api = fakeApi();
    const handler = (request: HttpClientRequest.HttpClientRequest) =>
      new URL(request.url).pathname === "/devices/device-1/commands"
        ? Effect.sync(() => {
            api.requests.push("GET /devices/device-1/commands");
            const body = pending;
            pending = [];
            return Response.json(body);
          })
        : api.handler(request);
    return Effect.gen(function* () {
      yield* Layer.build(CommandsPoller.layer);
      yield* settle;
      expect(api.requests.filter((it) => it.startsWith("GET /devices"))).toHaveLength(1);

      const alarms = yield* (yield* Alarms.Alarms).list;
      expect(alarms).toEqual([
        expect.objectContaining({
          name: CommandsPoller.alarmName,
          periodInMinutes: CommandsPoller.periodInMinutes,
        }),
      ]);

      pending = [command("command-1", { kind: "close-tab", url: "https://example.com/keep" })];
      expect(yield* (yield* Testing.TestAlarms).fire("some-other-alarm")).toBe(false);
      expect(yield* (yield* Testing.TestAlarms).fire(CommandsPoller.alarmName)).toBe(true);
      yield* settle;
      expect(api.acks).toEqual([{ id: "command-1", status: "done" }]);
      expect(yield* openTabIds).toEqual([1, 3, 4]);
    }).pipe(Effect.scoped, Effect.provide(Testing.make({ config, tabs, handler })));
  });

  it.effect("keeps an existing alarm and survives a missing config", () =>
    Effect.gen(function* () {
      const alarms = yield* Alarms.Alarms;
      yield* alarms.create(CommandsPoller.alarmName, { delayInMinutes: 5, periodInMinutes: 1 });
      const before = yield* alarms.list;
      yield* Layer.build(CommandsPoller.layer);
      yield* settle;
      expect(yield* alarms.list).toEqual(before);
      expect(yield* (yield* Testing.TestAlarms).fire(CommandsPoller.alarmName)).toBe(true);
      yield* settle;
    }).pipe(Effect.scoped, Effect.provide(Testing.layer)),
  );
});
