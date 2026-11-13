-- User tokens: an api token that belongs to the signed-in user instead of a device. The MCP
-- connector mints one (`Claude (MCP)`) each time the owner authorizes Claude. A user token has no
-- `device_id`, carries a `name` for Settings and the `github_login` it acts as.
--
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt. No table references
-- `api_tokens`, so dropping the old one cascades nowhere. Existing rows are device tokens.
CREATE TABLE api_tokens_new (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices (id) ON DELETE CASCADE,
  name TEXT,
  github_login TEXT,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  -- Exactly one owner: a device, or a user (with the name shown in Settings).
  CHECK (
    (device_id IS NOT NULL AND name IS NULL AND github_login IS NULL)
    OR (device_id IS NULL AND name IS NOT NULL AND github_login IS NOT NULL)
  )
);

INSERT INTO api_tokens_new (id, device_id, hash, created_at, revoked_at)
  SELECT id, device_id, hash, created_at, revoked_at FROM api_tokens;

DROP TABLE api_tokens;

ALTER TABLE api_tokens_new RENAME TO api_tokens;

CREATE INDEX api_tokens_device_id_idx ON api_tokens (device_id);
