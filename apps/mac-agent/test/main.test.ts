import { describe, expect, it } from "@effect/vitest";
import * as Tab from "@stash/contracts-domain/tab";
import { Effect, Fiber, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as CloudTabsReader from "../src/cloud-tabs-reader.ts";
import * as DeviceMap from "../src/device-map.ts";
import * as Main from "../src/main.ts";
import * as PostSnapshots from "../src/post-snapshots.ts";
import * as StubApi from "./fixtures/stub-api.ts";

const phone = "00000000-0000-4000-8000-000000000001";

const snapshot = Schema.decodeUnknownSync(Tab.TabsSnapshot)({
  deviceId: phone,
  takenAt: "2026-01-01T10:00:00.000Z",
  tabs: [
    {
      url: "https://example.com/a",
      title: "A",
      openedAt: null,
      lastSeenAt: "2026-01-01T10:00:00.000Z",
    },
  ],
});

const reader = (read: CloudTabsReader.CloudTabsReader["Service"]["read"]) =>
  Layer.succeed(CloudTabsReader.CloudTabsReader, { read });

const layer = (stub: StubApi.StubApi, read: CloudTabsReader.CloudTabsReader["Service"]["read"]) =>
  Layer.mergeAll(
    PostSnapshots.layer.pipe(
      Layer.provide(
        PostSnapshots.clientLayer({
          baseUrl: StubApi.baseUrl,
          deviceToken: Redacted.make(StubApi.deviceToken),
        }).pipe(Layer.provide(stub.layer)),
      ),
      Layer.provide(DeviceMap.layerMemory()),
    ),
    reader(read),
  );

// The stub responds through `Response`, whose body is read on the real event loop, so give the
// forked loop a few macrotasks to finish a run.
const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));

const puts = (stub: StubApi.StubApi) => stub.requests.filter((r) => r.method === "PUT").length;

describe("loop", () => {
  it.effect("posts on start, then once per interval, skipping unchanged snapshots", () => {
    const stub = StubApi.make();
    let tabs = snapshot.tabs;
    const read = Effect.sync(() => [{ name: "Test iPhone", snapshot: { ...snapshot, tabs } }]);
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Main.loop("5 minutes"));
      yield* settle;
      expect(puts(stub)).toBe(1);

      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(puts(stub)).toBe(1);

      tabs = [];
      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(puts(stub)).toBe(2);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(layer(stub, read)));
  });

  it.effect("keeps running after a failed run", () => {
    const stub = StubApi.make();
    let fail = true;
    const read = Effect.suspend(() =>
      fail
        ? Effect.fail(
            new CloudTabsReader.CloudTabsReadError({ path: "/tmp/x.db", message: "nope" }),
          )
        : Effect.succeed([{ name: "Test iPhone", snapshot }]),
    );
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Main.loop("1 minute"));
      yield* settle;
      expect(puts(stub)).toBe(0);

      fail = false;
      yield* TestClock.adjust("1 minute");
      yield* settle;
      expect(puts(stub)).toBe(1);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(layer(stub, read)));
  });
});
