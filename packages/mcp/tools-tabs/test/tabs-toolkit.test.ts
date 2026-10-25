import { assert, describe, it } from "@effect/vitest";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Testing from "@stash/mcp-platform/testing";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import type { Tool } from "effect/ai";
import * as TabsToolkit from "../src/tabs-toolkit.ts";

const url = (value: string) => Schema.decodeUnknownSync(Link.Url)(value);

const zen: Device.Device = {
  id: Device.DeviceId.make("device-zen"),
  name: "Synthetic Zen",
  kind: "zen",
  createdAt: Testing.now,
};

const phone: Device.Device = {
  id: Device.DeviceId.make("device-ios"),
  name: "Synthetic Phone",
  kind: "ios",
  createdAt: Testing.now,
};

const openTab = {
  url: url("https://example.com/open"),
  title: "Open",
  openedAt: null,
  lastSeenAt: Testing.now,
};

const seed: Testing.Seed = {
  devices: [zen, phone],
  snapshots: [{ deviceId: zen.id, takenAt: Testing.now, tabs: [openTab] }],
};

const layer = (seed: Testing.Seed = {}) =>
  TabsToolkit.layer.pipe(Layer.provideMerge(Testing.layer(seed)));

/** Calls a tool the way the MCP server does: encoded params in, final result out. */
const call = <Name extends keyof typeof TabsToolkit.toolkit.tools>(
  name: Name,
  params: Tool.ParametersEncoded<(typeof TabsToolkit.toolkit.tools)[Name]>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* TabsToolkit.toolkit;
    const results = yield* toolkit.handle(name, params);
    return yield* Stream.runLast(results).pipe(Effect.map(Option.getOrThrow));
  });

describe("list_open_tabs", () => {
  it.effect("lists every device with its tabs, encoded for the model", () =>
    Effect.gen(function* () {
      const result = yield* call("list_open_tabs", {});
      assert.isFalse(result.isFailure);
      assert.deepStrictEqual(result.encodedResult, {
        devices: [
          {
            deviceId: "device-zen",
            name: "Synthetic Zen",
            kind: "zen",
            reportedAt: "2026-01-02T03:04:05.000Z",
            tabs: [{ url: "https://example.com/open", title: "Open", openedAt: null }],
          },
          {
            deviceId: "device-ios",
            name: "Synthetic Phone",
            kind: "ios",
            reportedAt: null,
            tabs: [],
          },
        ],
      });
    }).pipe(Effect.provide(layer(seed))),
  );

  it.effect("filters by device", () =>
    Effect.gen(function* () {
      const result = yield* call("list_open_tabs", { deviceId: "device-ios" });
      assert.deepStrictEqual(
        (result.encodedResult as { devices: ReadonlyArray<{ deviceId: string }> }).devices.map(
          (device) => device.deviceId,
        ),
        ["device-ios"],
      );
    }).pipe(Effect.provide(layer(seed))),
  );
});

describe("archive_tab", () => {
  it.effect("saves the tab as a link and queues a close-tab command", () =>
    Effect.gen(function* () {
      const result = yield* call("archive_tab", {
        deviceId: "device-zen",
        url: "https://example.com/open",
        title: "Open",
      });
      assert.isFalse(result.isFailure);

      const test = yield* Testing.TestApi;
      const links = yield* test.links;
      assert.deepStrictEqual(
        links.map((link) => [link.url, link.title]),
        [[openTab.url, "Open"]],
      );
      const commands = yield* test.commands;
      assert.deepStrictEqual(
        commands.map((command) => [command.deviceId, command.payload]),
        [[zen.id, { kind: "close-tab", url: openTab.url }]],
      );
    }).pipe(Effect.provide(layer(seed))),
  );

  it.effect("fails with NotFound for an unknown device", () =>
    Effect.gen(function* () {
      const error = yield* call("archive_tab", {
        deviceId: "device-missing",
        url: "https://example.com/open",
      }).pipe(Effect.flip);
      assert.instanceOf(error, Errors.NotFound);
    }).pipe(Effect.provide(layer(seed))),
  );

  it.effect("rejects a URL that is not http(s)", () =>
    Effect.gen(function* () {
      const error = yield* call("archive_tab", {
        deviceId: "device-zen",
        url: "not a url",
      }).pipe(Effect.flip);
      assert.strictEqual(error._tag, "AiError");
      const test = yield* Testing.TestApi;
      assert.strictEqual((yield* test.links).length, 0);
    }).pipe(Effect.provide(layer(seed))),
  );
});

describe("close_tab_on_device", () => {
  it.effect("queues a close-tab command without saving a link", () =>
    Effect.gen(function* () {
      const result = yield* call("close_tab_on_device", {
        deviceId: "device-zen",
        url: "https://example.com/open",
      });
      assert.isFalse(result.isFailure);
      assert.deepStrictEqual(result.encodedResult, {
        id: "command-1",
        deviceId: "device-zen",
        payload: { kind: "close-tab", url: "https://example.com/open" },
        status: "pending",
        createdAt: "2026-01-02T03:04:05.000Z",
        completedAt: null,
      });

      const test = yield* Testing.TestApi;
      assert.strictEqual((yield* test.links).length, 0);
      assert.strictEqual((yield* test.commands).length, 1);
    }).pipe(Effect.provide(layer(seed))),
  );

  it.effect("fails with NotFound for an unknown device", () =>
    Effect.gen(function* () {
      const error = yield* call("close_tab_on_device", {
        deviceId: "device-missing",
        url: "https://example.com/open",
      }).pipe(Effect.flip);
      assert.instanceOf(error, Errors.NotFound);
    }).pipe(Effect.provide(layer())),
  );
});
