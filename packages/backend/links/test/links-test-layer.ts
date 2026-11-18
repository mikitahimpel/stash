import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import type * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LinksRepo from "../src/links-repo.ts";
import * as SaveRateLimiter from "../src/save/save-rate-limiter.ts";

// The tables this package reads, copied from `apps/api/migrations/0001-initial-schema.sql`,
// `0004-connect-status-and-pairings.sql` and `0009-link-post.sql` and `0010-link-updated-at.sql` (the source of truth). Packages never reach into another package's files, so tests keep their own copy.
const schema = `
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('zen', 'ios', 'mac-agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_save_at TEXT,
  last_save_link_id TEXT
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
  enriched_at TEXT,
  image_url TEXT,
  author TEXT,
  post TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX links_canonical_url_idx ON links (canonical_url);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
) WITHOUT ROWID;

CREATE TRIGGER links_touch_after_insert AFTER INSERT ON links BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE seq = new.seq;
END;

CREATE TRIGGER links_touch_after_update
AFTER UPDATE OF url, canonical_url, title, status, type, summary, language, source_device_id,
  enriched_at, image_url, author, post ON links BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE seq = new.seq;
END;

CREATE TRIGGER link_tags_touch_after_insert AFTER INSERT ON link_tags BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = new.link_id;
END;

CREATE TRIGGER link_tags_touch_after_delete AFTER DELETE ON link_tags BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = old.link_id;
END;
`;

/** A synthetic device that exists in every test database. */
export const deviceId = Device.DeviceId.make("device-zen-1");

export const device: Security.Principal = { kind: "device", deviceId };
export const user: Security.Principal = { kind: "user" };

/** A fresh in-memory D1 with the links tables and one device. */
export const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.exec(schema);
    yield* db.run(
      D1Database.sql`INSERT INTO devices (id, name, kind) VALUES (${deviceId}, ${"Synthetic Zen"}, ${"zen"})`,
    );
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

/**
 * The repo, the limiter and in-memory platform services, with the queue's consumer side and the
 * published link events.
 */
export const layer = (rateLimit: SaveRateLimiter.Options = SaveRateLimiter.defaultOptions) =>
  Layer.mergeAll(LinksRepo.layer, SaveRateLimiter.layer(rateLimit)).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        Testing.layerEnrichmentQueue,
        Testing.layerKv,
        Testing.layerLinkEvents,
      ),
    ),
  );
