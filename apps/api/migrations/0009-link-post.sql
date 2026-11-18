-- Posts on X as first-class links (#170).
--
-- `links.post`: for a link to a post on X, the post as enrichment read it from X's public
-- endpoints (author, text with entities, media URLs, the quoted post, counts), or the fact that
-- it is unavailable, as the JSON of the contract's `Link.LinkPost`. NULL on every other link.
-- Media stay on X's hosts; nothing is proxied or stored.
ALTER TABLE links ADD COLUMN post TEXT;

-- Backfill. A link to X saved before this was enriched from x.com's HTML, which is a login wall:
-- it has no post, and often a junk title and summary. Every such link goes back to the "not
-- enriched yet" state, and the hourly `requeuePending` cron step sends it through the pipeline
-- again (100 an hour, at most `EnrichPolicy.maxRequeues` times each), which now reads the post.
-- The stored title, summary and tags stay until then. It runs once: enrichment always sets
-- `enriched_at`, and a post that cannot be read is stored as unavailable.
--
-- `canonical_url` has a lowercase host without `www.`, so the hosts are matched as written. Each
-- pattern is well within D1's 50-byte limit on LIKE patterns (#152). A URL that matches but is no
-- status URL (`%` also matches `/`) only costs one more classifier call.
UPDATE links
  SET enriched_at = NULL, enrichment_error = NULL, enrichment_attempts = 0
  WHERE canonical_url LIKE 'https://x.com/%/status/%'
    OR canonical_url LIKE 'https://twitter.com/%/status/%'
    OR canonical_url LIKE 'https://mobile.x.com/%/status/%'
    OR canonical_url LIKE 'https://mobile.twitter.com/%/status/%'
    OR canonical_url LIKE 'https://m.twitter.com/%/status/%'
    OR canonical_url LIKE 'https://fxtwitter.com/%/status/%'
    OR canonical_url LIKE 'https://vxtwitter.com/%/status/%'
    OR canonical_url LIKE 'https://fixupx.com/%/status/%'
    OR canonical_url LIKE 'https://fixvx.com/%/status/%';
