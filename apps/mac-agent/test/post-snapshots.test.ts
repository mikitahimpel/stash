import { describe, expect, it } from "@effect/vitest";
import * as Device from "@stash/contracts-domain/device";
import * as Tab from "@stash/contracts-domain/tab";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import type * as CloudTabsReader from "../src/cloud-tabs-reader.ts";
import * as DeviceMap from "../src/device-map.ts";
import * as PostSnapshots from "../src/post-snapshots.ts";
import * as StubApi from "./fixtures/stub-api.ts";

const phone = "00000000-0000-4000-8000-000000000001";
const tablet = "00000000-0000-4000-8000-000000000002";

const decodeSnapshot = Schema.decodeUnknownSync(Tab.TabsSnapshot);
const deviceId = Schema.decodeUnknownSync(Device.DeviceId);

const device = (
  deviceId: string,
  name: string | null,
  urls: ReadonlyArray<string>,
  takenAt = "2026-01-01T10:00:00.000Z",
): CloudTabsReader.CloudDevice => ({
  name,
  snapshot: decodeSnapshot({
    deviceId,
    takenAt,
    tabs: urls.map((url) => ({
      url,
      title: `Title of ${url}`,
      openedAt: null,
      lastSeenAt: takenAt,
    })),
  }),
});

const layer = (stub: StubApi.StubApi, initial: Record<string, Device.DeviceId> = {}) =>
  PostSnapshots.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        PostSnapshots.clientLayer({
          baseUrl: StubApi.baseUrl,
          deviceToken: Redacted.make(StubApi.deviceToken),
        }).pipe(Layer.provide(stub.layer)),
        DeviceMap.layerMemory(initial),
      ),
    ),
  );

const post = (devices: ReadonlyArray<CloudTabsReader.CloudDevice>) =>
  PostSnapshots.SnapshotPoster.use((poster) => poster.post(devices));

describe("SnapshotPoster", () => {
  it.effect("registers each new iCloud device once and reports its tabs", () => {
    const stub = StubApi.make();
    return Effect.gen(function* () {
      const result = yield* post([
        device(phone, "Test iPhone", ["https://example.com/a"]),
        device(tablet, null, []),
      ]);
      expect(result).toEqual({ registered: [phone, tablet], posted: [phone, tablet], skipped: [] });

      expect(stub.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "POST /devices",
        "PUT /devices/stash-device-1/tabs",
        "POST /devices",
        "PUT /devices/stash-device-2/tabs",
      ]);
      expect(stub.requests[0]?.body).toEqual({ name: "Test iPhone", kind: "ios" });
      expect(stub.requests[2]?.body).toEqual({ name: "iCloud device 00000000", kind: "ios" });
      expect(stub.requests[1]?.body).toEqual({
        takenAt: "2026-01-01T10:00:00.000Z",
        tabs: [
          {
            url: "https://example.com/a",
            title: "Title of https://example.com/a",
            openedAt: null,
            lastSeenAt: "2026-01-01T10:00:00.000Z",
          },
        ],
      });
      for (const request of stub.requests) {
        expect(request.authorization).toBe(`Bearer ${StubApi.deviceToken}`);
      }

      const map = yield* DeviceMap.DeviceMap;
      expect(yield* map.get(phone)).toEqual(Option.some("stash-device-1"));
    }).pipe(Effect.provide(layer(stub)));
  });

  it.effect("reuses the persisted mapping instead of registering again", () => {
    const stub = StubApi.make();
    stub.devices.add("stash-existing");
    return Effect.gen(function* () {
      const result = yield* post([device(phone, "Test iPhone", ["https://example.com/a"])]);
      expect(result).toEqual({ registered: [], posted: [phone], skipped: [] });
      expect(stub.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "PUT /devices/stash-existing/tabs",
      ]);
    }).pipe(Effect.provide(layer(stub, { [phone]: deviceId("stash-existing") })));
  });

  it.effect("skips a snapshot whose tabs did not change", () => {
    const stub = StubApi.make();
    return Effect.gen(function* () {
      yield* post([device(phone, "Test iPhone", ["https://example.com/a"])]);
      const later = "2026-01-01T10:05:00.000Z";
      const same = yield* post([device(phone, "Test iPhone", ["https://example.com/a"], later)]);
      expect(same).toEqual({ registered: [], posted: [], skipped: [phone] });

      const changed = yield* post([
        device(phone, "Test iPhone", ["https://example.com/a", "https://example.com/b"], later),
      ]);
      expect(changed).toEqual({ registered: [], posted: [phone], skipped: [] });
      expect(stub.requests.filter((r) => r.method === "PUT")).toHaveLength(2);
    }).pipe(Effect.provide(layer(stub)));
  });

  it.effect("forgets a device the API no longer knows and registers it again next run", () => {
    const stub = StubApi.make();
    return Effect.gen(function* () {
      yield* post([device(phone, "Test iPhone", ["https://example.com/a"])]);
      stub.devices.clear();

      const error = yield* Effect.flip(
        post([device(phone, "Test iPhone", ["https://example.com/b"])]),
      );
      expect(error._tag).toBe("NotFound");
      expect(Option.isNone(yield* (yield* DeviceMap.DeviceMap).get(phone))).toBe(true);

      const result = yield* post([device(phone, "Test iPhone", ["https://example.com/b"])]);
      expect(result.registered).toEqual([phone]);
      expect(stub.requests.at(-1)?.path).toBe("/devices/stash-device-1/tabs");
    }).pipe(Effect.provide(layer(stub)));
  });

  it.effect("fails with the API error when the token is rejected", () => {
    const stub = StubApi.make();
    stub.unauthorized = true;
    return Effect.gen(function* () {
      const error = yield* Effect.flip(post([device(phone, "Test iPhone", [])]));
      expect(error._tag).toBe("Unauthorized");
      expect(Option.isNone(yield* (yield* DeviceMap.DeviceMap).get(phone))).toBe(true);
    }).pipe(Effect.provide(layer(stub)));
  });
});

describe("deviceName", () => {
  it("trims and caps the iCloud name, falling back for blank names", () => {
    expect(PostSnapshots.deviceName(device(phone, "  Test iPhone ", []))).toBe("Test iPhone");
    expect(PostSnapshots.deviceName(device(phone, "x".repeat(150), []))).toHaveLength(100);
    expect(PostSnapshots.deviceName(device(phone, "   ", []))).toBe("iCloud device 00000000");
  });
});
