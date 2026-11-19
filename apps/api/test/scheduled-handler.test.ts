// Wiring tests for the cron entry: the live `ScheduledHandler.layer` builds over the digest, tabs
// and links repos and in-memory platform layers, and each cron expression runs its job. The jobs
// themselves are tested in `@stash/backend-digest`.
import * as DigestsRepo from "@stash/backend-digest/digests-repo";
import * as EnrichmentRepo from "@stash/backend-enrichment/enrichment-repo";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as DevicesRepo from "@stash/backend-tabs/devices-repo";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import * as AiQuota from "@stash/backend-users/ai-quota";
import * as UsersRepo from "@stash/backend-users/users-repo";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as ScheduledHandler from "../src/scheduled-handler.ts";

// Two users, each with a Zen device with one tab opened long ago, and one link saved in the week
// before the run.
const seedUser = (user: { readonly id: string }, n: number) => [
  D1Database.sql`INSERT INTO devices (id, user_id, name, kind, tabs_taken_at)
    VALUES (${`device-${n}`}, ${user.id}, 'Synthetic Zen', 'zen', '2026-01-01T00:00:00.000Z')`,
  D1Database.sql`INSERT INTO open_tabs (user_id, device_id, url, title, opened_at, last_seen_at)
    VALUES (${user.id}, ${`device-${n}`}, ${`https://example.com/stale-${n}`}, 'Stale tab',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  D1Database.sql`INSERT INTO links (id, user_id, url, canonical_url, type, created_at)
    VALUES (${`link-${n}`}, ${user.id}, 'https://example.com/a', 'https://example.com/a',
      'article', '2026-03-10T00:00:00.000Z')`,
];

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.batch([...seedUser(Testing.owner, 1), ...seedUser(Testing.member, 2)]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerDatabase));

const layer = ScheduledHandler.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      OpenTabsRepo.layer,
      CommandsRepo.layer,
      DevicesRepo.layer,
      LinksRepo.layer,
      DigestsRepo.layer,
      EnrichmentRepo.layer,
      UsersRepo.layer,
      AiQuota.layer,
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      Testing.layerEnrichmentQueue,
      Testing.layerKv,
      Testing.layerLinkEvents,
      Testing.layerVectors,
      Testing.layerStashConfig(),
    ),
  ),
);

const rows = (sql: string) => D1Database.Database.use((db) => db.all(D1Database.statement(sql)));

const count = (table: string) =>
  D1Database.Database.use((db) =>
    db.all(D1Database.statement(`SELECT COUNT(*) AS n FROM ${table}`)),
  ).pipe(Effect.map((rows) => rows[0]?.["n"]));

const runAt = DateTime.makeUnsafe("2026-03-16T06:00:00.000Z");

describe("handleScheduled", () => {
  it.effect("runs the auto-archive job on its cron, for every user as that user", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.autoArchiveCron);
      // Each user's stale tab is closed on their own device and saved into their own links.
      expect(yield* rows("SELECT user_id, device_id FROM commands ORDER BY device_id")).toEqual([
        { user_id: Testing.owner.id, device_id: "device-1" },
        { user_id: Testing.member.id, device_id: "device-2" },
      ]);
      expect(
        yield* rows("SELECT user_id, url FROM links WHERE status = 'archived' ORDER BY url"),
      ).toEqual([
        { user_id: Testing.owner.id, url: "https://example.com/stale-1" },
        { user_id: Testing.member.id, url: "https://example.com/stale-2" },
      ]);
      expect(yield* count("digests")).toBe(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("runs the weekly digest job on its cron: one digest per user, of their own links", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.weeklyDigestCron);
      const digests = yield* rows("SELECT user_id, content FROM digests ORDER BY user_id");
      // A user with no links still gets theirs (an empty week).
      expect(digests.map((row) => row["user_id"])).toEqual(
        [Testing.owner.id, Testing.member.id, Testing.otherMember.id].sort(),
      );
      const of = (userId: string) =>
        String(digests.find((row) => row["user_id"] === userId)?.["content"]);
      expect(of(Testing.owner.id)).toContain("link-1");
      expect(of(Testing.owner.id)).not.toContain("link-2");
      expect(of(Testing.member.id)).toContain("link-2");
      expect(of(Testing.member.id)).not.toContain("link-1");
      expect(yield* count("commands")).toBe(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("requeues every user's links still waiting for enrichment on its cron", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.requeuePendingCron);
      const messages = yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain);
      expect(messages).toEqual([{ linkId: "link-1" }, { linkId: "link-2" }]);
      expect(yield* count("commands")).toBe(0);
      expect(yield* count("digests")).toBe(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("requeues within each user's own daily AI quota", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      // The member has used up today: their link waits, the owner's is sent.
      yield* D1Database.Database.use((db) =>
        db.batch([
          D1Database.sql`UPDATE users SET daily_ai_quota = 1 WHERE id = ${Testing.member.id}`,
          D1Database.sql`INSERT INTO ai_usage (user_id, day, links)
            VALUES (${Testing.member.id}, '2026-03-16', 1)`,
        ]),
      );
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.requeuePendingCron);
      expect(yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain)).toEqual([
        { linkId: "link-1" },
      ]);
      // The next day it goes.
      yield* TestClock.adjust("24 hours");
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.requeuePendingCron);
      expect(yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain)).toContainEqual({
        linkId: "link-2",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("queues a metadata backfill for an enriched link without image or author", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (id, user_id, url, canonical_url, type, created_at,
            enriched_at, vector_version)
          VALUES ('link-old', ${Testing.member.id}, 'https://example.com/old',
            'https://example.com/old', 'article', '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:01:00.000Z', 1)`),
      );
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.requeuePendingCron);
      const messages = yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain);
      expect(messages).toEqual([
        { linkId: "link-1" },
        { linkId: "link-2" },
        { linkId: "link-old", task: "metadata" },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("writes each user's id onto the vectors stored before there were users", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      const vectors = yield* Vectors.Vectors;
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE links SET enriched_at = '2026-03-10T00:01:00.000Z'`),
      );
      yield* vectors.upsert([
        { id: "link-1", values: [1, 0] },
        { id: "link-2", values: [1, 0] },
      ]);
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.requeuePendingCron);
      const stored = yield* vectors.getByIds(["link-1", "link-2"]);
      expect(Object.fromEntries(stored.map((vector) => [vector.id, vector.metadata]))).toEqual({
        "link-1": { userId: Testing.owner.id },
        "link-2": { userId: Testing.member.id },
      });
      expect(yield* rows("SELECT DISTINCT vector_version AS v FROM links")).toEqual([{ v: 1 }]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a user whose run fails does not stop the others", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      // The owner's digest cannot be stored (the first user of the run); the member's still is.
      yield* D1Database.Database.use((db) =>
        db.exec(`CREATE TRIGGER digests_fail_for_owner BEFORE INSERT ON digests
          WHEN new.user_id = 'owner' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`),
      );
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.weeklyDigestCron);
      const users = (yield* rows("SELECT user_id FROM digests")).map((row) => row["user_id"]);
      expect(users).not.toContain(Testing.owner.id);
      expect(users).toContain(Testing.member.id);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("does nothing for an unknown cron", () =>
    Effect.gen(function* () {
      yield* ScheduledHandler.handleScheduled("*/5 * * * *");
      expect(yield* count("commands")).toBe(0);
      expect(yield* count("digests")).toBe(0);
    }).pipe(Effect.provide(layer)),
  );
});
