import * as Ai from "@stash/backend-platform/ai";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SearchRepo from "../src/search-repo.ts";
import * as SearchService from "../src/search-service.ts";

// The tables this package reads, copied from `apps/api/migrations/0001-initial-schema.sql` (the
// source of truth). Packages never reach into another package's files, so tests keep their own copy.
// `source_device_id` loses its foreign key: no test needs devices.
const schema = `
CREATE TABLE links (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'done', 'archived')),
  type TEXT,
  summary TEXT,
  language TEXT,
  text TEXT,
  source_device_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  enriched_at TEXT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE links_fts USING fts5 (
  title,
  summary,
  text,
  content = 'links',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER links_fts_after_insert AFTER INSERT ON links BEGIN
  INSERT INTO links_fts (rowid, title, summary, text)
  VALUES (new.seq, new.title, new.summary, new.text);
END;

CREATE TRIGGER links_fts_after_delete AFTER DELETE ON links BEGIN
  INSERT INTO links_fts (links_fts, rowid, title, summary, text)
  VALUES ('delete', old.seq, old.title, old.summary, old.text);
END;

CREATE TRIGGER links_fts_after_update AFTER UPDATE OF seq, title, summary, text ON links BEGIN
  INSERT INTO links_fts (links_fts, rowid, title, summary, text)
  VALUES ('delete', old.seq, old.title, old.summary, old.text);
  INSERT INTO links_fts (rowid, title, summary, text)
  VALUES (new.seq, new.title, new.summary, new.text);
END;
`;

export interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly text?: string;
  readonly type?: "article" | "video" | "tool" | "repo" | "other";
  readonly status?: "new" | "seen" | "done" | "archived";
  readonly tags?: ReadonlyArray<string>;
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
  },
  {
    id: "link-unenriched",
    title: "Supply chains",
    vector: false,
  },
];

const seed = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  yield* db.exec(schema);
  const tagNames = [...new Set(fixtures.flatMap((fixture) => fixture.tags ?? []))];
  yield* db.batch([
    ...tagNames.map((name) => D1Database.sql`INSERT INTO tags (name) VALUES (${name})`),
    ...fixtures.map(
      (f, index) =>
        D1Database.sql`INSERT INTO links (id, url, title, summary, text, type, status, created_at)
          VALUES (${f.id}, ${`https://example.com/${f.id}`}, ${f.title}, ${f.summary ?? null},
            ${f.text ?? null}, ${f.type ?? null}, ${f.status ?? "new"},
            ${`2026-01-0${index + 1}T00:00:00.000Z`})`,
    ),
    ...fixtures.flatMap((f) =>
      (f.tags ?? []).map(
        (tag) =>
          D1Database.sql`INSERT INTO link_tags (link_id, tag_id)
            SELECT ${f.id}, id FROM tags WHERE name = ${tag}`,
      ),
    ),
  ]);
  // Stands in for the enrichment embedder (out of scope here): one vector per link, keyed by id.
  const vectors = yield* Vectors.Vectors;
  yield* vectors.upsert(
    fixtures
      .filter((f) => f.vector !== false)
      .map((f) => ({
        id: f.id,
        values: Testing.fakeEmbedding(
          f.embedded ?? [f.title, f.summary ?? "", f.text ?? ""].join(" "),
        ),
      })),
  );
}).pipe(Effect.orDie);

/** Fresh D1 (with `fixtures`) and Vectorize fakes, plus fake Workers AI. */
export const layerPlatform: Layer.Layer<D1Database.Database | Vectors.Vectors | Ai.Ai> =
  Layer.effectDiscard(seed).pipe(
    Layer.provideMerge(Layer.mergeAll(Testing.layerD1Database, Testing.layerVectors)),
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
