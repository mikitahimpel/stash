// Wiring tests for the enrichment consumer: the live `QueueHandler.layer` builds over the enrichment
// feature and in-memory platform layers, acks what it handled and retries transient failures. The
// pipeline itself is tested in `@stash/backend-enrichment`.
import * as ClassifyLink from "@stash/backend-enrichment/classify-link";
import * as EnrichmentRepo from "@stash/backend-enrichment/enrichment-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Fs from "node:fs";
import * as Path from "node:path";
import * as QueueHandler from "../src/queue-handler.ts";

const migrationsDir = Path.resolve(import.meta.dirname, "../migrations");
const migrations = Fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => Fs.readFileSync(Path.join(migrationsDir, name), "utf8"));

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    for (const migration of migrations) yield* db.exec(migration);
    yield* db.run(
      D1Database.sql`INSERT INTO links (id, url) VALUES ('link-1', 'https://example.com/a')`,
    );
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

/** Pages are never fetched for real: every request fails with a 404. */
const layerNotFound = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 404 }))),
  ),
);

// Without an Anthropic key, as under `alchemy dev`.
const layer = QueueHandler.layer.pipe(
  Layer.provide(EnrichmentRepo.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
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
});
