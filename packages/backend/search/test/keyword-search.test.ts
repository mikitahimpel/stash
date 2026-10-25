import { describe, expect, it } from "@effect/vitest";
import * as Tag from "@stash/contracts-domain/tag";
import * as Effect from "effect/Effect";
import * as KeywordSearch from "../src/keyword-search.ts";
import * as SearchTestLayer from "./search-test-layer.ts";

const ids = (ranked: ReadonlyArray<{ readonly linkId: string }>) => ranked.map((r) => r.linkId);

describe("toFtsQuery", () => {
  it("quotes every word as an OR-ed prefix term", () => {
    expect(KeywordSearch.toFtsQuery("Supply  Demand")).toBe(`"supply"* OR "demand"*`);
  });

  it("turns FTS5 syntax into plain words", () => {
    expect(KeywordSearch.toFtsQuery(`econ" OR title:* NEAR(x`)).toBe(
      `"econ"* OR "or"* OR "title"* OR "near"* OR "x"*`,
    );
  });

  it("keeps Cyrillic and accented words", () => {
    expect(KeywordSearch.toFtsQuery("экономика café")).toBe(`"экономика"* OR "café"*`);
  });

  it("is empty when there are no words", () => {
    expect(KeywordSearch.toFtsQuery(" !?* ")).toBe("");
  });
});

describe("keywordSearch", () => {
  it.effect("ranks title matches above text-only matches", () =>
    Effect.gen(function* () {
      const ranked = yield* KeywordSearch.keywordSearch("economics", {}, 10);
      expect(ids(ranked)).toEqual(["link-econ-article", "link-cooking"]);
      expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("matches word prefixes and ranks links matching more words first", () =>
    Effect.gen(function* () {
      expect(ids(yield* KeywordSearch.keywordSearch("econ", {}, 10))).toEqual([
        "link-econ-article",
        "link-cooking",
      ]);
      expect(ids(yield* KeywordSearch.keywordSearch("supply demand", {}, 10))).toEqual([
        "link-econ-article",
        "link-unenriched",
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("survives FTS5 syntax in the query and answers nothing for no words", () =>
    Effect.gen(function* () {
      expect(ids(yield* KeywordSearch.keywordSearch(`pasta" NEAR (`, {}, 10))).toEqual([
        "link-cooking",
      ]);
      expect(yield* KeywordSearch.keywordSearch("***", {}, 10)).toEqual([]);
      expect(yield* KeywordSearch.keywordSearch("nonexistentword", {}, 10)).toEqual([]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("applies type, status and tag filters and the limit", () =>
    Effect.gen(function* () {
      expect(ids(yield* KeywordSearch.keywordSearch("economics", { status: "new" }, 10))).toEqual([
        "link-econ-article",
      ]);
      expect(
        ids(yield* KeywordSearch.keywordSearch("economics", { status: "archived" }, 10)),
      ).toEqual(["link-cooking"]);
      expect(
        ids(
          yield* KeywordSearch.keywordSearch("economics", { tag: Tag.TagName.make("cooking") }, 10),
        ),
      ).toEqual(["link-cooking"]);
      expect(yield* KeywordSearch.keywordSearch("economics", { type: "video" }, 10)).toEqual([]);
      expect(ids(yield* KeywordSearch.keywordSearch("economics", {}, 1))).toEqual([
        "link-econ-article",
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );
});
