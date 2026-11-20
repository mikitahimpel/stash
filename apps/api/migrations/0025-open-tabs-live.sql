-- Live open tabs (#182): devices report on every tab change, and Open now groups a device's tabs
-- by window and says when a tab was last active. All new columns are optional: older clients
-- report without them.
ALTER TABLE open_tabs ADD COLUMN last_active_at TEXT;
ALTER TABLE open_tabs ADD COLUMN window_id TEXT;
ALTER TABLE open_tabs ADD COLUMN window_name TEXT;
ALTER TABLE open_tabs ADD COLUMN favicon_url TEXT;

-- The per-device limit on reports: a fixed window (its start in epoch ms, by the api's clock) and
-- how many reports came in it. Kept on the device row, written by the report itself, so the limit
-- costs no extra write.
ALTER TABLE devices ADD COLUMN tabs_window_start INTEGER;
ALTER TABLE devices ADD COLUMN tabs_window_count INTEGER NOT NULL DEFAULT 0;
