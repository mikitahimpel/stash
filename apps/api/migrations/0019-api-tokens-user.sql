-- `api_tokens.user_id`: whose token it is (#177, see 0011-users.sql). Every token acts for one
-- user: a device token for the device's owner, a user token (the MCP connector's) for the user it
-- was minted for. Existing tokens are the owner's.
--
-- This table is rebuilt instead of altered: its CHECK tied a user token to a `github_login`, and
-- a token now names its user by id. It is small (a row per token) and no table references it, so
-- dropping the old one cascades nowhere. Every row is copied, with its hash, so each token keeps
-- working. `github_login` is not copied: `user_id` replaces it.
CREATE TABLE IF NOT EXISTS api_tokens_v2 (
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

INSERT OR IGNORE INTO api_tokens_v2
    (id, user_id, device_id, name, hash, created_at, revoked_at, last_used_at)
  SELECT id, 'owner', device_id, name, hash, created_at, revoked_at, last_used_at
  FROM api_tokens;

DROP TABLE api_tokens;

ALTER TABLE api_tokens_v2 RENAME TO api_tokens;

CREATE INDEX IF NOT EXISTS api_tokens_device_id_idx ON api_tokens (device_id);
CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens (user_id);
