// The D1 schema as the migrations in `apps/api/migrations` leave it, for tests: the statements
// SQLite keeps for the migrated database, in the order they were created. Packages never reach
// into another package's files, so this is a copy; `apps/api/test/d1-schema.test.ts` fails when
// it differs from the migrations and prints the text to paste here.

/** Every table, index and trigger. Run it on an empty database. */
export const schema = `
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('zen', 'ios', 'mac-agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, tabs_taken_at TEXT, last_save_at TEXT, last_save_link_id TEXT, user_id TEXT REFERENCES users (id) ON DELETE CASCADE, tabs_window_start INTEGER, tabs_window_count INTEGER NOT NULL DEFAULT 0);

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
, enrichment_error TEXT, image_url TEXT, enrichment_attempts INTEGER NOT NULL DEFAULT 0, author TEXT, metadata_version INTEGER NOT NULL DEFAULT 0, post TEXT, updated_at TEXT, user_id TEXT REFERENCES users (id) ON DELETE CASCADE, vector_version INTEGER NOT NULL DEFAULT 0);

CREATE INDEX links_source_device_id_idx ON links (source_device_id);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE, user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX link_tags_tag_id_idx ON link_tags (tag_id);

CREATE TABLE open_tabs (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  opened_at TEXT,
  last_seen_at TEXT NOT NULL
, user_id TEXT REFERENCES users (id) ON DELETE CASCADE, last_active_at TEXT, window_id TEXT, window_name TEXT, favicon_url TEXT);

CREATE INDEX open_tabs_device_id_idx ON open_tabs (device_id);

CREATE INDEX open_tabs_opened_at_idx ON open_tabs (opened_at);

CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
, user_id TEXT REFERENCES users (id) ON DELETE CASCADE);

CREATE INDEX commands_device_id_status_idx ON commands (device_id, status);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
, user_id TEXT REFERENCES users (id) ON DELETE CASCADE, method TEXT NOT NULL DEFAULT 'github'
  CHECK (method IN ('github', 'passkey', 'google')));

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE "device_pairings" (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT
, user_id TEXT REFERENCES users (id) ON DELETE CASCADE);

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

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  -- Links a day (UTC) that AI may enrich. NULL is no cap.
  daily_ai_quota INTEGER CHECK (daily_ai_quota IS NULL OR daily_ai_quota >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX users_one_owner_idx ON users (role) WHERE role = 'owner';

CREATE TABLE user_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- What the provider calls the account (a GitHub login), to show. Never used to match.
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, subject)
) WITHOUT ROWID;

CREATE INDEX user_identities_user_id_idx ON user_identities (user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  links INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

CREATE TRIGGER devices_user_required_insert BEFORE INSERT ON devices
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'devices.user_id is required');
END;

CREATE TRIGGER devices_user_required_update BEFORE UPDATE OF user_id ON devices
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'devices.user_id is required');
END;

CREATE INDEX devices_user_id_idx ON devices (user_id, created_at);

CREATE TRIGGER links_user_required_insert BEFORE INSERT ON links
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'links.user_id is required');
END;

CREATE TRIGGER links_user_required_update BEFORE UPDATE OF user_id ON links
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'links.user_id is required');
END;

CREATE UNIQUE INDEX links_user_canonical_url_idx ON links (user_id, canonical_url);

CREATE INDEX links_user_created_at_idx ON links (user_id, created_at);

CREATE INDEX links_user_status_created_at_idx
  ON links (user_id, status, created_at);

CREATE INDEX links_user_updated_at_idx ON links (user_id, updated_at);

CREATE TRIGGER link_tags_user_required_insert BEFORE INSERT ON link_tags
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'link_tags.user_id is required');
END;

CREATE TRIGGER link_tags_user_required_update BEFORE UPDATE OF user_id ON link_tags
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'link_tags.user_id is required');
END;

CREATE INDEX link_tags_user_tag_idx ON link_tags (user_id, tag_id);

CREATE TRIGGER open_tabs_user_required_insert BEFORE INSERT ON open_tabs
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'open_tabs.user_id is required');
END;

CREATE TRIGGER open_tabs_user_required_update BEFORE UPDATE OF user_id ON open_tabs
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'open_tabs.user_id is required');
END;

CREATE INDEX open_tabs_user_id_idx ON open_tabs (user_id);

CREATE TRIGGER commands_user_required_insert BEFORE INSERT ON commands
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'commands.user_id is required');
END;

CREATE TRIGGER commands_user_required_update BEFORE UPDATE OF user_id ON commands
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'commands.user_id is required');
END;

CREATE INDEX commands_user_id_idx ON commands (user_id);

CREATE TRIGGER sessions_user_required_insert BEFORE INSERT ON sessions
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'sessions.user_id is required');
END;

CREATE TRIGGER sessions_user_required_update BEFORE UPDATE OF user_id ON sessions
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'sessions.user_id is required');
END;

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TRIGGER device_pairings_user_required_insert BEFORE INSERT ON device_pairings
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'device_pairings.user_id is required');
END;

CREATE TRIGGER device_pairings_user_required_update BEFORE UPDATE OF user_id ON device_pairings
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'device_pairings.user_id is required');
END;

CREATE INDEX device_pairings_user_id_idx ON device_pairings (user_id);

CREATE TABLE "api_tokens" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices (id) ON DELETE CASCADE,
  name TEXT,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  last_used_at TEXT,
  -- A device token, or a user token with the name shown in Settings.
  CHECK (
    (device_id IS NOT NULL AND name IS NULL) OR (device_id IS NULL AND name IS NOT NULL)
  )
);

CREATE INDEX api_tokens_device_id_idx ON api_tokens (device_id);

CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);

CREATE TABLE "digests" (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  UNIQUE (user_id, period_start, period_end)
);

CREATE VIRTUAL TABLE links_fts USING fts5 (
  title,
  summary,
  text,
  user_id UNINDEXED,
  content = 'links',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER links_fts_after_insert AFTER INSERT ON links BEGIN
  INSERT INTO links_fts (rowid, title, summary, text, user_id)
  VALUES (new.seq, new.title, new.summary, new.text, new.user_id);
END;

CREATE TRIGGER links_fts_after_delete AFTER DELETE ON links BEGIN
  INSERT INTO links_fts (links_fts, rowid, title, summary, text, user_id)
  VALUES ('delete', old.seq, old.title, old.summary, old.text, old.user_id);
END;

CREATE TRIGGER links_fts_after_update
AFTER UPDATE OF seq, title, summary, text, user_id ON links BEGIN
  INSERT INTO links_fts (links_fts, rowid, title, summary, text, user_id)
  VALUES ('delete', old.seq, old.title, old.summary, old.text, old.user_id);
  INSERT INTO links_fts (rowid, title, summary, text, user_id)
  VALUES (new.seq, new.title, new.summary, new.text, new.user_id);
END;

CREATE INDEX links_vector_version_idx ON links (vector_version, enriched_at);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The COSE public key, base64url.
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  -- JSON array of the transports the browser reported (internal, hybrid, ...), or NULL.
  transports TEXT,
  -- Whether it syncs to other devices (a multi-device credential that is backed up).
  synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
) WITHOUT ROWID;

CREATE INDEX passkeys_user_id_idx ON passkeys (user_id);

CREATE TABLE passkey_challenges (
  id TEXT PRIMARY KEY,
  -- The challenge and what it is for, as JSON.
  challenge TEXT NOT NULL,
  -- Epoch milliseconds.
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX passkey_challenges_expires_at_idx ON passkey_challenges (expires_at);

CREATE TABLE google_flows (
  -- The OAuth state of the sign-in.
  state TEXT PRIMARY KEY,
  -- The PKCE verifier, the nonce, the binding cookie's hash and what the sign-in is for, as JSON.
  flow TEXT NOT NULL,
  -- Epoch milliseconds.
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX google_flows_expires_at_idx ON google_flows (expires_at);
`;
