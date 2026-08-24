-- Project package archive, conversation/message collection, and cached cloud document analyses.
-- PostgreSQL migration; apply before enabling desktop project synchronization.

BEGIN;

CREATE TABLE IF NOT EXISTS project_archives (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  last_synced_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  local_project_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  root_name VARCHAR(255) NULL,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  active_snapshot_id VARCHAR(36) NULL,
  last_completed_snapshot_id VARCHAR(36) NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  last_scanned_at VARCHAR(64) NULL,
  last_synced_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_project_archives_org_local_project
    UNIQUE (organization_id, local_project_id)
);
CREATE INDEX IF NOT EXISTS ix_project_archives_organization_id
  ON project_archives(organization_id);
CREATE INDEX IF NOT EXISTS ix_project_archives_owner_user_id
  ON project_archives(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_project_archives_active_snapshot_id
  ON project_archives(active_snapshot_id);

CREATE TABLE IF NOT EXISTS project_archive_files (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_archive_id VARCHAR(36) NOT NULL REFERENCES project_archives(id) ON DELETE CASCADE,
  archived_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  relative_path TEXT NOT NULL,
  normalized_path VARCHAR(2048) NOT NULL,
  filename VARCHAR(512) NOT NULL,
  extension VARCHAR(32) NOT NULL DEFAULT '',
  media_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  modified_at_client VARCHAR(64) NULL,
  storage_key VARCHAR(1024) NULL,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  upload_error TEXT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_snapshot_id VARCHAR(36) NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_project_archive_files_project_path
    UNIQUE (project_archive_id, normalized_path)
);
CREATE INDEX IF NOT EXISTS ix_project_archive_files_project_archive_id
  ON project_archive_files(project_archive_id);
CREATE INDEX IF NOT EXISTS ix_project_archive_files_sha256
  ON project_archive_files(sha256);
CREATE INDEX IF NOT EXISTS ix_project_archive_files_storage_key
  ON project_archive_files(storage_key);
CREATE INDEX IF NOT EXISTS ix_project_archive_files_last_seen_snapshot_id
  ON project_archive_files(last_seen_snapshot_id);
CREATE INDEX IF NOT EXISTS ix_project_archive_files_project_status
  ON project_archive_files(project_archive_id, is_deleted, upload_status);

CREATE TABLE IF NOT EXISTS project_archive_conversations (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_archive_id VARCHAR(36) NOT NULL REFERENCES project_archives(id) ON DELETE CASCADE,
  source_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  local_conversation_id VARCHAR(128) NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT '新对话',
  conversation_mode VARCHAR(32) NOT NULL DEFAULT 'knowledge_qa',
  drawing_id VARCHAR(128) NULL,
  drawing_name VARCHAR(512) NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_model_id VARCHAR(255) NULL,
  preferred_thinking_mode VARCHAR(32) NULL,
  context_usage_json TEXT NULL,
  source_updated_at VARCHAR(64) NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_project_archive_conversations_project_local
    UNIQUE (project_archive_id, local_conversation_id)
);
CREATE INDEX IF NOT EXISTS ix_project_archive_conversations_project_archive_id
  ON project_archive_conversations(project_archive_id);
CREATE INDEX IF NOT EXISTS ix_project_archive_conversations_source_user_id
  ON project_archive_conversations(source_user_id);

CREATE TABLE IF NOT EXISTS project_archive_messages (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_id VARCHAR(36) NOT NULL REFERENCES project_archive_conversations(id) ON DELETE CASCADE,
  local_message_id VARCHAR(128) NULL,
  source_key VARCHAR(64) NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  role VARCHAR(32) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_name VARCHAR(255) NOT NULL DEFAULT '',
  tool_args TEXT NOT NULL DEFAULT '',
  tool_result TEXT NOT NULL DEFAULT '',
  thinking TEXT NOT NULL DEFAULT '',
  parts_json TEXT NULL,
  source_created_at VARCHAR(64) NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_project_archive_messages_conversation_source
    UNIQUE (conversation_id, source_key)
);
CREATE INDEX IF NOT EXISTS ix_project_archive_messages_conversation_id
  ON project_archive_messages(conversation_id);
CREATE INDEX IF NOT EXISTS ix_project_archive_messages_local_message_id
  ON project_archive_messages(local_message_id);
CREATE INDEX IF NOT EXISTS ix_project_archive_messages_conversation_ordinal
  ON project_archive_messages(conversation_id, is_deleted, ordinal);

CREATE TABLE IF NOT EXISTS project_archive_message_attachments (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_id VARCHAR(36) NOT NULL REFERENCES project_archive_messages(id) ON DELETE CASCADE,
  local_attachment_id VARCHAR(128) NOT NULL,
  filename VARCHAR(512) NULL,
  media_type VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 VARCHAR(64) NULL,
  storage_key VARCHAR(1024) NULL,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  upload_error TEXT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_project_archive_message_attachments_message_local
    UNIQUE (message_id, local_attachment_id)
);
CREATE INDEX IF NOT EXISTS ix_project_archive_message_attachments_message_id
  ON project_archive_message_attachments(message_id);
CREATE INDEX IF NOT EXISTS ix_project_archive_message_attachments_sha256
  ON project_archive_message_attachments(sha256);

CREATE TABLE IF NOT EXISTS project_document_analyses (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_file_id VARCHAR(36) NOT NULL REFERENCES project_archive_files(id) ON DELETE CASCADE,
  requested_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  request_fingerprint VARCHAR(64) NOT NULL,
  instruction TEXT NOT NULL,
  file_parsing_strategy VARCHAR(32) NOT NULL DEFAULT 'auto',
  model VARCHAR(128) NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  content TEXT NOT NULL DEFAULT '',
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  warnings_json TEXT NULL,
  usage_json TEXT NULL,
  error_message TEXT NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_project_document_analyses_file_request
    UNIQUE (project_file_id, request_fingerprint)
);
CREATE INDEX IF NOT EXISTS ix_project_document_analyses_project_file_id
  ON project_document_analyses(project_file_id);
CREATE INDEX IF NOT EXISTS ix_project_document_analyses_requested_by_user_id
  ON project_document_analyses(requested_by_user_id);

COMMIT;

-- Rollback (manual, preserves OSS objects unless removed separately):
-- BEGIN;
-- DROP TABLE IF EXISTS project_document_analyses;
-- DROP TABLE IF EXISTS project_archive_message_attachments;
-- DROP TABLE IF EXISTS project_archive_messages;
-- DROP TABLE IF EXISTS project_archive_conversations;
-- DROP TABLE IF EXISTS project_archive_files;
-- DROP TABLE IF EXISTS project_archives;
-- COMMIT;
