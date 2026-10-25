-- Initial D1 schema for Stash. See "Data model" in docs/architecture.md.
--
-- Conventions:
-- - Ids are opaque TEXT (the branded ids in @stash/contracts-domain), except `links.seq`, `tags.id`
--   and `open_tabs.id`, which are internal integer keys.
-- - Timestamps are UTC ISO 8601 TEXT (`2026-01-02T03:04:05.678Z`), so they sort as text and decode
--   with Schema.DateTimeUtcFromString.
-- - Closed lifecycle enums have CHECK constraints. Open-ended ones (`links.type`, `commands.kind`)
--   are validated by the contracts schemas, so adding a value needs no table rebuild.
-- - D1 enforces foreign keys.

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('zen', 'ios', 'mac-agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- `seq` is the stable integer rowid that the external-content FTS table points at. The public id
-- is `id`.
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
  -- Plain page text (or transcript excerpt) for keyword search. The full text lives in R2.
  text TEXT,
  source_device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  enriched_at TEXT
);

-- One link per canonical URL. Several links may still have no canonical URL yet (NULLs are distinct).
CREATE UNIQUE INDEX links_canonical_url_idx ON links (canonical_url);
CREATE INDEX links_status_created_at_idx ON links (status, created_at);
CREATE INDEX links_created_at_idx ON links (created_at);
CREATE INDEX links_source_device_id_idx ON links (source_device_id);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX link_tags_tag_id_idx ON link_tags (tag_id);

-- The tabs open on a device, as of its last snapshot. A snapshot replaces all rows of its device.
CREATE TABLE open_tabs (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  opened_at TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX open_tabs_device_id_idx ON open_tabs (device_id);
CREATE INDEX open_tabs_opened_at_idx ON open_tabs (opened_at);

-- `payload` is the JSON of the contracts CommandPayload union, discriminated by `kind`.
CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE INDEX commands_device_id_status_idx ON commands (device_id, status);

-- Per-device API tokens. Only the hash of a token is stored.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

CREATE INDEX api_tokens_device_id_idx ON api_tokens (device_id);

-- Web login sessions (GitHub OAuth). `id` is the hash of the session token, never the token.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Generated digests. `content` is the JSON of the contracts Digest (totals, top tags, highlights).
CREATE TABLE digests (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  UNIQUE (period_start, period_end)
);

-- Keyword search over links. External content: the index reads rows from `links` and the triggers
-- below keep it in sync. `remove_diacritics 2` folds accents; unicode61 handles Cyrillic and Latin.
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
