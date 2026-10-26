import { describe, expect, it } from "@effect/vitest";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as BuildWeeklyDigest from "../src/build-weekly-digest.ts";
import * as DigestsRepo from "../src/digests-repo.ts";
import * as DigestTestLayer from "./digest-test-layer.ts";

// The cron runs on Monday 2026-03-16 at 06:00 UTC, so the period is the week before: from Monday
// 2026-03-09 00:00 (inclusive) to Monday 2026-03-16 00:00 (exclusive).
const runAt = DateTime.makeUnsafe("2026-03-16T06:00:00.000Z");

interface Seed {
  readonly name: string;
  readonly createdAt: string;
  readonly status?: Link.LinkStatus;
  readonly type?: Link.LinkType;
  readonly tags?: ReadonlyArray<string>;
  readonly summary?: string;
}

/** Inserts synthetic links, then sets what enrichment and the user would set. */
const seed = (links: ReadonlyArray<Seed>) =>
  Effect.gen(function* () {
    const repo = yield* LinksRepo.LinksRepo;
    const db = yield* D1Database.Database;
    for (const link of links) {
      const id = Link.LinkId.make(`link-${link.name}`);
      const linkUrl = Link.Url.make(`https://example.com/${link.name}`);
      yield* repo.insertAll([
        {
          id,
          url: linkUrl,
          canonicalUrl: linkUrl,
          title: `Synthetic ${link.name}`,
          tags: (link.tags ?? []).map((tag) => Tag.TagName.make(tag)),
          sourceDeviceId: null,
          createdAt: DateTime.makeUnsafe(link.createdAt),
        },
      ]);
      yield* repo.update(id, {
        ...(link.status === undefined ? {} : { status: link.status }),
        ...(link.type === undefined ? {} : { type: link.type }),
      });
      if (link.summary !== undefined) {
        yield* db.run(D1Database.sql`UPDATE links SET summary = ${link.summary} WHERE id = ${id}`);
      }
    }
  });

const week: ReadonlyArray<Seed> = [
  // Before the period: left out.
  { name: "too-old", createdAt: "2026-03-08T23:59:59.999Z", type: "video", tags: ["economics"] },
  // The first instant of the period.
  {
    name: "monday",
    createdAt: "2026-03-09T00:00:00.000Z",
    type: "article",
    tags: ["economics", "history"],
    status: "seen",
  },
  {
    name: "tuesday",
    createdAt: "2026-03-10T12:00:00.000Z",
    type: "article",
    tags: ["economics"],
    summary: "An invented summary",
  },
  { name: "wednesday", createdAt: "2026-03-11T08:00:00.000Z", type: "video", status: "done" },
  { name: "thursday", createdAt: "2026-03-12T08:00:00.000Z", tags: ["history", "tools"] },
  {
    name: "friday",
    createdAt: "2026-03-13T08:00:00.000Z",
    type: "repo",
    tags: ["tools"],
    status: "archived",
  },
  { name: "sunday", createdAt: "2026-03-15T23:59:59.999Z", type: "article" },
  // The end of the period is exclusive: next week's digest counts it.
  { name: "next-monday", createdAt: "2026-03-16T00:00:00.000Z", type: "tool", tags: ["tools"] },
];

const highlightNames = (digest: { readonly highlights: ReadonlyArray<{ readonly url: string }> }) =>
  digest.highlights.map((highlight) => highlight.url.replace("https://example.com/", ""));

describe("buildWeeklyDigest", () => {
  it.effect("groups the links of the last 7 days by status, tag and type", () =>
    Effect.gen(function* () {
      yield* seed(week);
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      const digest = yield* BuildWeeklyDigest.buildWeeklyDigest();

      expect(DateTime.formatIso(digest.periodStart)).toBe("2026-03-09T00:00:00.000Z");
      expect(DateTime.formatIso(digest.periodEnd)).toBe("2026-03-16T00:00:00.000Z");
      expect(DateTime.formatIso(digest.generatedAt)).toBe("2026-03-16T06:00:00.000Z");
      expect(digest.totals).toEqual({ saved: 6, seen: 1, done: 1, archived: 1 });
      expect(digest.topTags).toEqual([
        { name: "economics", count: 2 },
        { name: "history", count: 2 },
        { name: "tools", count: 2 },
      ]);
      expect(digest.topTypes).toEqual([
        { type: "article", count: 3 },
        { type: "repo", count: 1 },
        { type: "video", count: 1 },
      ]);
      // Unread with a summary, then unread newest first, then read; archived links never.
      expect(highlightNames(digest)).toEqual([
        "tuesday",
        "sunday",
        "thursday",
        "wednesday",
        "monday",
      ]);
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );

  it.effect("reads every page of a busy week", () =>
    Effect.gen(function* () {
      yield* seed(
        Array.from({ length: 250 }, (_, i) => ({
          name: `busy-${i}`,
          createdAt: DateTime.formatIso(
            DateTime.add(DateTime.makeUnsafe("2026-03-09T00:00:00.000Z"), { minutes: i }),
          ),
          tags: [`tag-${i % 12}`],
        })),
      );
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      const digest = yield* BuildWeeklyDigest.buildWeeklyDigest();
      expect(digest.totals.saved).toBe(250);
      expect(digest.topTags).toHaveLength(BuildWeeklyDigest.topTagsLimit);
      expect(digest.highlights).toHaveLength(BuildWeeklyDigest.highlightsLimit);
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );

  it.effect("stores the digest and replaces it when rebuilt the same day", () =>
    Effect.gen(function* () {
      const repo = yield* DigestsRepo.DigestsRepo;
      expect(Option.isNone(yield* repo.latest)).toBe(true);

      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      const empty = yield* BuildWeeklyDigest.buildWeeklyDigest();
      expect(empty.totals).toEqual({ saved: 0, seen: 0, done: 0, archived: 0 });
      expect(yield* repo.latest).toEqual(Option.some(empty));

      yield* seed(week);
      yield* TestClock.adjust("1 hour");
      const rebuilt = yield* BuildWeeklyDigest.buildWeeklyDigest();
      expect(yield* repo.latest).toEqual(Option.some(rebuilt));
      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.statement("SELECT period_start AS periodStart FROM digests")),
      );
      expect(rows).toEqual([{ periodStart: "2026-03-09T00:00:00.000Z" }]);

      // A week later the new digest is the latest.
      yield* TestClock.adjust("7 days");
      const next = yield* BuildWeeklyDigest.buildWeeklyDigest();
      expect(DateTime.formatIso(next.periodStart)).toBe("2026-03-16T00:00:00.000Z");
      expect(next.totals.saved).toBe(1);
      expect(yield* repo.latest).toEqual(Option.some(next));
    }).pipe(Effect.provide(DigestTestLayer.layer())),
  );
});
