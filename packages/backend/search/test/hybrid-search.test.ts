import { describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as HybridSearch from "../src/hybrid-search.ts";
import * as SearchTestLayer from "./search-test-layer.ts";

const ids = (ranked: ReadonlyArray<{ readonly linkId: string }>) => ranked.map((r) => r.linkId);
const ranking = (...linkIds: ReadonlyArray<string>) =>
  linkIds.map((id, index) => ({ linkId: Link.LinkId.make(id), score: 100 - index }));

describe("fuse", () => {
  it("sums 1 / (k + rank) over the rankings", () => {
    const fused = HybridSearch.fuse([ranking("a", "b"), ranking("b", "c")], 60);
    expect(fused).toEqual([
      { linkId: "b", score: 1 / 62 + 1 / 61 },
      { linkId: "a", score: 1 / 61 },
      { linkId: "c", score: 1 / 62 },
    ]);
  });

  it("ranks a link found by both sides above links found by one", () => {
    const fused = HybridSearch.fuse([ranking("x", "y", "both"), ranking("z", "w", "both")]);
    expect(ids(fused)[0]).toBe("both");
  });

  it("ignores raw scores and breaks ties by id", () => {
    const keyword = [{ linkId: Link.LinkId.make("k"), score: 1e9 }];
    const semantic = [{ linkId: Link.LinkId.make("s"), score: 0.01 }];
    expect(ids(HybridSearch.fuse([semantic, keyword]))).toEqual(["k", "s"]);
    expect(HybridSearch.fuse([])).toEqual([]);
  });
});

describe("hybridSearch", () => {
  it.effect("fuses keyword and semantic rankings", () =>
    Effect.gen(function* () {
      // keyword: article, cooking. semantic: article, video, cooking.
      expect(ids(yield* HybridSearch.hybridSearch("economics", {}, 10))).toEqual([
        "link-econ-article",
        "link-cooking",
        "link-econ-video",
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("finds semantic-only and keyword-only links", () =>
    Effect.gen(function* () {
      expect(ids(yield* HybridSearch.hybridSearch("inflation", {}, 10))[0]).toBe("link-econ-video");
      // Not embedded yet, so only keyword search finds it.
      expect(ids(yield* HybridSearch.hybridSearch("chains", {}, 10))[0]).toBe("link-unenriched");
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("applies filters to both sides and the limit to the fused result", () =>
    Effect.gen(function* () {
      expect(ids(yield* HybridSearch.hybridSearch("economics", { type: "article" }, 10))).toEqual([
        "link-econ-article",
        "link-cooking",
      ]);
      expect(ids(yield* HybridSearch.hybridSearch("economics", { status: "seen" }, 10))).toEqual([
        "link-econ-video",
      ]);
      expect(ids(yield* HybridSearch.hybridSearch("economics", {}, 2))).toEqual([
        "link-econ-article",
        "link-cooking",
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("falls back to keyword results when the semantic side fails", () =>
    Effect.gen(function* () {
      expect(ids(yield* HybridSearch.hybridSearch("economics", {}, 10))).toEqual([
        "link-econ-article",
        "link-cooking",
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layerAiDown), Effect.provide(SearchTestLayer.layerRepo)),
  );
});
