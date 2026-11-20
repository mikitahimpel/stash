import { describe, expect, it } from "@effect/vitest";
import * as Errors from "@stash/contracts-domain/errors";
import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import type * as Tab from "@stash/contracts-domain/tab";
import * as DateTime from "effect/DateTime";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveRateLimiter from "@stash/backend-links/save-rate-limiter";
import * as DevicesRepo from "../src/devices/devices-repo.ts";
import * as OpenTabsRepo from "../src/snapshots/open-tabs-repo.ts";
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

// The SQL of every read (`all`, `first`) the repos make, in order.
const reads: Array<string> = [];
const layerRecordingReads = Layer.mergeAll(
  DevicesRepo.layer,
  OpenTabsRepo.layer,
  LinksRepo.layer,
  SaveRateLimiter.layer(),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.effect(D1Database.Database)(
        Effect.map(D1Database.Database, (db) =>
          D1Database.Database.of({
            ...db,
            all: (s) =>
              Effect.andThen(
                Effect.sync(() => reads.push(s.sql)),
                db.all(s),
              ),
            first: (s) =>
              Effect.andThen(
                Effect.sync(() => reads.push(s.sql)),
                db.first(s),
              ),
          }),
        ),
      ).pipe(Layer.provide(TabsTestLayer.layerDatabase)),
      Testing.layerEnrichmentQueue,
      Testing.layerKv,
      Testing.layerLinkEvents,
      Testing.layerCurrentUser(),
    ),
  ),
);

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

  it.effect("dates the answer with the server's time from before its read", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("90 seconds");
      const all = yield* ListOpenTabs.listOpenTabs;
      expect(all.at).toEqual(DateTime.makeUnsafe(90_000));
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

  it.effect("keeps the active time, window and icon a device reports", () =>
    Effect.gen(function* () {
      yield* report()("2026-02-01T10:00:00.000Z", [
        {
          ...tab("https://example.com/full"),
          lastActiveAt: at("2026-02-01T09:59:00.000Z"),
          window: { id: "3", name: "Research" },
          faviconUrl: Link.Url.make("https://example.com/favicon.ico"),
        },
        { ...tab("https://example.com/plain"), window: { id: "4" } },
      ]);
      const snapshot = yield* snapshotOf(TabsTestLayer.zenA);
      const [full, plain] = snapshot?.tabs ?? [];
      expect(iso(full?.lastActiveAt ?? null)).toBe("2026-02-01T09:59:00.000Z");
      expect(full?.window).toEqual({ id: "3", name: "Research" });
      expect(full?.faviconUrl).toBe("https://example.com/favicon.ico");
      expect(plain).not.toHaveProperty("lastActiveAt");
      expect(plain).not.toHaveProperty("faviconUrl");
      expect(plain?.window).toEqual({ id: "4" });
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("tells the live stream the device's new tabs and which of them are saved", () =>
    Effect.gen(function* () {
      const db = yield* D1Database.Database;
      // The member saved `other` too: for the owner it is not saved.
      yield* db.exec(
        `INSERT INTO links (user_id, id, url, canonical_url, title) VALUES
          ('owner', 'link-saved', 'https://example.com/saved', 'https://example.com/saved',
            'Saved'),
          ('${Testing.member.id}', 'link-member', 'https://example.com/other',
            'https://example.com/other', 'Member''s')`,
      );
      yield* report()("2026-02-01T10:00:00.000Z", [
        tab("https://example.com/saved?utm_source=feed"),
        tab("https://example.com/other"),
      ]);
      const published = yield* Testing.TestLinkEvents.use((events) => events.published);
      expect(published).toHaveLength(1);
      // Only the device's user hears of it.
      expect(yield* Testing.TestLinkEvents.use((events) => events.publishedTo("owner"))).toEqual(
        published,
      );
      const event = published[0];
      if (event?.type !== "tabs.updated") throw new Error("expected tabs.updated");
      expect(event.device.id).toBe(TabsTestLayer.zenA);
      expect(event.snapshot.tabs.map((t) => t.url)).toEqual([
        "https://example.com/saved?utm_source=feed",
        "https://example.com/other",
      ]);
      expect(event.saved).toEqual([
        { url: "https://example.com/saved?utm_source=feed", linkId: "link-saved", imageUrl: null },
      ]);

      const { devices } = yield* ListOpenTabs.listOpenTabs;
      expect(devices.find((entry) => entry.device.id === TabsTestLayer.zenA)?.saved).toEqual(
        event.saved,
      );
      expect(devices.find((entry) => entry.device.id === TabsTestLayer.zenB)?.saved).toEqual([]);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("never writes, counts or announces a report for another user's device", () =>
    Effect.gen(function* () {
      // The member's Zen is the member's own; as the owner, it does not exist.
      const error = yield* report(TabsTestLayer.user, TabsTestLayer.memberZen)(
        "2026-02-01T10:00:00.000Z",
        [tab("https://example.com/x")],
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.NotFound);
      expect(yield* Testing.TestLinkEvents.use((events) => events.published)).toEqual([]);

      const db = yield* D1Database.Database;
      const [row] = yield* db.all(
        D1Database.sql`SELECT tabs_taken_at AS taken, tabs_window_count AS count
          FROM devices WHERE id = ${TabsTestLayer.memberZen}`,
      );
      expect(row).toEqual({ taken: null, count: 0 });
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("limits how often one device reports, per device and per window", () =>
    Effect.gen(function* () {
      const reportA = report();
      for (let i = 0; i < ReplaceTabsSnapshot.reportLimit.count; i++) {
        yield* reportA("2026-02-01T10:00:00.000Z", []);
      }
      const error = yield* reportA("2026-02-01T10:00:00.000Z", [tab("https://example.com/x")]).pipe(
        Effect.flip,
      );
      expect(error).toBeInstanceOf(Errors.RateLimited);
      expect(rows(yield* snapshotOf(TabsTestLayer.zenA))).toEqual([]);

      yield* report(TabsTestLayer.asDevice(TabsTestLayer.zenB), TabsTestLayer.zenB)(
        "2026-02-01T10:00:00.000Z",
        [],
      );
      yield* TestClock.adjust(ReplaceTabsSnapshot.reportLimit.windowMillis);
      yield* reportA("2026-02-01T10:01:00.000Z", [tab("https://example.com/x")]);
      expect(rows(yield* snapshotOf(TabsTestLayer.zenA))).toHaveLength(1);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("announces what it wrote, with the kept times, without reading the tabs back", () =>
    Effect.gen(function* () {
      const reportA = report();
      yield* reportA("2026-02-01T10:00:00.000Z", [tab("https://example.com/kept")]);
      reads.length = 0;
      yield* reportA("2026-02-01T11:00:00.000Z", [
        tab("https://example.com/new"),
        {
          ...tab("https://example.com/kept", "2026-02-01T10:59:00.000Z"),
          window: { id: "2", name: "Work" },
        },
        tab("https://example.com/third"),
      ]);
      // The device is read once, to check the device may write; its tabs are never read.
      expect(
        reads.filter((sql) => /\bFROM open_tabs\b/.test(sql) && /^\s*SELECT/.test(sql)),
      ).toEqual([]);
      expect(reads.filter((sql) => /^\s*SELECT[^]*\bFROM devices\b/.test(sql))).toHaveLength(1);

      const published = yield* Testing.TestLinkEvents.use((events) => events.published);
      const event = published.at(-1);
      if (event?.type !== "tabs.updated") throw new Error("expected tabs.updated");
      expect(event.device).toEqual({
        id: TabsTestLayer.zenA,
        name: "Synthetic Zen A",
        kind: "zen",
        createdAt: at("2026-01-01T00:00:00.000Z"),
      });
      // The event holds exactly what a read of the device gives.
      expect(event.snapshot).toEqual(yield* snapshotOf(TabsTestLayer.zenA));
      expect(rows(event.snapshot)).toEqual([
        ["https://example.com/new", "2026-02-01T11:00:00.000Z", "2026-02-01T11:00:00.000Z"],
        ["https://example.com/kept", "2026-02-01T10:00:00.000Z", "2026-02-01T11:00:00.000Z"],
        ["https://example.com/third", "2026-02-01T11:00:00.000Z", "2026-02-01T11:00:00.000Z"],
      ]);
      expect(event.snapshot.tabs[1]?.window).toEqual({ id: "2", name: "Work" });
    }).pipe(Effect.provide(layerRecordingReads)),
  );
});
