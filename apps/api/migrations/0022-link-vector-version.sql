-- Semantic search per user (#177): every query of the Vectorize index filters on the metadata
-- `userId`, so a link's vector must carry it.
--
-- `links.vector_version`: the version of the vector's metadata (`EnrichPolicy.vectorVersion`).
-- Enrichment stamps the current one when it stores a vector. The vectors of links enriched before
-- this have no metadata, so they start at 0, and the hourly cron writes each one again with its
-- user (`backfill-vectors.ts`): the same values, read back from the index, no model call. Until
-- a link's turn comes, semantic search does not find it; keyword search does.
ALTER TABLE links ADD COLUMN vector_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS links_vector_version_idx ON links (vector_version, enriched_at);
