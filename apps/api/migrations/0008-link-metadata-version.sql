-- The metadata backfill (#155).
--
-- `links.metadata_version`: the version of the metadata (`image_url`, `author`) the link was last
-- read for. Enrichment stamps the current one (`EnrichPolicy.metadataVersion`) on every link it
-- stores. An enriched link with an older stamp that misses its image or its author is read once
-- more by the hourly cron (`requeue-backfill.ts`): only its metadata is fetched, and only the
-- missing fields are filled. Links enriched before #147 / #148 start at 0, so they are next.
ALTER TABLE links ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 0;
