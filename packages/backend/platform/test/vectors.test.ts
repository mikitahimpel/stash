import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Testing from "../src/testing.ts";
import * as Vectors from "../src/vectors.ts";

describe("Vectors (in memory)", () => {
  it.effect("upserts and ranks by cosine similarity", () =>
    Effect.gen(function* () {
      const vectors = yield* Vectors.Vectors;
      yield* vectors.upsert([
        { id: "a", values: [1, 0, 0], metadata: { type: "video" } },
        { id: "b", values: [0.7, 0.7, 0], metadata: { type: "article" } },
        { id: "c", values: [0, 0, 1], metadata: { type: "video" } },
      ]);
      const matches = yield* vectors.query([1, 0, 0]);
      expect(matches.map((m) => m.id)).toEqual(["a", "b", "c"]);
      expect(matches[0]?.score).toBeCloseTo(1);
      expect(matches[2]?.score).toBeCloseTo(0);
      expect(matches[0]?.metadata).toEqual({ type: "video" });

      expect((yield* vectors.query([1, 0, 0], { topK: 1 })).map((m) => m.id)).toEqual(["a"]);
      const videos = yield* vectors.query([0.7, 0.7, 0], { filter: { type: "video" } });
      expect(videos.map((m) => m.id)).toEqual(["a", "c"]);

      // Upsert replaces.
      yield* vectors.upsert([{ id: "c", values: [1, 0, 0] }]);
      expect((yield* vectors.query([1, 0, 0], { topK: 2 })).map((m) => m.id)).toEqual(["a", "c"]);

      yield* vectors.deleteByIds(["a", "c"]);
      expect((yield* vectors.query([1, 0, 0])).map((m) => m.id)).toEqual(["b"]);
    }).pipe(Effect.provide(Testing.layerVectors)),
  );

  it.effect("rejects mismatched dimensions", () =>
    Effect.gen(function* () {
      const vectors = yield* Vectors.Vectors;
      yield* vectors.upsert([{ id: "a", values: [1, 0] }]);
      const error = yield* Effect.flip(vectors.query([1, 0, 0]));
      expect(error).toBeInstanceOf(Vectors.VectorsError);
      expect(error.operation).toBe("query");
    }).pipe(Effect.provide(Testing.layerVectors)),
  );
});

describe("Vectors (live)", () => {
  it.effect("passes options to Vectorize and keeps only scalar metadata", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const vectors = Vectors.make({
        upsert: async (input) => void calls.push(input),
        query: async (vector, options) => {
          calls.push({ vector, options });
          return { matches: [{ id: "a", score: 0.5, metadata: { type: "video", tags: ["x"] } }] };
        },
        deleteByIds: async (ids) => void calls.push(ids),
      });
      yield* vectors.upsert([{ id: "a", values: [1, 2] }]);
      const matches = yield* vectors.query([1, 2], { filter: { type: "video" } });
      yield* vectors.deleteByIds(["a"]);
      expect(matches).toEqual([{ id: "a", score: 0.5, metadata: { type: "video" } }]);
      expect(calls).toEqual([
        [{ id: "a", values: [1, 2] }],
        { vector: [1, 2], options: { topK: 10, returnMetadata: "all", filter: { type: "video" } } },
        ["a"],
      ]);
    }),
  );
});
