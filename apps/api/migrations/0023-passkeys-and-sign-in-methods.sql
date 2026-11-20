-- Passkeys and Sign in with Google (#178).
--
-- A user may now sign in in several ways: passkeys (this table), and accounts at Google and
-- GitHub (`user_identities`, provider `google` or `github`). The owner may link them too; the
-- allowlisted GitHub login still signs the owner in without a row.
--
-- Like 0011 to 0022, this file only adds, and is safe to apply again.

-- A WebAuthn credential. `id` is the credential id (base64url), the key a sign-in looks up.
-- Only the public key is stored. counter is the authenticator's signature counter (0 for
-- synced passkeys, which do not count).
CREATE TABLE IF NOT EXISTS passkeys (
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

CREATE INDEX IF NOT EXISTS passkeys_user_id_idx ON passkeys (user_id);

-- How a session was started. The owner's GitHub sessions are checked against the allowlisted
-- login on every request; a passkey or Google session has no GitHub login (`github_login` is '').
-- Every session before this file came from GitHub.
ALTER TABLE sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'github'
  CHECK (method IN ('github', 'passkey', 'google'));
