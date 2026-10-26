import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveRateLimiter from "@stash/backend-links/save-rate-limiter";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import type * as Security from "@stash/contracts-api/security";
import * as Device from "@stash/contracts-domain/device";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CommandsRepo from "../src/commands/commands-repo.ts";
import * as DevicesRepo from "../src/devices/devices-repo.ts";
import * as OpenTabsRepo from "../src/snapshots/open-tabs-repo.ts";

// The tables this package reads, copied from `apps/api/migrations/0001-initial-schema.sql` and
// `0002-devices-tabs-taken-at.sql` (the source of truth). Packages never reach into another
// package's files, so tests keep their own copy. `archive` saves through `@stash/backend-links`,
// so the links tables are here too.
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
`;

/** Synthetic devices that exist in every test database, oldest first. */
export const zenA = Device.DeviceId.make("device-zen-a");
export const zenB = Device.DeviceId.make("device-zen-b");
export const macAgent = Device.DeviceId.make("device-mac-agent");
export const iphone = Device.DeviceId.make("device-iphone");

export const asDevice = (deviceId: Device.DeviceId): Security.Principal => ({
  kind: "device",
  deviceId,
});
export const user: Security.Principal = { kind: "user" };

/** A fresh in-memory D1 with the tables and the synthetic devices. */
export const layerDatabase: Layer.Layer<D1Database.Database> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    yield* db.exec(schema);
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, name, kind, created_at)
        VALUES (${zenA}, 'Synthetic Zen A', 'zen', '2026-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO devices (id, name, kind, created_at)
        VALUES (${zenB}, 'Synthetic Zen B', 'zen', '2026-01-01T00:00:01.000Z')`,
      D1Database.sql`INSERT INTO devices (id, name, kind, created_at)
        VALUES (${macAgent}, 'Synthetic Mac', 'mac-agent', '2026-01-01T00:00:02.000Z')`,
      D1Database.sql`INSERT INTO devices (id, name, kind, created_at)
        VALUES (${iphone}, 'Synthetic iPhone', 'ios', '2026-01-01T00:00:03.000Z')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

/** The repos of this package and of links, over in-memory platform services. */
export const layer = Layer.mergeAll(
  DevicesRepo.layer,
  OpenTabsRepo.layer,
  CommandsRepo.layer,
  LinksRepo.layer,
  SaveRateLimiter.layer(),
).pipe(
  Layer.provideMerge(Layer.mergeAll(layerDatabase, Testing.layerEnrichmentQueue, Testing.layerKv)),
);
