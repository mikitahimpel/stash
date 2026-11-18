-- Who published a link (#148).
--
-- `links.author`: a YouTube channel (oEmbed `author_name`) or a page's author (`<meta
-- name="author">`, `article:author`), filled by enrichment and shown in the web's rows. Links
-- enriched before this stay NULL until they are enriched again.
ALTER TABLE links ADD COLUMN author TEXT;
