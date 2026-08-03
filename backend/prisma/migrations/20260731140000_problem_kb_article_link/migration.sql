-- Link a known error to the knowledge-base article that documents it, e.g.
-- "KB-042".
--
-- Deliberately a plain TEXT column with no foreign key: the KB is a static,
-- versioned dataset in the application (kb.data.ts), not a table, so there is
-- nothing to reference. The API validates the id against that dataset on write
-- and resolves it on read, returning null for an article that has since been
-- removed.
ALTER TABLE "problems" ADD COLUMN "kb_article_id" TEXT;
