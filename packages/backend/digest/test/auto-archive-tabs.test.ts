import { describe, expect, it } from "@effect/vitest";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveLinksBatch from "@stash/backend-links/save-links-batch";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import type * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as AutoArchiveTabs from "../src/auto-archive-tabs.ts";
import * as DigestTestLayer from "./digest-test-layer.ts";

const url = (value: string) => Link.Url.make(value);
const openedAt = DateTime.makeUnsafe("2026-03-01T09:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

/** Reports a snapshot with the tabs, each opened at its time, as of `openedAt`. */
const report = (
  deviceId: Device.DeviceId,
  tabs: ReadonlyArray<{ readonly url: string; readonly openedAt: DateTime.Utc | null }>,
) =>
  OpenTabsRepo.OpenTabsRepo.use((repo) =>
    repo.replace(
      deviceId,
      openedAt,
      tabs.map((tab) => ({
        url: url(tab.url),
        title: `Tab ${tab.url}`,
        openedAt: tab.openedAt,
        lastSeenAt: openedAt,
      })),
    ),
  );

const pendingUrls = (deviceId: Device.DeviceId) =>
  CommandsRepo.CommandsRepo.use((repo) => repo.listByDevice(deviceId, "pending")).pipe(
    Effect.map((commands) => commands.map((command) => command.payload.url)),
  );

const linkStatuses = LinksRepo.LinksRepo.use((repo) => repo.list({ limit: 100 })).pipe(
  Effect.map((links) =>
    Object.fromEntries(links.map(({ link }) => [link.url, link.status] as const)),
  ),
);

describe("autoArchiveTabs", () => {
  it.effect("archives Zen tabs only once they are older than archiveAfterDays", () =>
    Effect.gen(function* () {
      yield* report(DigestTestLayer.zen, [
        { url: "https://example.com/old", openedAt },
        { url: "https://example.com/newer", openedAt: DateTime.add(openedAt, { days: 1 }) },
      ]);

      // Exactly 30 days old is not older than 30 days.
      yield* TestClock.setTime(DateTime.toEpochMillis(openedAt) + 30 * day);
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(0);
      expect(yield* pendingUrls(DigestTestLayer.zen)).toEqual([]);
      expect(yield* linkStatuses).toEqual({});

      yield* TestClock.adjust("1 millis");
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(1);
      expect(yield* pendingUrls(DigestTestLayer.zen)).toEqual(["https://example.com/old"]);
      expect(yield* linkStatuses).toEqual({ "https://example.com/old": "archived" });

      // A day later the second tab is stale too. The first still waits for its device to close it.
      yield* TestClock.adjust("1 day");
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(1);
      expect(yield* pendingUrls(DigestTestLayer.zen)).toEqual([
        "https://example.com/old",
        "https://example.com/newer",
      ]);
      expect(yield* linkStatuses).toEqual({
        "https://example.com/old": "archived",
        "https://example.com/newer": "archived",
      });
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );

  it.effect("follows the configured threshold", () =>
    Effect.gen(function* () {
      yield* report(DigestTestLayer.zen, [{ url: "https://example.com/week", openedAt }]);
      yield* TestClock.setTime(DateTime.toEpochMillis(openedAt) + 7 * day);
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(0);
      yield* TestClock.adjust("1 second");
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(1);
    }).pipe(Effect.provide(DigestTestLayer.layer({ archiveAfterDays: 7 }))),
  );

  it.effect("ignores devices that are not Zen", () =>
    Effect.gen(function* () {
      yield* report(DigestTestLayer.iphone, [{ url: "https://example.com/phone", openedAt }]);
      yield* TestClock.setTime(DateTime.toEpochMillis(openedAt) + 365 * day);
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(0);
      expect(yield* pendingUrls(DigestTestLayer.iphone)).toEqual([]);
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );

  it.effect("uses lastSeenAt when the tab has no openedAt", () =>
    Effect.gen(function* () {
      yield* report(DigestTestLayer.zen, [{ url: "https://example.com/unknown", openedAt: null }]);
      yield* TestClock.setTime(DateTime.toEpochMillis(openedAt) + 31 * day);
      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(1);
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );

  it.effect("keeps the status of a link that was already read", () =>
    Effect.gen(function* () {
      const [saved] = yield* SaveLinksBatch.saveLinks({ kind: "user" }, [
        { url: url("https://example.com/read") },
      ]);
      yield* LinksRepo.LinksRepo.use((repo) => repo.update(saved!.id, { status: "done" }));
      yield* report(DigestTestLayer.zen, [{ url: "https://example.com/read", openedAt }]);
      yield* TestClock.setTime(DateTime.toEpochMillis(openedAt) + 31 * day);

      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(1);
      expect(yield* linkStatuses).toEqual({ "https://example.com/read": "done" });
      expect(yield* pendingUrls(DigestTestLayer.zen)).toEqual(["https://example.com/read"]);
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );
});
