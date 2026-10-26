import { describe, expect, it } from "@effect/vitest";
import * as Errors from "@stash/contracts-domain/errors";
import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import type * as Tab from "@stash/contracts-domain/tab";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ListOpenTabs from "../src/snapshots/list-open-tabs.ts";
import * as ReplaceTabsSnapshot from "../src/snapshots/replace-tabs-snapshot.ts";
import * as TabsTestLayer from "./tabs-test-layer.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

const tab = (url: string, openedAt: string | null = null): Tab.OpenTab => ({
  url: Link.Url.make(url),
  title: `Title of ${url}`,
  openedAt: openedAt === null ? null : at(openedAt),
  lastSeenAt: at("2000-01-01T00:00:00.000Z"),
});

const report = (
  principal = TabsTestLayer.asDevice(TabsTestLayer.zenA),
  deviceId = TabsTestLayer.zenA,
) =>
  Effect.fnUntraced(function* (takenAt: string, tabs: ReadonlyArray<Tab.OpenTab>) {
    yield* ReplaceTabsSnapshot.replaceTabsSnapshot(principal, deviceId, {
      takenAt: at(takenAt),
      tabs,
    });
  });

const snapshotOf = (deviceId: Device.DeviceId) =>
  Effect.map(
    ListOpenTabs.listOpenTabs,
    ({ devices }) => devices.find((entry) => entry.device.id === deviceId)?.snapshot,
  );

const iso = (value: DateTime.Utc | null) => (value === null ? null : DateTime.formatIso(value));

const rows = (snapshot: Tab.TabsSnapshot | null | undefined) =>
  snapshot?.tabs.map((t) => [t.url, iso(t.openedAt), iso(t.lastSeenAt)]);

describe("replaceTabsSnapshot", () => {
  it.effect("keeps opened_at for URLs still open and updates last_seen_at", () =>
    Effect.gen(function* () {
      const reportA = report();
      yield* reportA("2026-02-01T10:00:00.000Z", [
        tab("https://example.com/kept"),
        tab("https://example.com/closed"),
        tab("https://example.com/reported", "2026-01-31T08:00:00.000Z"),
      ]);
      yield* reportA("2026-02-01T11:00:00.000Z", [
        tab("https://example.com/new"),
        tab("https://example.com/kept", "2026-02-01T10:59:00.000Z"),
        tab("https://example.com/reported"),
      ]);

      const snapshot = yield* snapshotOf(TabsTestLayer.zenA);
      expect(iso(snapshot?.takenAt ?? null)).toBe("2026-02-01T11:00:00.000Z");
      expect(rows(snapshot)).toEqual([
        ["https://example.com/new", "2026-02-01T11:00:00.000Z", "2026-02-01T11:00:00.000Z"],
        ["https://example.com/kept", "2026-02-01T10:00:00.000Z", "2026-02-01T11:00:00.000Z"],
        ["https://example.com/reported", "2026-01-31T08:00:00.000Z", "2026-02-01T11:00:00.000Z"],
      ]);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("replaces only the reporting device's tabs", () =>
    Effect.gen(function* () {
      yield* report()("2026-02-01T10:00:00.000Z", [tab("https://example.com/a")]);
      yield* report(TabsTestLayer.asDevice(TabsTestLayer.zenB), TabsTestLayer.zenB)(
        "2026-02-01T10:05:00.000Z",
        [tab("https://example.com/b")],
      );
      yield* report()("2026-02-01T11:00:00.000Z", []);

      expect(rows(yield* snapshotOf(TabsTestLayer.zenA))).toEqual([]);
      expect(rows(yield* snapshotOf(TabsTestLayer.zenB))).toEqual([
        ["https://example.com/b", "2026-02-01T10:05:00.000Z", "2026-02-01T10:05:00.000Z"],
      ]);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("groups by device and tells an empty snapshot from none", () =>
    Effect.gen(function* () {
      yield* report()("2026-02-01T10:00:00.000Z", []);
      const { devices } = yield* ListOpenTabs.listOpenTabs;
      expect(devices.map((entry) => [entry.device.id, entry.snapshot?.tabs ?? null])).toEqual([
        [TabsTestLayer.zenA, []],
        [TabsTestLayer.zenB, null],
        [TabsTestLayer.macAgent, null],
        [TabsTestLayer.iphone, null],
      ]);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("lets a device write only its own snapshot, and mac-agent those of iOS devices", () =>
    Effect.gen(function* () {
      const zenA = TabsTestLayer.asDevice(TabsTestLayer.zenA);
      const mac = TabsTestLayer.asDevice(TabsTestLayer.macAgent);
      const tabs = [tab("https://example.com/x")];

      const other = yield* report(zenA, TabsTestLayer.zenB)("2026-02-01T10:00:00.000Z", tabs).pipe(
        Effect.flip,
      );
      expect(other).toBeInstanceOf(Errors.Forbidden);
      const iosByZen = yield* report(zenA, TabsTestLayer.iphone)(
        "2026-02-01T10:00:00.000Z",
        tabs,
      ).pipe(Effect.flip);
      expect(iosByZen).toBeInstanceOf(Errors.Forbidden);
      const zenByMac = yield* report(mac, TabsTestLayer.zenB)(
        "2026-02-01T10:00:00.000Z",
        tabs,
      ).pipe(Effect.flip);
      expect(zenByMac).toBeInstanceOf(Errors.Forbidden);
      expect(yield* snapshotOf(TabsTestLayer.zenB)).toBeNull();

      yield* report(mac, TabsTestLayer.iphone)("2026-02-01T10:00:00.000Z", tabs);
      yield* report(TabsTestLayer.user, TabsTestLayer.zenB)("2026-02-01T10:00:00.000Z", tabs);
      expect(rows(yield* snapshotOf(TabsTestLayer.iphone))).toHaveLength(1);
      expect(rows(yield* snapshotOf(TabsTestLayer.zenB))).toHaveLength(1);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("answers NotFound for an unknown device", () =>
    Effect.gen(function* () {
      const unknown = Device.DeviceId.make("device-unknown");
      const error = yield* report(TabsTestLayer.user, unknown)("2026-02-01T10:00:00.000Z", []).pipe(
        Effect.flip,
      );
      expect(error).toEqual(new Errors.NotFound({ resource: "device", id: unknown }));
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );
});
