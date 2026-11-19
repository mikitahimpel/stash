-- When a link last changed, for the live updates (#169): `GET /links?updatedSince=` answers the
-- links a client missed while its stream was closed, and of two copies of a link the one with
-- the later `updatedAt` is current.
--
-- Triggers keep it, so every writer is covered without knowing about it: the save, the edits of
-- the links feature, enrichment and the metadata backfill, and a change of the link's tags. Only
-- the columns a client can see count. `enrichment_attempts`, `enrichment_error`, `text` and
-- `metadata_version` are bookkeeping, and a write to `updated_at` itself must not fire again.
ALTER TABLE links ADD COLUMN updated_at TEXT;

UPDATE links SET updated_at = COALESCE(enriched_at, created_at);

CREATE INDEX links_updated_at_idx ON links (updated_at);

CREATE TRIGGER links_touch_after_insert AFTER INSERT ON links BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE seq = new.seq;
END;

CREATE TRIGGER links_touch_after_update
AFTER UPDATE OF url, canonical_url, title, status, type, summary, language, source_device_id,
  enriched_at, image_url, author, post ON links BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE seq = new.seq;
END;

CREATE TRIGGER link_tags_touch_after_insert AFTER INSERT ON link_tags BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = new.link_id;
END;

CREATE TRIGGER link_tags_touch_after_delete AFTER DELETE ON link_tags BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = old.link_id;
END;
