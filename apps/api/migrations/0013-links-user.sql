-- `links.user_id`: whose row it is (#177, see 0011-users.sql). Existing rows are the owner's.
--
-- SQLite cannot add a NOT NULL column without a default, and a default would quietly give the
-- owner every row a query forgot to assign. So the column is added nullable with its foreign key
-- (a removed member takes their rows along), filled, and two triggers refuse a row without a user
-- from now on. The table itself is not rebuilt: no row is copied or dropped.
ALTER TABLE links ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE CASCADE;

UPDATE links SET user_id = 'owner' WHERE user_id IS NULL;

CREATE TRIGGER IF NOT EXISTS links_user_required_insert BEFORE INSERT ON links
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'links.user_id is required');
END;

CREATE TRIGGER IF NOT EXISTS links_user_required_update BEFORE UPDATE OF user_id ON links
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'links.user_id is required');
END;

-- One link per canonical URL, per user: two people may save the same page. The old index was
-- unique over the whole table. The new one exists before the old one goes.
CREATE UNIQUE INDEX IF NOT EXISTS links_user_canonical_url_idx ON links (user_id, canonical_url);
DROP INDEX IF EXISTS links_canonical_url_idx;

-- Every list reads one user's links, so the list indexes start with the user.
CREATE INDEX IF NOT EXISTS links_user_created_at_idx ON links (user_id, created_at);
CREATE INDEX IF NOT EXISTS links_user_status_created_at_idx
  ON links (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS links_user_updated_at_idx ON links (user_id, updated_at);
DROP INDEX IF EXISTS links_status_created_at_idx;
DROP INDEX IF EXISTS links_created_at_idx;
DROP INDEX IF EXISTS links_updated_at_idx;
