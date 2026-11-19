-- `link_tags.user_id`: whose row it is (#177, see 0011-users.sql). Existing rows are the owner's.
--
-- SQLite cannot add a NOT NULL column without a default, and a default would quietly give the
-- owner every row a query forgot to assign. So the column is added nullable with its foreign key
-- (a removed member takes their rows along), filled, and two triggers refuse a row without a user
-- from now on. The table itself is not rebuilt: no row is copied or dropped.
ALTER TABLE link_tags ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE CASCADE;

UPDATE link_tags SET user_id = 'owner' WHERE user_id IS NULL;

CREATE TRIGGER IF NOT EXISTS link_tags_user_required_insert BEFORE INSERT ON link_tags
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'link_tags.user_id is required');
END;

CREATE TRIGGER IF NOT EXISTS link_tags_user_required_update BEFORE UPDATE OF user_id ON link_tags
WHEN new.user_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'link_tags.user_id is required');
END;

-- `tags` itself stays shared: it is only the list of tag names, and no endpoint reads it except
-- through a user's own `link_tags`. A name nobody uses any more is deleted with its last use
-- (when a member is removed).
CREATE INDEX IF NOT EXISTS link_tags_user_tag_idx ON link_tags (user_id, tag_id);
