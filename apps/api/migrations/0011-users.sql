-- Multi-user (#177): the people of a Stash, and whose data is whose.
--
-- Until now a deploy had one user, the allowlisted GitHub login, and no row said so. This file
-- adds the users; the files after it (0012 to 0022) give every table that holds user data a
-- `user_id` and hand every existing row to the owner.
--
-- Rules for all of them, because they run on live data:
-- - Nothing is deleted. Each file only adds, or copies a small table into a new shape.
-- - Alchemy applies a file and its bookkeeping row as one D1 batch, which is one transaction: a
--   file that fails leaves nothing behind and is applied again whole by the next deploy.
-- - Where SQL allows, a statement is also safe to repeat (`IF NOT EXISTS`, `OR IGNORE`, updates
--   that match nothing the second time), so nothing depends on that alone.
-- - No LIKE or GLOB (D1 allows 50 bytes), and every statement is far below D1's 100 KB.
--
-- The owner is the user `owner`: a fixed id, so the files below can name it and applying them
-- twice creates no second one. Who that is stays what it was: whoever signs in with the
-- allowlisted GitHub login (`ALLOWED_GITHUB_LOGIN`). Members get a random id when they accept
-- an invite.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  -- Links a day (UTC) that AI may enrich. NULL is no cap.
  daily_ai_quota INTEGER CHECK (daily_ai_quota IS NULL OR daily_ai_quota >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- There is one owner.
CREATE UNIQUE INDEX IF NOT EXISTS users_one_owner_idx ON users (role) WHERE role = 'owner';

-- Named after the login of the latest web session, when there is one.
INSERT OR IGNORE INTO users (id, display_name, role, daily_ai_quota)
  VALUES (
    'owner',
    COALESCE((SELECT github_login FROM sessions ORDER BY created_at DESC LIMIT 1), 'Owner'),
    'owner',
    NULL
  );

-- How a member signs in: an account at a provider. For GitHub the subject is the account's
-- numeric id, which survives a rename (a login can be renamed and then taken by someone else).
-- The owner has no row here: the allowlisted login decides.
CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- What the provider calls the account (a GitHub login), to show. Never used to match.
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, subject)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS user_identities_user_id_idx ON user_identities (user_id);

-- Invite links. Only the hash of the link's token is stored. An invite works once
-- (`accepted_at`), until `expires_at`, unless revoked.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

-- Links enriched by AI per user and UTC day (`YYYY-MM-DD`), for the daily quota.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  links INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
