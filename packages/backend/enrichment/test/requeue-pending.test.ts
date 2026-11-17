import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as RequeuePending from "../src/requeue-pending.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";

const now = DateTime.makeUnsafe("2026-03-16T06:00:00.000Z");

const seed = D1Database.Database.use((db) =>
  db.batch([
    // Pending: saved long ago, never enriched (or reset by a migration).
    D1Database.sql`INSERT INTO links (id, url, created_at)
      VALUES ('pending-1', 'https://example.com/1', '2026-03-10T00:00:00.000Z')`,
    D1Database.sql`INSERT INTO links (id, url, created_at)
      VALUES ('pending-2', 'https://example.com/2', '2026-03-16T05:30:00.000Z')`,
    // Saved a minute ago: its first message is still on its way.
    D1Database.sql`INSERT INTO links (id, url, created_at)
      VALUES ('fresh', 'https://example.com/3', '2026-03-16T05:59:00.000Z')`,
    D1Database.sql`INSERT INTO links (id, url, created_at, enriched_at)
      VALUES ('enriched', 'https://example.com/4', '2026-03-10T00:00:00.000Z',
        '2026-03-10T00:01:00.000Z')`,
    D1Database.sql`INSERT INTO links (id, url, created_at, enrichment_error)
      VALUES ('failed', 'https://example.com/5', '2026-03-10T00:00:00.000Z',
        'classify: ContentPolicyError')`,
  ]),
);

const drained = Testing.TestEnrichmentQueue.use((queue) => queue.drain).pipe(
  Effect.map((messages) => messages.map((message) => message.linkId).sort()),
);

describe("requeuePending", () => {
  it.effect("enqueues links that are neither enriched nor failed, except fresh ones", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      yield* seed;
      expect(yield* RequeuePending.requeuePending()).toBe(2);
      expect(yield* drained).toEqual(["pending-1", "pending-2"]);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}))),
  );

  it.effect("sends at most `limit` messages a run", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      yield* seed;
      expect(yield* RequeuePending.requeuePending({ minAge: "15 minutes", limit: 1 })).toBe(1);
      expect(yield* drained).toHaveLength(1);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}))),
  );

  it.effect("sends nothing when no link is pending", () =>
    Effect.gen(function* () {
      expect(yield* RequeuePending.requeuePending()).toBe(0);
      expect(yield* drained).toEqual([]);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}))),
  );
});
