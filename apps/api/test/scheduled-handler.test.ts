// Wiring tests for the cron entry: the live `ScheduledHandler.layer` builds over the digest, tabs
// and links repos and in-memory platform layers, and each cron expression runs its job. The jobs
// themselves are tested in `@stash/backend-digest`.
import * as DigestsRepo from "@stash/backend-digest/digests-repo";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as DevicesRepo from "@stash/backend-tabs/devices-repo";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as Fs from "node:fs";
import * as Path from "node:path";
import * as ScheduledHandler from "../src/scheduled-handler.ts";

const migrationsDir = Path.resolve(import.meta.dirname, "../migrations");
const migrations = Fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => Fs.readFileSync(Path.join(migrationsDir, name), "utf8"));

// A Zen device with one tab opened long ago, and one link saved in the week before the run.
const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    for (const migration of migrations) yield* db.exec(migration);
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, name, kind, tabs_taken_at)
        VALUES ('device-1', 'Synthetic Zen', 'zen', '2026-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO open_tabs (device_id, url, title, opened_at, last_seen_at)
        VALUES ('device-1', 'https://example.com/stale', 'Stale tab', '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO links (id, url, canonical_url, type, created_at)
        VALUES ('link-1', 'https://example.com/a', 'https://example.com/a', 'article',
          '2026-03-10T00:00:00.000Z')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

const layer = ScheduledHandler.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      OpenTabsRepo.layer,
      CommandsRepo.layer,
      DevicesRepo.layer,
      LinksRepo.layer,
      DigestsRepo.layer,
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      Testing.layerEnrichmentQueue,
      Testing.layerKv,
      Testing.layerStashConfig(),
    ),
  ),
);

const count = (table: string) =>
  D1Database.Database.use((db) =>
    db.all(D1Database.statement(`SELECT COUNT(*) AS n FROM ${table}`)),
  ).pipe(Effect.map((rows) => rows[0]?.["n"]));

const runAt = DateTime.makeUnsafe("2026-03-16T06:00:00.000Z");

describe("handleScheduled", () => {
  it.effect("runs the auto-archive job on its cron", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.autoArchiveCron);
      expect(yield* count("commands")).toBe(1);
      expect(yield* count("digests")).toBe(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("runs the weekly digest job on its cron", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(runAt));
      yield* ScheduledHandler.handleScheduled(ScheduledHandler.weeklyDigestCron);
      expect(yield* count("digests")).toBe(1);
      expect(yield* count("commands")).toBe(0);
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
