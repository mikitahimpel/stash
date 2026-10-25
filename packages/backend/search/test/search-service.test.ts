import { describe, expect, it } from "@effect/vitest";
import * as Tag from "@stash/contracts-domain/tag";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SearchService from "../src/search-service.ts";
import * as SearchTestLayer from "./search-test-layer.ts";

const search = (request: SearchService.SearchRequest) =>
  SearchService.SearchService.use((service) => service.search(request));
const ids = (results: {
  readonly hits: ReadonlyArray<{ readonly link: { readonly id: string } }>;
}) => results.hits.map((hit) => hit.link.id);

describe("SearchService", () => {
  it.effect("answers full links with sorted tags", () =>
    Effect.gen(function* () {
      const results = yield* search({ q: "explained", mode: "keyword" });
      expect(results.hits).toEqual([
        {
          link: {
            id: "link-econ-article",
            url: "https://example.com/link-econ-article",
            canonicalUrl: null,
            title: "Economics explained",
            status: "new",
            type: "article",
            summary: "An introduction to supply and demand.",
            language: null,
            tags: ["economics", "reading"],
            sourceDeviceId: null,
            createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
            enrichedAt: null,
          },
          score: expect.any(Number),
        },
      ]);
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("defaults to hybrid mode", () =>
    Effect.gen(function* () {
      const hybrid = yield* search({ q: "economics", mode: "hybrid" });
      expect(yield* search({ q: "economics" })).toEqual(hybrid);
      expect(ids(hybrid)).toEqual(["link-econ-article", "link-cooking", "link-econ-video"]);
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("routes each mode to its ranking", () =>
    Effect.gen(function* () {
      expect(ids(yield* search({ q: "economics", mode: "keyword" }))).toEqual([
        "link-econ-article",
        "link-cooking",
      ]);
      expect(ids(yield* search({ q: "inflation", mode: "keyword" }))).toEqual([]);
      expect(ids(yield* search({ q: "inflation", mode: "semantic" }))[0]).toBe("link-econ-video");
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("passes filters and the limit through", () =>
    Effect.gen(function* () {
      expect(
        ids(
          yield* search({
            q: "economics",
            filters: { tag: Tag.TagName.make("economics"), type: "video" },
          }),
        ),
      ).toEqual(["link-econ-video"]);
      expect(ids(yield* search({ q: "economics", limit: 1 }))).toEqual(["link-econ-article"]);
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );
});
