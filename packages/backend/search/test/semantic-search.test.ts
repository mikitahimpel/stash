import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Tag from "@stash/contracts-domain/tag";
import * as Effect from "effect/Effect";
import * as SemanticSearch from "../src/semantic-search.ts";
import * as SearchTestLayer from "./search-test-layer.ts";

const ids = (ranked: ReadonlyArray<{ readonly linkId: string }>) => ranked.map((r) => r.linkId);

describe("semanticSearch", () => {
  it.effect("finds links by their embedding when D1 text does not match", () =>
    Effect.gen(function* () {
      const ranked = yield* SemanticSearch.semanticSearch("inflation", {}, 10);
      expect(ranked[0]).toMatchObject({ linkId: "link-econ-video" });
      expect(ranked[0]!.score).toBeGreaterThan(0);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect(
    "orders by cosine similarity and skips unrelated links and links without a vector",
    () =>
      Effect.gen(function* () {
        const ranked = yield* SemanticSearch.semanticSearch("economics", {}, 10);
        // Both econ links share one of eight words with the query (a tie, broken by id), the
        // cooking link one of many more, and the repo none (dropped).
        expect(ids(ranked)).toEqual(["link-econ-article", "link-econ-video", "link-cooking"]);
        expect(ranked.map((r) => r.score)).toEqual(
          ranked.map((r) => r.score).sort((a, b) => b - a),
        );
        expect(ids(ranked)).not.toContain("link-unenriched");
        expect(yield* SemanticSearch.semanticSearch("nonexistentword", {}, 10)).toEqual([]);
      }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("drops vectors whose link no longer exists", () =>
    Effect.gen(function* () {
      yield* Vectors.Vectors.use((vectors) =>
        vectors.upsert([{ id: "link-deleted", values: Testing.fakeEmbedding("inflation") }]),
      );
      const ranked = yield* SemanticSearch.semanticSearch("inflation", {}, 10);
      expect(ids(ranked)).not.toContain("link-deleted");
      expect(ranked[0]).toMatchObject({ linkId: "link-econ-video" });
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("applies type, status and tag filters and the limit", () =>
    Effect.gen(function* () {
      expect(ids(yield* SemanticSearch.semanticSearch("economics", { type: "video" }, 10))).toEqual(
        ["link-econ-video"],
      );
      expect(
        ids(yield* SemanticSearch.semanticSearch("economics", { status: "archived" }, 10)),
      ).toEqual(["link-cooking"]);
      expect(
        ids(
          yield* SemanticSearch.semanticSearch(
            "economics",
            { tag: Tag.TagName.make("economics"), status: "seen" },
            10,
          ),
        ),
      ).toEqual(["link-econ-video"]);
      expect(ids(yield* SemanticSearch.semanticSearch("economics", {}, 2))).toEqual([
        "link-econ-article",
        "link-econ-video",
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("fails with AiError when Workers AI fails", () =>
    Effect.gen(function* () {
      const error = yield* SemanticSearch.semanticSearch("economics", {}, 10).pipe(Effect.flip);
      expect(error._tag).toBe("AiError");
    }).pipe(Effect.provide(SearchTestLayer.layerAiDown), Effect.provide(SearchTestLayer.layerRepo)),
  );
});
