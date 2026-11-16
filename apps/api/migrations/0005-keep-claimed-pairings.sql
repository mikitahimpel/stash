-- Claimed extension pairings stay (#143). Claiming used to delete the row, so reopening an old
-- `/connect/extension?code=…` tab and approving again registered a second Zen device that nothing
-- would ever claim. Now claiming sets `claimed_at`, and a row stays until long after it lapses, so
-- approving a code the api has seen answers `Conflict` and registers nothing.
--
-- A deleted device leaves its pairing row with no device (ON DELETE SET NULL, was CASCADE), so the
-- code stays known and still can't be approved again.
--
-- SQLite cannot change a foreign key in place, so the table is rebuilt. No table references
-- `device_pairings`, so dropping the old one cascades nowhere. Existing rows are unclaimed.
CREATE TABLE device_pairings_new (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT
);

INSERT INTO device_pairings_new (code_hash, device_id, expires_at)
  SELECT code_hash, device_id, expires_at FROM device_pairings;

DROP TABLE device_pairings;

ALTER TABLE device_pairings_new RENAME TO device_pairings;
