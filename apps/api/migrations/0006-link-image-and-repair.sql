-- Preview images and the repair of junk enrichments (#147).
--
-- `links.image_url`: a preview image on the page's own host (an `og:image`, a YouTube thumbnail),
-- filled by enrichment. The web shows the remote URL; nothing proxies or stores the image.
ALTER TABLE links ADD COLUMN image_url TEXT;

-- A YouTube video's thumbnail needs no fetch: the canonical URL holds the 11-character video id
-- (`https://youtube.com/watch?v=<id>`, see `canonicalize-url.ts`), so every stored video gets its
-- image here.
UPDATE links
  SET image_url = 'https://i.ytimg.com/vi/' || substr(canonical_url, 29, 11) || '/hqdefault.jpg'
  WHERE canonical_url GLOB 'https://youtube.com/watch[?]v=[A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-]';

-- Repair. From Cloudflare's addresses YouTube answered the watch page with a consent page, so
-- links were stored with the title "- YouTube", a summary about the content being unavailable, and
-- tags such as `unclassified`. The statements below put every link with those symptoms back into
-- the "not enriched yet" state. The hourly `requeuePending` cron step (see
-- `apps/api/src/scheduled-handler.ts`) then sends them through the fixed pipeline. All of it is
-- idempotent: a second run matches nothing.

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
      OR lower(summary) LIKE '%impossible to determine%'
      OR lower(summary) LIKE '%were unavailable%'
      OR lower(summary) LIKE '%was unavailable%'
      OR lower(summary) LIKE '%is unavailable%'
      OR lower(summary) LIKE '%are unavailable%'
      OR lower(summary) LIKE '%not available%'
      OR lower(summary) LIKE '%could not be fetched%'
      OR lower(summary) LIKE '%could not be retrieved%'
      OR summary LIKE '%евозможно определить%'
      OR summary LIKE '%е удалось определить%'
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
