// Wiring tests for the enrichment consumer: the live `QueueHandler.layer` builds over the enrichment
// feature and in-memory platform layers, acks what it handled and retries transient failures. The
// pipeline itself is tested in `@stash/backend-enrichment`.
import * as ClassifyLink from "@stash/backend-enrichment/classify-link";
import * as EnrichmentRepo from "@stash/backend-enrichment/enrichment-repo";
import * as LinksRepo from "@stash/backend-links/links-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as AiQuota from "@stash/backend-users/ai-quota";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as QueueHandler from "../src/queue-handler.ts";

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.batch([
      D1Database.sql`INSERT INTO links (id, user_id, url)
        VALUES ('link-1', ${Testing.owner.id}, 'https://example.com/a')`,
      D1Database.sql`INSERT INTO links (id, user_id, url)
        VALUES ('link-member', ${Testing.member.id}, 'https://example.com/a')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerDatabase));

/** Pages are never fetched for real: every request fails with a 404. */
const layerNotFound = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 404 }))),
  ),
);

// Without an Anthropic key, as under `alchemy dev`.
const layer = QueueHandler.layer.pipe(
  Layer.provide(Layer.mergeAll(EnrichmentRepo.layer, LinksRepo.layer, AiQuota.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      Testing.layerLinkEvents,
      ClassifyLink.layerMissingKey,
      Testing.layerBlobs,
      Testing.layerVectors,
      Testing.layerAi(),
      layerNotFound,
    ),
  ),
);

const message = (id: string, body: unknown) => {
  const settled: Array<"ack" | "retry"> = [];
  return {
    settled,
    message: {
      id,
      body,
      ack: () => void settled.push("ack"),
      retry: () => void settled.push("retry"),
    },
  };
};

describe("QueueHandler.layer", () => {
  it.effect("acks a deleted link and retries transient failures and malformed bodies", () =>
    Effect.gen(function* () {
      const deleted = message("m1", { linkId: "link-deleted" });
      const missingKey = message("m2", { linkId: "link-1" });
      const malformed = message("m3", { nope: true });
      yield* QueueHandler.handleBatch([deleted.message, missingKey.message, malformed.message]);
      expect(deleted.settled).toEqual(["ack"]);
      expect(missingKey.settled).toEqual(["retry"]);
      expect(malformed.settled).toEqual(["retry"]);

      // A missing key is not the link's fault: it stays unmarked for the next delivery.
      const row = yield* D1Database.Database.use((db) =>
        db.first(D1Database.sql`SELECT enriched_at AS enrichedAt,
          enrichment_error AS enrichmentError FROM links WHERE id = 'link-1'`),
      );
      expect(row).toMatchObject({ value: { enrichedAt: null, enrichmentError: null } });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("runs only the metadata backfill for a message with task metadata", () =>
    Effect.gen(function* () {
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (id, user_id, url, title, enriched_at)
          VALUES ('link-video', ${Testing.member.id}, 'https://youtu.be/aaaaaaaaaaa', 'A synthetic video',
            '2026-03-10T00:01:00.000Z')`),
      );
      // The classifier has no key here, so a full enrichment would fail and be retried.
      const backfill = message("m1", { linkId: "link-video", task: "metadata" });
      yield* QueueHandler.handleBatch([backfill.message]);
      expect(backfill.settled).toEqual(["ack"]);
      const row = yield* D1Database.Database.use((db) =>
        db.first(D1Database.sql`SELECT title, image_url AS imageUrl,
          metadata_version AS metadataVersion FROM links WHERE id = 'link-video'`),
      );
      expect(row).toMatchObject({
        value: {
          title: "A synthetic video",
          imageUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
          metadataVersion: 1,
        },
      });
      // The filled thumbnail reaches the live stream of the link's user, as one `link.updated`,
      // and nobody else's: the consumer found the user from the link.
      const stream = yield* Testing.TestLinkEvents;
      expect(yield* stream.publishedTo(Testing.owner.id)).toEqual([]);
      const events = yield* stream.publishedTo(Testing.member.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "link.updated",
        link: { id: "link-video", imageUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" },
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("acks a link over its user's daily AI quota and leaves it pending", () =>
    Effect.gen(function* () {
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE users SET daily_ai_quota = 0 WHERE id = ${Testing.member.id}`),
      );
      const deferred = message("m1", { linkId: "link-member" });
      // The owner's link is not held back by the member's quota: it gets as far as the missing key.
      const owners = message("m2", { linkId: "link-1" });
      yield* QueueHandler.handleBatch([deferred.message, owners.message]);
      expect(deferred.settled).toEqual(["ack"]);
      expect(owners.settled).toEqual(["retry"]);
      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT id, enriched_at AS enrichedAt, enrichment_error AS error
          FROM links ORDER BY id`),
      );
      expect(rows).toEqual([
        { id: "link-1", enrichedAt: null, error: null },
        { id: "link-member", enrichedAt: null, error: null },
      ]);
      expect(
        yield* D1Database.Database.use((db) =>
          db.all(D1Database.sql`SELECT * FROM ai_usage
        WHERE links > 0`),
        ),
      ).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );
});
