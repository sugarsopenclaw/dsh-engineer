-- Immutable Pi JSONL session archives stored in private OSS.
BEGIN;

CREATE TABLE IF NOT EXISTS pi_session_archives (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_archive_id VARCHAR(36) NOT NULL REFERENCES project_archives(id) ON DELETE CASCADE,
  conversation_archive_id VARCHAR(36) NOT NULL REFERENCES project_archive_conversations(id) ON DELETE CASCADE,
  archived_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  local_conversation_id VARCHAR(128) NOT NULL,
  pi_session_id VARCHAR(128) NOT NULL,
  parent_pi_session_id VARCHAR(128) NULL,
  runtime_version INTEGER NOT NULL,
  jsonl_schema_version INTEGER NOT NULL,
  current_leaf_entry_id VARCHAR(128) NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  sha256 VARCHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  source_modified_at VARCHAR(64) NULL,
  storage_key VARCHAR(1024) NOT NULL,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  upload_error TEXT NULL,
  training_consent BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_pi_session_archives_conversation_session_sha
    UNIQUE (conversation_archive_id, pi_session_id, sha256)
);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_organization_id
  ON pi_session_archives(organization_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_project_archive_id
  ON pi_session_archives(project_archive_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_conversation_archive_id
  ON pi_session_archives(conversation_archive_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_archived_by_user_id
  ON pi_session_archives(archived_by_user_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_local_conversation_id
  ON pi_session_archives(local_conversation_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_pi_session_id
  ON pi_session_archives(pi_session_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_parent_pi_session_id
  ON pi_session_archives(parent_pi_session_id);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_sha256
  ON pi_session_archives(sha256);
CREATE INDEX IF NOT EXISTS ix_pi_session_archives_storage_key
  ON pi_session_archives(storage_key);

COMMIT;

-- Rollback (manual; private OSS objects are intentionally preserved):
-- DROP TABLE IF EXISTS pi_session_archives;
