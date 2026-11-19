import * as SaveLink from "@stash/backend-links/save-link";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as AiQuota from "@stash/backend-users/ai-quota";
import * as Link from "@stash/contracts-domain/link";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as BackfillMetadata from "../src/backfill-metadata.ts";
import * as BackfillVectors from "../src/backfill-vectors.ts";
import type * as ClassifyLink from "../src/classify-link.ts";
import * as EnrichLink from "../src/enrich-link.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as EnrichmentRepo from "../src/enrichment-repo.ts";
import * as RequeuePending from "../src/requeue-pending.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as Fixtures from "./fixtures.ts";

// Enrichment with several users (#177): each link is enriched as its user, within that user's
// daily AI quota, and its vector and its event belong to that user alone. Synthetic data only.

const { owner, member, otherMember } = Testing;
const asMember = Testing.as(member);
const principal = { kind: "user" } as const;

const classification: ClassifyLink.ClassificationOutput = {
  tags: ["parsing"],
  summary: "A walk through a tiny HTML parser.",
  type: "article",
  language: "en",
};

const page = (n: number) => `https://example.com/page-${n}`;
const routes = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [page(i), { body: Fixtures.articlePage }]),
);
const layer = (replies = 6) =>
  EnrichmentTestLayer.layer(routes, ...Array.from({ length: replies }, () => classification));

const setQuota = (userId: string, value: number | null) =>
  D1Database.Database.use((db) =>
    db.run(D1Database.sql`UPDATE users SET daily_ai_quota = ${value} WHERE id = ${userId}`),
  );

const save = (n: number) =>
  SaveLink.saveLink(principal, { url: Link.Url.make(page(n)) }).pipe(
    Effect.map((saved) => saved.id),
  );

const drain = Testing.TestEnrichmentQueue.use((queue) => queue.drain).pipe(
  Effect.map((messages) => messages.map((message) => message.linkId)),
);

const state = (id: Link.LinkId) =>
  D1Database.Database.use((db) =>
    db.first(
      D1Database.sql`SELECT enriched_at AS enrichedAt, enrichment_attempts AS attempts,
        vector_version AS vectorVersion, summary FROM links WHERE id = ${id}`,
    ),
  ).pipe(Effect.map(Option.getOrThrow));

const usedToday = AiQuota.AiQuota.use((quota) => quota.usage).pipe(
  Effect.map((usage) => usage.usedToday),
);

