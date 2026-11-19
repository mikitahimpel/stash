import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Effect from "effect/Effect";
import * as SearchService from "../src/search-service.ts";
import * as SemanticSearch from "../src/semantic-search.ts";
import * as SearchTestLayer from "./search-test-layer.ts";

// Two users (#177): the owner's `fixtures` and the member's `memberFixtures` match the same
// words. No mode of search may answer one user with a link of the other.

const ownerIds = new Set(SearchTestLayer.fixtures.map((fixture) => fixture.id));
const memberIds = new Set(SearchTestLayer.memberFixtures.map((fixture) => fixture.id));
const asMember = Testing.as(Testing.member);

const search = (q: string, mode: "keyword" | "semantic" | "hybrid") =>
  SearchService.SearchService.use((service) => service.search({ q, mode, limit: 50 })).pipe(
    Effect.map((results) => results.hits.map((hit) => hit.link.id as string)),
  );

const queries = ["economics", "inflation", "lecture", "pasta", "typescript", "supply"];

describe("search of two users", () => {
  it.effect.each(["keyword", "semantic", "hybrid"] as const)(
    "%s search answers each user with their own links only",
    (mode) =>
      Effect.gen(function* () {
        let ownerHits = 0;
        let memberHits = 0;
        for (const q of queries) {
          const mine = yield* search(q, mode);
          expect(mine.filter((id) => !ownerIds.has(id))).toEqual([]);
          ownerHits += mine.length;
          const theirs = yield* search(q, mode).pipe(asMember);
          expect(theirs.filter((id) => !memberIds.has(id))).toEqual([]);
          memberHits += theirs.length;
        }
        // Both users do find their own links: the scoping is not an empty answer.
        expect(ownerHits).toBeGreaterThan(0);
        expect(memberHits).toBeGreaterThan(0);
      }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("a user with no links finds nothing", () =>
    Effect.gen(function* () {
      for (const q of queries) {
        expect(yield* search(q, "hybrid").pipe(Testing.as(Testing.otherMember))).toEqual([]);
      }
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("asks the vector index for the searcher's vectors only", () =>
    Effect.gen(function* () {
      const filters: Array<unknown> = [];
      const vectors = yield* Vectors.Vectors;
      const recording = Vectors.Vectors.of({
        ...vectors,
        query: (vector, options) => {
          filters.push(options?.filter);
          return vectors.query(vector, options);
        },
      });
      yield* SemanticSearch.semanticSearch("economics", {}, 10).pipe(
        asMember,
        Effect.provideService(Vectors.Vectors, recording),
      );
      expect(filters).toEqual([{ [Vectors.userIdKey]: Testing.member.id }]);
    }).pipe(Effect.provide(SearchTestLayer.layerRepo)),
  );

  it.effect("a vector that claims the wrong user still surfaces nothing of another user", () =>
    Effect.gen(function* () {
      // The index says the owner's link is the member's (stale or wrong metadata). D1 decides.
      yield* Vectors.Vectors.use((vectors) =>
        vectors.upsert([
          {
            id: "link-econ-article",
            values: Testing.fakeEmbedding("economics"),
            metadata: { [Vectors.userIdKey]: Testing.member.id },
          },
        ]),
      );
      const theirs = yield* search("economics", "semantic").pipe(asMember);
      expect(theirs).not.toContain("link-econ-article");
      expect(theirs.filter((id) => !memberIds.has(id))).toEqual([]);
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("a vector without the user metadata is not found until it is written again", () =>
    Effect.gen(function* () {
      // As the vectors stored before #177 are, until the backfill reaches them.
      yield* Vectors.Vectors.use((vectors) =>
        vectors.upsert([{ id: "link-econ-video", values: Testing.fakeEmbedding("inflation") }]),
      );
      expect(yield* search("inflation", "semantic")).not.toContain("link-econ-video");
      // Keyword search does not depend on it.
      expect(yield* search("lecture", "keyword")).toContain("link-econ-video");
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );

  it.effect("the keyword index carries each link's user", () =>
    Effect.gen(function* () {
      const db = yield* D1Database.Database;
      const rows = yield* db.all(
        D1Database.sql`SELECT l.id AS id, links_fts.user_id AS ftsUser, l.user_id AS linkUser
          FROM links_fts JOIN links l ON l.seq = links_fts.rowid
          WHERE links_fts MATCH ${"economics"}`,
      );
      expect(rows.length).toBeGreaterThan(2);
      for (const row of rows) expect(row["ftsUser"]).toBe(row["linkUser"]);
    }).pipe(Effect.provide(SearchTestLayer.layer)),
  );
});
