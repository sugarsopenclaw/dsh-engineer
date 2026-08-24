-- Versioned subagent trace metadata. Semantic JSONL and screenshots stay in private OSS.
BEGIN;

CREATE TABLE IF NOT EXISTS subagent_trace_archives (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_archive_id VARCHAR(36) NOT NULL REFERENCES project_archives(id) ON DELETE CASCADE,
  archived_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  child_run_id VARCHAR(128) NOT NULL,
  parent_session_id VARCHAR(128) NOT NULL,
  parent_prompt_id VARCHAR(128) NOT NULL,
  client_run_id VARCHAR(128) NOT NULL,
  agent_type VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  model VARCHAR(128) NOT NULL,
  started_at_client VARCHAR(64) NOT NULL,
  finished_at_client VARCHAR(64) NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  error_code VARCHAR(64) NULL,
  trace_schema_version INTEGER NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  trace_sha256 VARCHAR(64) NOT NULL,
  trace_size_bytes BIGINT NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  upload_error TEXT NULL,
  training_consent BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_subagent_trace_archives_org_child_run UNIQUE (organization_id, child_run_id)
);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_organization_id
  ON subagent_trace_archives(organization_id);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_project_archive_id
  ON subagent_trace_archives(project_archive_id);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_parent_session_id
  ON subagent_trace_archives(parent_session_id);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_client_run_id
  ON subagent_trace_archives(client_run_id);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_trace_sha256
  ON subagent_trace_archives(trace_sha256);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_storage_key
  ON subagent_trace_archives(storage_key);

CREATE TABLE IF NOT EXISTS subagent_trace_blob_archives (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trace_archive_id VARCHAR(36) NOT NULL REFERENCES subagent_trace_archives(id) ON DELETE CASCADE,
  sha256 VARCHAR(64) NOT NULL,
  media_type VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  upload_error TEXT NULL,
  uploaded_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_subagent_trace_blob_archives_trace_sha UNIQUE (trace_archive_id, sha256)
);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_blob_archives_trace_archive_id
  ON subagent_trace_blob_archives(trace_archive_id);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_blob_archives_sha256
  ON subagent_trace_blob_archives(sha256);
CREATE INDEX IF NOT EXISTS ix_subagent_trace_blob_archives_storage_key
  ON subagent_trace_blob_archives(storage_key);

COMMIT;

-- Rollback (manual; private OSS objects are intentionally preserved):
-- DROP TABLE IF EXISTS subagent_trace_blob_archives;
-- DROP TABLE IF EXISTS subagent_trace_archives;
