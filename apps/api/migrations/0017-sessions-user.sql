-- `sessions.user_id`: whose row it is (#177, see 0011-users.sql). Existing rows are the owner's.
--
-- SQLite cannot add a NOT NULL column without a default, and a default would quietly give the
-- owner every row a query forgot to assign. So the column is added nullable with its foreign key
-- (a removed member takes their rows along), filled, and two triggers refuse a row without a user
-- from now on. The table itself is not rebuilt: no row is copied or dropped.
ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE CASCADE;

UPDATE sessions SET user_id = 'owner' WHERE user_id IS NULL;

CREATE TRIGGER IF NOT EXISTS sessions_user_required_insert BEFORE INSERT ON sessions
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'sessions.user_id is required');
END;

CREATE TRIGGER IF NOT EXISTS sessions_user_required_update BEFORE UPDATE OF user_id ON sessions
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'sessions.user_id is required');
END;

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
