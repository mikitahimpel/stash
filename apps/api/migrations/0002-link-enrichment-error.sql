-- Why enrichment gave up on a link for good (the model refused or could not classify it), or NULL.
-- The consumer skips links that are enriched (`enriched_at`) or failed (`enrichment_error`).
ALTER TABLE links ADD COLUMN enrichment_error TEXT;
