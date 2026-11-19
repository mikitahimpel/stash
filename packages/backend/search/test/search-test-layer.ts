import * as Ai from "@stash/backend-platform/ai";
import * as D1Database from "@stash/backend-platform/d1-database";
import type * as Security from "@stash/contracts-api/security";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SearchRepo from "../src/search-repo.ts";
import * as SearchService from "../src/search-service.ts";

export interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly text?: string;
  readonly type?: "article" | "video" | "tool" | "repo" | "other";
  readonly status?: "new" | "seen" | "done" | "archived";
  readonly tags?: ReadonlyArray<string>;
  /** The device the link was saved from. */
  readonly deviceId?: string;
  /**
   * What the link's vector embeds (with `fakeEmbedding`). Defaults to title, summary and text. Set
   * it to model content that only Vectorize knows, such as a transcript kept in R2.
   */
  readonly embedded?: string;
  /** `false` leaves the link without a vector, as before enrichment. */
  readonly vector?: boolean;
}

/** Synthetic links. Every test database starts with them. */
export const fixtures: ReadonlyArray<Fixture> = [
  {
    id: "link-econ-article",
    title: "Economics explained",
    summary: "An introduction to supply and demand.",
    type: "article",
    tags: ["economics", "reading"],
  },
  {
    id: "link-econ-video",
    title: "Lecture 12",
    summary: "A recorded university lecture.",
    type: "video",
    status: "seen",
    tags: ["economics"],
    embedded: "Lecture 12 economics inflation money supply central banks",
  },
  {
    id: "link-cooking",
    title: "Pasta recipes",
    summary: "Weeknight dinners.",
    text: "Cooking pasta takes ten minutes. Some say economics of time matter.",
    type: "article",
    status: "archived",
    tags: ["cooking"],
  },
  {
    id: "link-repo",
    title: "Effect TypeScript library",
    summary: "Typed effects for TypeScript.",
    type: "repo",
    tags: ["typescript"],
    deviceId: "device-laptop",
  },
  {
    id: "link-unenriched",
    title: "Supply chains",
    vector: false,
  },
];

/**
 * A second user's links (`Testing.member`). They match the same queries as the owner's, in the
 * keyword index and in the vector index, so a search that leaks across users finds them.
 */
export const memberFixtures: ReadonlyArray<Fixture> = [
  {
    id: "member-econ",
    title: "Economics of inflation",
    summary: "Money supply, central banks and economics.",
    text: "Economics inflation money supply central banks pasta typescript.",
    type: "article",
    tags: ["economics"],
  },
  {
    id: "member-video",
    title: "Lecture 12 economics inflation",
    type: "video",
    status: "seen",
    tags: ["economics"],
  },
];

const insert = (userId: string, all: ReadonlyArray<Fixture>) =>
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const tagNames = [...new Set(all.flatMap((fixture) => fixture.tags ?? []))];
    yield* db.batch([
      ...tagNames.map((name) => D1Database.sql`INSERT OR IGNORE INTO tags (name) VALUES (${name})`),
      ...all.map(
        (f, index) =>
          D1Database.sql`INSERT INTO links (id, user_id, url, title, summary, text, type, status,
              source_device_id, created_at)
            VALUES (${f.id}, ${userId}, ${`https://example.com/${f.id}`}, ${f.title},
              ${f.summary ?? null}, ${f.text ?? null}, ${f.type ?? null}, ${f.status ?? "new"},
              ${f.deviceId ?? null}, ${`2026-01-0${index + 1}T00:00:00.000Z`})`,
      ),
      ...all.flatMap((f) =>
        (f.tags ?? []).map(
          (tag) =>
            D1Database.sql`INSERT INTO link_tags (link_id, tag_id, user_id)
              SELECT ${f.id}, id, ${userId} FROM tags WHERE name = ${tag}`,
        ),
      ),
    ]);
    // Stands in for the enrichment embedder (out of scope here): one vector per link, keyed by
    // id, with its user as metadata.
    const vectors = yield* Vectors.Vectors;
    yield* vectors.upsert(
      all
        .filter((f) => f.vector !== false)
        .map((f) => ({
          id: f.id,
          values: Testing.fakeEmbedding(
            f.embedded ?? [f.title, f.summary ?? "", f.text ?? ""].join(" "),
          ),
          metadata: { [Vectors.userIdKey]: userId },
        })),
    );
  });

const seed = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  yield* db.run(
    D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
      VALUES (${"device-laptop"}, ${Testing.owner.id}, ${"Synthetic laptop"}, ${"zen"})`,
  );
  yield* insert(Testing.owner.id, fixtures);
  yield* insert(Testing.member.id, memberFixtures);
}).pipe(Effect.orDie);

/**
 * Fresh D1 and Vectorize fakes with the owner's `fixtures` and the member's `memberFixtures`, plus
 * fake Workers AI. Everything runs as the owner unless a test says otherwise
 * (`Testing.as(Testing.member)`).
 */
export const layerPlatform: Layer.Layer<
  D1Database.Database | Vectors.Vectors | Ai.Ai | Security.CurrentUser
> = Layer.effectDiscard(seed).pipe(
  Layer.provideMerge(
    Layer.mergeAll(Testing.layerDatabase, Testing.layerVectors, Testing.layerCurrentUser()),
  ),
  Layer.provideMerge(Testing.layerAi()),
);

/** `SearchRepo` and the platform fakes. */
export const layerRepo = SearchRepo.layer.pipe(Layer.provideMerge(layerPlatform));

/** `SearchService` over `layerRepo`. */
export const layer = SearchService.layer.pipe(Layer.provideMerge(layerRepo));

/** Workers AI that always fails, as when the binding is missing or the model errors. */
export const layerAiDown: Layer.Layer<Ai.Ai> = Layer.succeed(Ai.Ai)({
  embed: () => Effect.fail(new Ai.AiError({ model: Ai.embeddingModel, cause: "unavailable" })),
});