describe("enrichment of several users", () => {
  it.effect("enriches up to the member's daily quota and defers the rest, losing nothing", () =>
    Effect.gen(function* () {
      yield* setQuota(member.id, 2);
      const ids = yield* Effect.forEach([0, 1, 2, 3], (n) => save(n).pipe(asMember));
      yield* drain;
      const outcomes = yield* Effect.forEach(ids, (id) =>
        EnrichLink.enrichLink(id).pipe(
          asMember,
          Effect.map((outcome) => outcome._tag),
        ),
      );
      expect(outcomes).toEqual(["Enriched", "Enriched", "Deferred", "Deferred"]);
      expect(yield* usedToday.pipe(asMember)).toBe(2);
      // The deferred links are stored, untouched and still pending: nothing was fetched for them.
      for (const id of ids.slice(2)) {
        expect(yield* state(id)).toEqual({
          enrichedAt: null,
          attempts: 0,
          vectorVersion: 0,
          summary: null,
        });
      }

      // The same day the hourly requeue sends nothing: the quota has no room.
      yield* TestClock.adjust("2 hours");
      expect(yield* RequeuePending.requeuePending().pipe(asMember)).toBe(0);
      expect(yield* drain).toEqual([]);

      // The next day it sends them, and they are enriched.
      yield* TestClock.adjust("24 hours");
      expect(yield* RequeuePending.requeuePending().pipe(asMember)).toBe(2);
      const requeued = yield* drain;
      expect([...requeued].sort()).toEqual([...ids.slice(2)].sort());
      for (const id of requeued) {
        expect((yield* EnrichLink.enrichLink(id).pipe(asMember))._tag).toBe("Enriched");
        expect((yield* state(id))["enrichedAt"]).not.toBeNull();
      }
    }).pipe(Effect.provide(layer())),
  );

  it.effect("the requeue takes no more links than the quota has room for", () =>
    Effect.gen(function* () {
      yield* setQuota(member.id, 3);
      const ids = yield* Effect.forEach([0, 1, 2, 3, 4], (n) => save(n).pipe(asMember));
      yield* drain;
      expect((yield* EnrichLink.enrichLink(ids[0]!).pipe(asMember))._tag).toBe("Enriched");
      yield* TestClock.adjust("1 hour");
      // 3 a day, 1 used: 2 are sent, and only those 2 count a requeue.
      expect(yield* RequeuePending.requeuePending().pipe(asMember)).toBe(2);
      expect(yield* drain).toHaveLength(2);
      const attempts = yield* Effect.forEach(ids.slice(1), (id) =>
        Effect.map(state(id), (row) => row["attempts"]),
      );
      expect([...attempts].sort()).toEqual([0, 0, 1, 1]);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("a deferral does not use up the link's requeues", () =>
    Effect.gen(function* () {
      yield* setQuota(member.id, 0);
      const id = yield* save(0).pipe(asMember);
      const repo = yield* EnrichmentRepo.EnrichmentRepo;
      yield* TestClock.adjust("1 hour");
      for (let i = 0; i < EnrichPolicy.defaultPolicy.maxRequeues + 3; i++) {
        // A message that was on its way when the quota ran out: taken, then deferred.
        yield* repo
          .takePending({
            before: DateTime.formatIso(yield* DateTime.now),
            limit: 10,
            maxRequeues: EnrichPolicy.defaultPolicy.maxRequeues,
          })
          .pipe(asMember);
        expect((yield* EnrichLink.enrichLink(id).pipe(asMember))._tag).toBe("Deferred");
      }
      expect((yield* state(id))["attempts"]).toBe(0);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("a run that fails gives its place in the quota back", () =>
    Effect.gen(function* () {
      yield* setQuota(member.id, 1);
      const id = yield* save(0).pipe(asMember);
      const down = Vectors.Vectors.of({
        ...(yield* Vectors.Vectors),
        upsert: () => Effect.fail(new Vectors.VectorsError({ operation: "upsert", cause: "down" })),
      });
      const error = yield* EnrichLink.enrichLink(id).pipe(
        asMember,
        Effect.provideService(Vectors.Vectors, down),
        EnrichmentTestLayer.noDelays,
        Effect.flip,
      );
      expect(error._tag).toBe("VectorsError");
      expect(yield* usedToday.pipe(asMember)).toBe(0);
      // So the delivery that follows still fits into the day.
      expect((yield* EnrichLink.enrichLink(id).pipe(asMember))._tag).toBe("Enriched");
      expect(yield* usedToday.pipe(asMember)).toBe(1);
      // A link enriched already is skipped and costs nothing.
      expect((yield* EnrichLink.enrichLink(id).pipe(asMember))._tag).toBe("Skipped");
      expect(yield* usedToday.pipe(asMember)).toBe(1);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("one user's quota does not hold another user's links back", () =>
    Effect.gen(function* () {
      yield* setQuota(member.id, 1);
      yield* setQuota(otherMember.id, 1);
      const first = yield* save(0).pipe(asMember);
      const second = yield* save(1).pipe(asMember);
      const others = yield* save(2).pipe(Testing.as(otherMember));
      const owners = yield* Effect.forEach([3, 4], (n) => save(n));
      expect((yield* EnrichLink.enrichLink(first).pipe(asMember))._tag).toBe("Enriched");
      expect((yield* EnrichLink.enrichLink(second).pipe(asMember))._tag).toBe("Deferred");
      expect((yield* EnrichLink.enrichLink(others).pipe(Testing.as(otherMember)))._tag).toBe(
        "Enriched",
      );
      // The owner has no cap.
      for (const id of owners) expect((yield* EnrichLink.enrichLink(id))._tag).toBe("Enriched");
      expect(yield* usedToday).toBe(2);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("a link is enriched as its user only: for anyone else it does not exist", () =>
    Effect.gen(function* () {
      const id = yield* save(0);
      yield* drain;
      expect(yield* EnrichLink.enrichLink(id).pipe(asMember)).toEqual({ _tag: "Missing" });
      expect(yield* BackfillMetadata.backfillMetadata(id).pipe(asMember)).toEqual({
        _tag: "Missing",
      });
      const repo = yield* EnrichmentRepo.EnrichmentRepo;
      yield* repo.markFailed(id, "not theirs to fail").pipe(asMember);
      expect((yield* state(id))["enrichedAt"]).toBeNull();
      expect(yield* usedToday.pipe(asMember)).toBe(0);
      // The consumer finds the link's user from the link itself.
      expect(yield* repo.ownerOf(id)).toEqual(Option.some(owner));
      expect(yield* repo.ownerOf(Link.LinkId.make("no-such-link"))).toEqual(Option.none());
      expect((yield* EnrichLink.enrichLink(id))._tag).toBe("Enriched");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("the vector and the event of an enrichment are its user's", () =>
    Effect.gen(function* () {
      const mine = yield* save(0);
      const theirs = yield* save(1).pipe(asMember);
      yield* EnrichLink.enrichLink(mine);
      yield* EnrichLink.enrichLink(theirs).pipe(asMember);

      const vectors = yield* Vectors.Vectors;
      const stored = yield* vectors.getByIds([mine, theirs]);
      expect(Object.fromEntries(stored.map((v) => [v.id, v.metadata]))).toEqual({
        [mine]: { userId: owner.id },
        [theirs]: { userId: member.id },
      });
      expect((yield* state(mine))["vectorVersion"]).toBe(EnrichPolicy.vectorVersion);

      const events = yield* Testing.TestLinkEvents;
      const toOwner = JSON.stringify(yield* events.publishedTo(owner.id));
      const toMember = JSON.stringify(yield* events.publishedTo(member.id));
      expect(toOwner).toContain(mine);
      expect(toOwner).not.toContain(theirs);
      expect(toMember).toContain(theirs);
      expect(toMember).not.toContain(mine);
    }).pipe(Effect.provide(layer())),
  );
});

describe("backfillVectors", () => {
  const insertOld = (userId: string, id: string, options: { readonly vector?: boolean } = {}) =>
    Effect.gen(function* () {
      const db = yield* D1Database.Database;
      yield* db.run(
        D1Database.sql`INSERT INTO links (id, user_id, url, enriched_at)
          VALUES (${id}, ${userId}, ${`https://example.com/${id}`}, ${"2026-01-01T00:00:00.000Z"})`,
      );
      if (options.vector !== false) {
        // As enrichment stored it before #177: no metadata.
        yield* Vectors.Vectors.use((vectors) =>
          vectors.upsert([{ id, values: Testing.fakeEmbedding(`text of ${id}`) }]),
        );
      }
    });

  const version = (id: string) =>
    Effect.map(state(Link.LinkId.make(id)), (row) => row["vectorVersion"]);

  const found = (userId: string, id: string) =>
    Vectors.Vectors.use((vectors) =>
      vectors.query(Testing.fakeEmbedding(`text of ${id}`), {
        topK: 20,
        filter: { [Vectors.userIdKey]: userId },
      }),
    ).pipe(Effect.map((matches) => matches.map((match) => match.id)));

  it.effect("writes each user's id onto their old vectors, same values, and stamps the links", () =>
    Effect.gen(function* () {
      yield* insertOld(owner.id, "old-a");
      yield* insertOld(owner.id, "old-b");
      yield* insertOld(member.id, "old-m");
      const vectors = yield* Vectors.Vectors;
      const before = yield* vectors.getByIds(["old-a"]);
      // Until the backfill, a filtered query finds none of them.
      expect(yield* found(owner.id, "old-a")).toEqual([]);

      expect(yield* BackfillVectors.backfillVectors()).toBe(2);
      expect(yield* found(owner.id, "old-a")).toContain("old-a");
      expect(yield* found(owner.id, "old-b")).toContain("old-b");
      expect((yield* vectors.getByIds(["old-a"]))[0]?.values).toEqual(before[0]?.values);
      expect(yield* version("old-a")).toBe(EnrichPolicy.vectorVersion);
      // The member's vector is not the owner's to write: it waits for the member's run.
      expect(yield* found(member.id, "old-m")).toEqual([]);
      expect(yield* found(owner.id, "old-m")).not.toContain("old-m");
      expect(yield* version("old-m")).toBe(0);
      expect(yield* BackfillVectors.backfillVectors().pipe(asMember)).toBe(1);
      expect(yield* found(member.id, "old-m")).toEqual(["old-m"]);

      // It ends: nothing is left for either.
      expect(yield* BackfillVectors.backfillVectors()).toBe(0);
      expect(yield* BackfillVectors.backfillVectors().pipe(asMember)).toBe(0);
    }).pipe(Effect.provide(layer(0))),
  );

  it.effect("takes `limit` links a run, in chunks, and stamps a link that has no vector", () =>
    Effect.gen(function* () {
      for (let i = 0; i < 7; i++) yield* insertOld(owner.id, `old-${i}`, { vector: i !== 3 });
      const options = { limit: 5, chunkSize: 2 };
      expect(yield* BackfillVectors.backfillVectors(options)).toBe(5);
      expect(yield* BackfillVectors.backfillVectors(options)).toBe(2);
      expect(yield* BackfillVectors.backfillVectors(options)).toBe(0);
      expect(yield* version("old-3")).toBe(EnrichPolicy.vectorVersion);
      expect(yield* Vectors.Vectors.use((vectors) => vectors.getByIds(["old-3"]))).toEqual([]);
      expect(yield* found(owner.id, "old-6")).toContain("old-6");
    }).pipe(Effect.provide(layer(0))),
  );

  it.effect("stamps nothing when Vectorize fails, so the next run does it again", () =>
    Effect.gen(function* () {
      yield* insertOld(owner.id, "old-a");
      const down = Vectors.Vectors.of({
        ...(yield* Vectors.Vectors),
        upsert: () => Effect.fail(new Vectors.VectorsError({ operation: "upsert", cause: "down" })),
      });
      const error = yield* BackfillVectors.backfillVectors().pipe(
        Effect.provideService(Vectors.Vectors, down),
        Effect.flip,
      );
      expect(error._tag).toBe("VectorsError");
      expect(yield* version("old-a")).toBe(0);
      expect(yield* BackfillVectors.backfillVectors()).toBe(1);
      expect(yield* found(owner.id, "old-a")).toEqual(["old-a"]);
    }).pipe(Effect.provide(layer(0))),
  );
});
