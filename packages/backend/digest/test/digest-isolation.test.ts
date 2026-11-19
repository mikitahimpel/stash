import { describe, expect, it } from "@effect/vitest";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as Testing from "@stash/backend-platform/testing";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import type * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as AutoArchiveTabs from "../src/auto-archive-tabs.ts";
import * as BuildWeeklyDigest from "../src/build-weekly-digest.ts";
import * as DigestsRepo from "../src/digests-repo.ts";
import * as DigestTestLayer from "./digest-test-layer.ts";

// The cron jobs with two users (#177): each run is one user's, over that user's rows alone.

const asMember = Testing.as(Testing.member);
const url = (value: string) => Link.Url.make(value);
const openedAt = DateTime.makeUnsafe("2026-03-01T09:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

const report = (deviceId: Device.DeviceId, tabUrl: string) =>
  OpenTabsRepo.OpenTabsRepo.use((repo) =>
    repo.replace(deviceId, openedAt, [
      { url: url(tabUrl), title: "A synthetic tab", openedAt, lastSeenAt: openedAt },
    ]),
  );

const pendingUrls = (deviceId: Device.DeviceId) =>
  CommandsRepo.CommandsRepo.use((repo) => repo.listByDevice(deviceId, "pending")).pipe(
    Effect.map((commands) => commands.map((command) => command.payload.url)),
  );

const linkUrls = LinksRepo.LinksRepo.use((repo) => repo.list({ limit: 100 })).pipe(
  Effect.map((links) => links.map(({ link }) => link.url as string).sort()),
);

describe("cron jobs of two users", () => {
  it.effect("auto-archive closes and saves the tabs of the user it runs for, nobody else's", () =>
    Effect.gen(function* () {
      yield* report(DigestTestLayer.zen, "https://example.com/owner-old");
      yield* report(DigestTestLayer.memberZen, "https://example.com/member-old").pipe(asMember);
      yield* TestClock.setTime(DateTime.toEpochMillis(openedAt) + 31 * day);

      expect(yield* AutoArchiveTabs.autoArchiveTabs().pipe(asMember)).toBe(1);
      expect(yield* pendingUrls(DigestTestLayer.memberZen).pipe(asMember)).toEqual([
        "https://example.com/member-old",
      ]);
      expect(yield* linkUrls.pipe(asMember)).toEqual(["https://example.com/member-old"]);
      // The owner's tab is as old, and untouched until the owner's own run.
      expect(yield* pendingUrls(DigestTestLayer.zen)).toEqual([]);
      expect(yield* linkUrls).toEqual([]);

      expect(yield* AutoArchiveTabs.autoArchiveTabs()).toBe(1);
      expect(yield* linkUrls).toEqual(["https://example.com/owner-old"]);
      expect(yield* linkUrls.pipe(asMember)).toEqual(["https://example.com/member-old"]);
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );

  it.effect("each user's weekly digest counts their own links and is stored as theirs", () =>
    Effect.gen(function* () {
      const save = (value: string) =>
        LinksRepo.LinksRepo.use((links) =>
          links.insertAll([
            {
              id: Link.LinkId.make(value.slice(value.lastIndexOf("/") + 1)),
              url: url(value),
              canonicalUrl: url(value),
              title: `Synthetic ${value}`,
              tags: [],
              sourceDeviceId: null,
              createdAt: DateTime.makeUnsafe("2026-03-12T10:00:00.000Z"),
            },
          ]),
        );
      yield* save("https://example.com/owner-1");
      yield* save("https://example.com/owner-2");
      yield* save("https://example.com/member-1").pipe(asMember);
      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-16T06:00:00.000Z")),
      );

      const mine = yield* BuildWeeklyDigest.buildWeeklyDigest();
      const repo = yield* DigestsRepo.DigestsRepo;
      // Until their own run, the member has no digest: the owner's is not theirs.
      expect(yield* repo.latest.pipe(asMember)).toEqual(Option.none());
      const theirs = yield* BuildWeeklyDigest.buildWeeklyDigest().pipe(asMember);

      expect(JSON.stringify(mine)).toContain("owner-1");
      expect(JSON.stringify(mine)).not.toContain("member-1");
      expect(JSON.stringify(theirs)).toContain("member-1");
      expect(JSON.stringify(theirs)).not.toContain("owner-");
      // The same week for both: one row each, and each reads their own.
      expect(yield* repo.latest).toEqual(Option.some(mine));
      expect(yield* repo.latest.pipe(asMember)).toEqual(Option.some(theirs));
      // Building again replaces a user's own digest only.
      yield* BuildWeeklyDigest.buildWeeklyDigest().pipe(asMember);
      expect(yield* repo.latest).toEqual(Option.some(mine));
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );
});
