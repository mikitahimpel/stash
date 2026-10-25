import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ai from "../src/ai.ts";
import * as Testing from "../src/testing.ts";

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

describe("Ai (fake)", () => {
  it.effect("returns deterministic, normalized embeddings", () =>
    Effect.gen(function* () {
      const ai = yield* Ai.Ai;
      const [a, b, c] = yield* ai.embed([
        "video about economics",
        "Economics video",
        "rust compiler internals",
      ]);
      expect(a).toHaveLength(Ai.embeddingDimensions);
      expect(yield* ai.embed(["video about economics"])).toEqual([a]);
      expect(cosine(a!, a!)).toBeCloseTo(1);
      expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
      expect(yield* ai.embed([])).toEqual([]);
    }).pipe(Effect.provide(Testing.layerAi())),
  );

  it.effect("can use a smaller dimension and handles empty text", () =>
    Effect.gen(function* () {
      const ai = yield* Ai.Ai;
      const [empty] = yield* ai.embed([""]);
      expect(empty).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    }).pipe(Effect.provide(Testing.layerAi({ dimensions: 8 }))),
  );
});

describe("Ai (live)", () => {
  it.effect("calls the embedding model and validates its output", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const ai = Ai.make({
        run: async (model, inputs) => {
          calls.push({ model, inputs });
          return { shape: [inputs.text.length, 2], data: inputs.text.map(() => [0.1, 0.2]) };
        },
      });
      expect(yield* ai.embed(["a", "b"])).toEqual([
        [0.1, 0.2],
        [0.1, 0.2],
      ]);
      expect(calls).toEqual([{ model: "@cf/baai/bge-m3", inputs: { text: ["a", "b"] } }]);

      const malformed = Ai.make({ run: async () => ({ request_id: "async" }) });
      expect(yield* Effect.flip(malformed.embed(["a"]))).toBeInstanceOf(Ai.AiError);
      const short = Ai.make({ run: async () => ({ data: [] }) });
      expect(yield* Effect.flip(short.embed(["a"]))).toBeInstanceOf(Ai.AiError);
      const failing = Ai.make({ run: () => Promise.reject(new Error("ai down")) });
      expect(yield* Effect.flip(failing.embed(["a"]))).toMatchObject({
        _tag: "AiError",
        model: Ai.embeddingModel,
      });
    }),
  );
});
