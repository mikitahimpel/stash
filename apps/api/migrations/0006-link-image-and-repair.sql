-- Preview images and the repair of junk enrichments (#147).
--
-- `links.image_url`: a preview image on the page's own host (an `og:image`, a YouTube thumbnail),
-- filled by enrichment. The web shows the remote URL; nothing proxies or stores the image.
ALTER TABLE links ADD COLUMN image_url TEXT;

-- How many times the hourly cron sent a still-pending link to the enrichment queue again. The
-- cron stops at a cap (`EnrichPolicy.maxRequeues`), and a successful enrichment resets it.
ALTER TABLE links ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0;

-- A YouTube video's thumbnail needs no fetch: the canonical URL holds the 11-character video id
-- (`https://youtube.com/watch?v=<id>`, see `canonicalize-url.ts`), so every stored video gets its
-- image here. D1 rejects a LIKE or GLOB pattern longer than 50 bytes ("pattern too complex"), so
-- the id is checked with a short negated class instead of eleven classes in a row (#152).
UPDATE links
  SET image_url = 'https://i.ytimg.com/vi/' || substr(canonical_url, 29, 11) || '/hqdefault.jpg'
  WHERE substr(canonical_url, 1, 28) = 'https://youtube.com/watch?v='
    AND length(canonical_url) = 39
    AND substr(canonical_url, 29, 11) NOT GLOB '*[^A-Za-z0-9_-]*';

-- Repair. From Cloudflare's addresses YouTube answered the watch page with a consent page, so
-- links were stored with the title "- YouTube", a summary about the content being unavailable, and
-- tags such as `unclassified`. The statements below put every link with those symptoms back into
-- the "not enriched yet" state. The hourly `requeuePending` cron step (see
-- `apps/api/src/scheduled-handler.ts`) then sends them through the fixed pipeline. All of it is
-- idempotent: a second run matches nothing. The summary patterns are narrow on purpose; a link
-- they match by mistake only costs one more classifier call. The Russian phrases use `instr`: as
-- LIKE patterns they sit at D1's 50-byte limit, and LIKE is case-sensitive outside ASCII anyway.

UPDATE links
  SET summary = NULL, enriched_at = NULL, enrichment_error = NULL
  WHERE enriched_at IS NOT NULL
    AND (
      title IS NULL
      OR trim(title) IN ('- YouTube', 'YouTube')
      OR lower(summary) LIKE '%cannot be determined%'
      OR lower(summary) LIKE '%could not be determined%'
      OR lower(summary) LIKE '%can''t be determined%'
      OR lower(summary) LIKE '%unable to determine%'
      OR lower(summary) LIKE '%title were unavailable%'
      OR lower(summary) LIKE '%text was unavailable%'
      OR lower(summary) LIKE '%content is unavailable%'
      OR lower(summary) LIKE '%content was unavailable%'
      OR lower(summary) LIKE '%content is not available%'
      OR lower(summary) LIKE '%content could not be fetched%'
      OR lower(summary) LIKE '%text could not be fetched%'
      OR instr(summary, 'евозможно определить тему') > 0
      OR instr(summary, 'е удалось определить тему') > 0
      OR EXISTS (
        SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
        WHERE lt.link_id = links.id AND t.name IN (
          'unclassified', 'uncategorized', 'unknown', 'unknown topic', 'unidentified topic',
          'unknown content', 'missing title', 'no title', 'untitled', 'missing content',
          'no content', 'unavailable', 'content unavailable'
        )
      )
    );

-- A title that is only the site name is no title.
UPDATE links SET title = NULL WHERE trim(title) IN ('- YouTube', 'YouTube');

-- Tags that describe the classifier's lack of input, never a topic. Their `link_tags` rows go with
-- them (ON DELETE CASCADE).
DELETE FROM tags WHERE name IN (
  'unclassified', 'uncategorized', 'unknown', 'unknown topic', 'unidentified topic',
  'unknown content', 'missing title', 'no title', 'untitled', 'missing content', 'no content',
  'unavailable', 'content unavailable'
);
