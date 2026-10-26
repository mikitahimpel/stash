import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveRateLimiter from "@stash/backend-links/save-rate-limiter";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as ContentHttp from "../src/content-http.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as EnrichmentRepo from "../src/enrichment-repo.ts";
import * as FakeHttp from "./fake-http.ts";
import * as FakeLanguageModel from "./fake-language-model.ts";

// The tables this package reads and writes, copied from `apps/api/migrations/` (0001 and 0002, the
// source of truth). Packages never reach into another package's files, so tests keep their own copy.
const schema = `
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('zen', 'ios', 'mac-agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

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
  source_device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  enriched_at TEXT
);

CREATE UNIQUE INDEX links_canonical_url_idx ON links (canonical_url);

ALTER TABLE links ADD COLUMN enrichment_error TEXT;

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

const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.exec(schema);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

/**
 * The links feature (to save links), the enrichment repo, and fakes for everything external: D1,
 * the queue (with its consumer side), R2, Vectorize, Workers AI, HTTP and the language model.
 */
export const layer = (
  routes: Readonly<Record<string, FakeHttp.Route>>,
  ...replies: ReadonlyArray<FakeLanguageModel.Reply>
) =>
  Layer.mergeAll(
    EnrichmentRepo.layer,
    LinksRepo.layer,
    SaveRateLimiter.layer(SaveRateLimiter.defaultOptions),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        Testing.layerEnrichmentQueue,
        Testing.layerKv,
        Testing.layerBlobs,
        Testing.layerVectors,
        Testing.layerAi(),
        FakeHttp.layer(routes),
        FakeLanguageModel.layer(...replies),
      ),
    ),
  );

/** Retries without delays, so tests of the retry paths run instantly. */
export const noDelays = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.provideService(EnrichPolicy.EnrichPolicy, {
      retrySchedule: Schedule.forever,
      retries: 2,
    }),
    Effect.provideService(ContentHttp.FetchPolicy, {
      ...ContentHttp.defaultPolicy,
      retrySchedule: Schedule.forever,
    }),
  );
