-- `digests.user_id`: whose digest it is (#177, see 0011-users.sql). Each user gets their own
-- weekly digest, so a period is unique per user. Existing digests are the owner's.
--
-- Rebuilt instead of altered, because the old UNIQUE (period_start, period_end) is part of the
-- table. It holds one small row a week, and no table references it. Every row is copied.
CREATE TABLE IF NOT EXISTS digests_v2 (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  UNIQUE (user_id, period_start, period_end)
);

INSERT OR IGNORE INTO digests_v2 (id, user_id, period_start, period_end, generated_at, content)
  SELECT id, 'owner', period_start, period_end, generated_at, content FROM digests;

DROP TABLE digests;

ALTER TABLE digests_v2 RENAME TO digests;
