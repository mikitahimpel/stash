import { describe, expect, it, vi } from "@effect/vitest";
import * as Tab from "@stash/contracts-domain/tab";
import { Effect, Fiber, Layer, Queue, Redacted, Schema, Stream } from "effect";
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
// forked loop a few macrotasks to finish a run. `until` waits (by the real clock) for what must
// happen; `settle` then gives what must not happen the same chance.
const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)));
const until = (check: () => void) =>
  Effect.promise(() => vi.waitFor(check, { timeout: 5000, interval: 10 }));

const puts = (stub: StubApi.StubApi) => stub.requests.filter((r) => r.method === "PUT").length;

describe("loop", () => {
  it.effect("posts on start, then once per interval, skipping unchanged snapshots", () => {
    const stub = StubApi.make();
    let tabs = snapshot.tabs;
    const read = Effect.sync(() => [{ name: "Test iPhone", snapshot: { ...snapshot, tabs } }]);
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Main.loop("5 minutes"));
      yield* until(() => expect(puts(stub)).toBe(1));

      yield* TestClock.adjust("5 minutes");
      yield* settle;
      expect(puts(stub)).toBe(1);

      tabs = [];
      yield* TestClock.adjust("5 minutes");
      yield* until(() => expect(puts(stub)).toBe(2));
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
      yield* until(() => expect(puts(stub)).toBe(1));
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(layer(stub, read)));
  });

  it.effect("posts a database write after it settles, without waiting for the poll", () => {
    const stub = StubApi.make();
    let tabs = snapshot.tabs;
    const read = Effect.sync(() => [{ name: "Test iPhone", snapshot: { ...snapshot, tabs } }]);
    return Effect.gen(function* () {
      const writes = yield* Queue.unbounded<void>();
      const fiber = yield* Effect.forkChild(
        Main.loop("15 minutes", Stream.fromQueue(writes), "2 seconds"),
      );
      yield* until(() => expect(puts(stub)).toBe(1));

      // Safari writes the database, the WAL and the index in a burst: one read, after the pause.
      tabs = [];
      yield* Queue.offerAll(writes, [undefined, undefined, undefined]);
      yield* settle;
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(puts(stub)).toBe(1);
      yield* TestClock.adjust("1 second");
      yield* until(() => expect(puts(stub)).toBe(2));

      // A write that changed no tab posts nothing.
      yield* Queue.offer(writes, undefined);
      yield* TestClock.adjust("2 seconds");
      yield* settle;
      expect(puts(stub)).toBe(2);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(layer(stub, read)));
  });
});
