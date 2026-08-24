BEGIN;

ALTER TABLE project_archive_conversations
  ADD COLUMN IF NOT EXISTS creation_source VARCHAR(64) NOT NULL DEFAULT 'legacy_unknown';

COMMIT;

-- Rollback (manual):
-- ALTER TABLE project_archive_conversations DROP COLUMN IF EXISTS creation_source;
