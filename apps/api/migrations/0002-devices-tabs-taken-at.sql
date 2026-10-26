-- When the device's current tabs snapshot was taken, or NULL if it never reported one. An empty
-- snapshot leaves no `open_tabs` rows, so the rows alone cannot tell it from no snapshot.
ALTER TABLE devices ADD COLUMN tabs_taken_at TEXT;
