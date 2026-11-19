import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Link from "@stash/contracts-domain/link";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as AiError from "effect/ai/AiError";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as EnrichLink from "../src/enrich-link.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as RequeuePending from "../src/requeue-pending.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeHttp from "./fake-http.ts";

const now = DateTime.makeUnsafe("2026-03-16T06:00:00.000Z");

const seed = D1Database.Database.use((db) =>
  db.batch([
    // Pending: saved long ago, never enriched (or reset by a migration).
    D1Database.sql`INSERT INTO links (user_id, id, url, created_at)
      VALUES ('owner', 'pending-1', 'https://example.com/1', '2026-03-10T00:00:00.000Z')`,
    D1Database.sql`INSERT INTO links (user_id, id, url, created_at)
      VALUES ('owner', 'pending-2', 'https://example.com/2', '2026-03-16T05:30:00.000Z')`,
    // Saved a minute ago: its first message is still on its way.
    D1Database.sql`INSERT INTO links (user_id, id, url, created_at)
      VALUES ('owner', 'fresh', 'https://example.com/3', '2026-03-16T05:59:00.000Z')`,
    D1Database.sql`INSERT INTO links (user_id, id, url, created_at, enriched_at)
      VALUES ('owner', 'enriched', 'https://example.com/4', '2026-03-10T00:00:00.000Z',
        '2026-03-10T00:01:00.000Z')`,
    D1Database.sql`INSERT INTO links (user_id, id, url, created_at, enrichment_error)
      VALUES ('owner', 'failed', 'https://example.com/5', '2026-03-10T00:00:00.000Z',
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

  it.effect("stops requeueing a link whose site always fails, and classifies it from its URL", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (user_id, id, url, created_at)
          VALUES ('owner', 'dead-site', 'https://example.com/dead', '2026-03-10T00:00:00.000Z')`),
      );
      const id = Link.LinkId.make("dead-site");
      const { maxRequeues } = EnrichPolicy.defaultPolicy;
      // Every hour but the last: requeued, fetched, failed, left pending.
      for (let hour = 1; hour < maxRequeues; hour++) {
        expect(yield* RequeuePending.requeuePending()).toBe(1);
        expect(yield* drained).toEqual([id]);
        const error = yield* EnrichLink.enrichLink(id).pipe(
          EnrichmentTestLayer.noDelays,
          Effect.flip,
        );
        expect(error._tag).toBe("ContentFetchError");
      }
      const fetches = (yield* FakeHttp.FakeHttp.use((http) => http.requests)).length;
      // The last requeue: no fetch, so the link is enriched from its URL and is done.
      expect(yield* RequeuePending.requeuePending()).toBe(1);
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "none" });
      expect((yield* FakeHttp.FakeHttp.use((http) => http.requests)).length).toBe(fetches);
      yield* drained;
      expect(yield* RequeuePending.requeuePending()).toBe(0);
      expect(yield* drained).toEqual([]);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { "https://example.com/dead": { status: 503 } },
          {
            tags: ["example"],
            summary: "",
            type: "other",
            language: "en",
          },
        ),
      ),
    ),
  );

  it.effect("stops requeueing a link that fails even without a fetch", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (user_id, id, url, created_at)
          VALUES ('owner', 'no-model', 'https://youtu.be/aaaaaaaaaaa', '2026-03-10T00:00:00.000Z')`),
      );
      const id = Link.LinkId.make("no-model");
      const { maxRequeues } = EnrichPolicy.defaultPolicy;
      for (let hour = 1; hour <= maxRequeues; hour++) {
        expect(yield* RequeuePending.requeuePending()).toBe(1);
        yield* EnrichLink.enrichLink(id).pipe(EnrichmentTestLayer.noDelays, Effect.flip);
      }
      yield* drained;
      // Still pending, and left alone from now on.
      expect(yield* RequeuePending.requeuePending()).toBe(0);
      expect(yield* drained).toEqual([]);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}, new AiError.RateLimitError({})))),
  );

  it.effect("a successful enrichment resets the count, so a later repair gets every attempt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (user_id, id, url, created_at, enrichment_attempts)
          VALUES ('owner', 'retried', 'https://youtu.be/aaaaaaaaaaa', '2026-03-10T00:00:00.000Z', 5)`),
      );
      const id = Link.LinkId.make("retried");
      // Past the cap there is no fetch, but a video still gets its thumbnail.
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "metadata" });
      const row = yield* D1Database.Database.use((db) =>
        db.first(D1Database.sql`SELECT image_url AS imageUrl, enrichment_attempts AS attempts
          FROM links WHERE id = ${id}`),
      );
      expect(Option.getOrThrow(row)).toEqual({
        imageUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
        attempts: 0,
      });
      expect(yield* FakeHttp.FakeHttp.use((http) => http.requests)).toEqual([]);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer({}, { tags: [], summary: "", type: "video", language: "en" }),
      ),
    ),
  );
});
