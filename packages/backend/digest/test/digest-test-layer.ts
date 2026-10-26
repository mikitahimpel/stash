import * as LinksRepo from "@stash/backend-links/links-repo";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as CommandsRepo from "@stash/backend-tabs/commands-repo";
import * as DevicesRepo from "@stash/backend-tabs/devices-repo";
import * as OpenTabsRepo from "@stash/backend-tabs/open-tabs-repo";
import type * as StashConfig from "@stash/backend-platform/stash-config";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DigestsRepo from "../src/digests-repo.ts";

// The tables this package reads and writes, copied from `apps/api/migrations/0001-initial-schema.sql`
// and `0002-devices-tabs-taken-at.sql` (the source of truth). Packages never reach into another
// package's files, so tests keep their own copy.
const schema = `
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('zen', 'ios', 'mac-agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  tabs_taken_at TEXT
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

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
) WITHOUT ROWID;

CREATE TABLE open_tabs (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  opened_at TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE digests (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  UNIQUE (period_start, period_end)
);
`;

/** Synthetic devices that exist in every test database. */
export const zen = Device.DeviceId.make("device-zen");
export const iphone = Device.DeviceId.make("device-iphone");

/** A fresh in-memory D1 with the tables and the synthetic devices. */
export const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.exec(schema);
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, name, kind) VALUES (${zen}, 'Synthetic Zen', 'zen')`,
      D1Database.sql`INSERT INTO devices (id, name, kind)
        VALUES (${iphone}, 'Synthetic iPhone', 'ios')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

/** The repos this package uses, over in-memory platform services. */
export const layer = (config: Partial<StashConfig.StashConfig["Service"]> = {}) =>
  Layer.mergeAll(
    DigestsRepo.layer,
    LinksRepo.layer,
    DevicesRepo.layer,
    OpenTabsRepo.layer,
    CommandsRepo.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        Testing.layerEnrichmentQueue,
        Testing.layerKv,
        Testing.layerStashConfig(config),
      ),
    ),
  );
