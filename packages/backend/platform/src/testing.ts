import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Ai from "./ai.ts";
import * as Blobs from "./blobs.ts";
import * as D1Database from "./d1-database.ts";
import * as EnrichmentQueue from "./enrichment-queue.ts";
import * as Kv from "./kv.ts";
import type * as Live from "./live.ts";
import * as SqliteD1 from "./sqlite-d1.ts";
import * as StashConfig from "./stash-config.ts";
import * as Vectors from "./vectors.ts";

// In-memory layers for every service in `./live`. Each build starts from empty state, so a test
// that provides a layer gets its own database, queue, index and stores. These layers run on Node
// (`node:sqlite`), so a test tsconfig that imports this module needs `@types/node`.

/** A fresh in-memory SQLite database behind the real `Database` service. Closed with the scope. */
export const layerD1Database: Layer.Layer<D1Database.Database> = Layer.effect(D1Database.Database)(
  Effect.map(
    Effect.acquireRelease(Effect.sync(SqliteD1.make), (d1) => Effect.sync(() => d1.close())),
    D1Database.make,
  ),
);

/** Test controls for the in-memory `EnrichmentQueue`: the consumer side. */
export class TestEnrichmentQueue extends Context.Service<
  TestEnrichmentQueue,
  {
    /** The oldest unreceived message. Waits until one is sent. */
    readonly receive: Effect.Effect<EnrichmentQueue.EnrichmentMessage>;
    /** Every unreceived message, oldest first, without waiting. */
    readonly drain: Effect.Effect<ReadonlyArray<EnrichmentQueue.EnrichmentMessage>>;
  }
>()("@stash/backend-platform/TestEnrichmentQueue") {}

/** Messages go through their encoded form, as on the real queue. */
export const layerEnrichmentQueue: Layer.Layer<
  EnrichmentQueue.EnrichmentQueue | TestEnrichmentQueue
> = Layer.effectContext(
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<typeof EnrichmentQueue.EnrichmentMessage.Encoded>();
    const decode = Schema.decodeSync(EnrichmentQueue.EnrichmentMessage);
    const binding: EnrichmentQueue.QueueBinding = {
      send: async (message) => Queue.offerUnsafe(queue, structuredClone(message)),
      sendBatch: async (messages) => {
        for (const { body } of messages) Queue.offerUnsafe(queue, structuredClone(body));
      },
    };
    return Context.make(EnrichmentQueue.EnrichmentQueue, EnrichmentQueue.make(binding)).pipe(
      Context.add(TestEnrichmentQueue, {
        receive: Effect.map(Queue.take(queue), decode),
        drain: Effect.map(Queue.clear(queue), (messages) =>
          messages.map((message) => decode(message)),
        ),
      }),
    );
  }),
);

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
};

const matchesFilter = (metadata: Vectors.Metadata, filter: Vectors.Metadata | undefined) =>
  filter === undefined || Object.entries(filter).every(([key, value]) => metadata[key] === value);

/**
 * An in-memory cosine index. Like Vectorize, it rejects vectors whose dimensions differ from the
 * first one stored.
 */
export const layerVectors: Layer.Layer<Vectors.Vectors> = Layer.sync(Vectors.Vectors)(() => {
  const store = new Map<string, { values: Array<number>; metadata: Vectors.Metadata }>();
  const dimensions = () => store.values().next().value?.values.length;
  const checkDimensions = (length: number) => {
    const expected = dimensions();
    if (expected !== undefined && expected !== length) {
      throw new RangeError(`expected ${expected} dimensions, got ${length}`);
    }
  };
  return Vectors.make({
    upsert: async (vectors) => {
      for (const vector of vectors) checkDimensions(vector.values.length);
      for (const { id, values, metadata } of vectors)
        store.set(id, { values, metadata: metadata ?? {} });
    },
    query: async (vector, { topK, filter }) => {
      checkDimensions(vector.length);
      const matches = [...store.entries()]
        .filter(([, entry]) => matchesFilter(entry.metadata, filter))
        .map(([id, entry]) => ({
          id,
          score: cosine(vector, entry.values),
          metadata: entry.metadata,
        }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, topK);
      return { matches };
    },
    deleteByIds: async (ids) => {
      for (const id of ids) store.delete(id);
    },
  });
});

/** An in-memory bucket. */
export const layerBlobs: Layer.Layer<Blobs.Blobs> = Layer.sync(Blobs.Blobs)(() => {
  const store = new Map<string, Blobs.Blob>();
  const encoder = new TextEncoder();
  return Blobs.withText({
    put: (key, body, options = {}) =>
      Effect.sync(() => {
        store.set(key, {
          bytes: typeof body === "string" ? encoder.encode(body) : body.slice(),
          contentType: Option.fromNullishOr(options.contentType),
        });
      }),
    get: (key) => Effect.sync(() => Option.fromNullishOr(store.get(key))),
    delete: (key) => Effect.sync(() => void store.delete(key)),
  });
});

/** An in-memory namespace. `expirationTtl` follows the Effect `Clock`, so `TestClock` drives it. */
export const layerKv: Layer.Layer<Kv.Kv> = Layer.sync(Kv.Kv)(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    get: (key) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const entry = store.get(key);
        if (entry === undefined) return Option.none();
        if (entry.expiresAt <= now) {
          store.delete(key);
          return Option.none();
        }
        return Option.some(entry.value);
      }),
    put: (key, value, options = {}) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const ttl = options.expirationTtl;
        store.set(key, { value, expiresAt: ttl === undefined ? Infinity : now + ttl * 1000 });
      }),
    delete: (key) => Effect.sync(() => void store.delete(key)),
  };
});

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * A deterministic stand-in for a real embedding: a normalized bag of hashed lowercase words. Texts
 * that share words score higher under cosine, so search ranking can be tested.
 */
export const fakeEmbedding = (
  text: string,
  dimensions: number = Ai.embeddingDimensions,
): Ai.Embedding => {
  const vector = Array.from({ length: dimensions }, () => 0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    const index = fnv1a(word) % dimensions;
    vector[index] = (vector[index] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  // An empty text still gets a unit vector, so cosine stays defined.
  return norm === 0 ? vector.map((_, i) => (i === 0 ? 1 : 0)) : vector.map((x) => x / norm);
};

/** Workers AI that answers with `fakeEmbedding`. */
export const layerAi = (options: { readonly dimensions?: number } = {}): Layer.Layer<Ai.Ai> =>
  Layer.succeed(Ai.Ai)({
    embed: (texts) => Effect.succeed(texts.map((text) => fakeEmbedding(text, options.dimensions))),
  });

/** Synthetic config. Override any field. */
export const layerStashConfig = (
  overrides: Partial<StashConfig.StashConfig["Service"]> = {},
): Layer.Layer<StashConfig.StashConfig> =>
  Layer.succeed(StashConfig.StashConfig)({
    allowedGithubLogin: "example-user",
    webOrigin: "https://example.com",
    archiveAfterDays: StashConfig.defaultArchiveAfterDays,
    ...overrides,
  });

/** Every service from `./live`, in memory, plus the queue's consumer side. */
export const layer: Layer.Layer<Live.Services | TestEnrichmentQueue> = Layer.mergeAll(
  layerD1Database,
  layerEnrichmentQueue,
  layerVectors,
  layerBlobs,
  layerKv,
  layerAi(),
  layerStashConfig(),
);
