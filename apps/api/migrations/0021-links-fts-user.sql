-- Keyword search per user (#177): each row of the FTS index carries its link's `user_id`, so a
-- search reads only the caller's rows from the index itself, before any join.
--
-- An FTS5 table cannot get a column, so the index is dropped and built again from `links`
-- (`rebuild` reads every link once). `links` is not touched: the index is derived data, and a
-- failure here loses nothing that the next run does not rebuild. `user_id` is UNINDEXED: stored
-- and comparable, never matched as text.
DROP TRIGGER IF EXISTS links_fts_after_insert;
DROP TRIGGER IF EXISTS links_fts_after_delete;
DROP TRIGGER IF EXISTS links_fts_after_update;

DROP TABLE IF EXISTS links_fts;

CREATE VIRTUAL TABLE links_fts USING fts5 (
  title,
  summary,
  text,
  user_id UNINDEXED,
  content = 'links',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO links_fts (links_fts) VALUES ('rebuild');

CREATE TRIGGER links_fts_after_insert AFTER INSERT ON links BEGIN
  INSERT INTO links_fts (rowid, title, summary, text, user_id)
  VALUES (new.seq, new.title, new.summary, new.text, new.user_id);
END;

CREATE TRIGGER links_fts_after_delete AFTER DELETE ON links BEGIN
  INSERT INTO links_fts (links_fts, rowid, title, summary, text, user_id)
  VALUES ('delete', old.seq, old.title, old.summary, old.text, old.user_id);
END;

CREATE TRIGGER links_fts_after_update
AFTER UPDATE OF seq, title, summary, text, user_id ON links BEGIN
  INSERT INTO links_fts (links_fts, rowid, title, summary, text, user_id)
  VALUES ('delete', old.seq, old.title, old.summary, old.text, old.user_id);
  INSERT INTO links_fts (rowid, title, summary, text, user_id)
  VALUES (new.seq, new.title, new.summary, new.text, new.user_id);
END;
