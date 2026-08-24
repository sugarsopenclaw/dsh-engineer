-- Account-scoped archive for user-authored skills (PostgreSQL).
-- Desktop client scans ~/.xiaoliang/agent-workspace/skills and uploads via signed OSS PUT URLs.

BEGIN;

CREATE TABLE IF NOT EXISTS user_skill_archives (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_synced_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  active_snapshot_id VARCHAR(36) NULL,
  last_completed_snapshot_id VARCHAR(36) NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  skill_count INTEGER NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  skills_root_name VARCHAR(255) NULL,
  last_scanned_at VARCHAR(64) NULL,
  last_synced_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_user_skill_archives_org_owner
    UNIQUE (organization_id, owner_user_id)
);
CREATE INDEX IF NOT EXISTS ix_user_skill_archives_organization_id
  ON user_skill_archives(organization_id);
CREATE INDEX IF NOT EXISTS ix_user_skill_archives_owner_user_id
  ON user_skill_archives(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_user_skill_archives_active_snapshot_id
  ON user_skill_archives(active_snapshot_id);

CREATE TABLE IF NOT EXISTS user_skill_archive_entries (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_id VARCHAR(36) NOT NULL REFERENCES user_skill_archives(id) ON DELETE CASCADE,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  validation_status VARCHAR(32) NOT NULL DEFAULT 'invalid',
  validation_message TEXT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  updated_at_client VARCHAR(64) NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_snapshot_id VARCHAR(36) NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_skill_archive_entries_archive_slug
    UNIQUE (archive_id, slug)
);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_entries_archive_id
  ON user_skill_archive_entries(archive_id);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_entries_last_seen_snapshot_id
  ON user_skill_archive_entries(last_seen_snapshot_id);

CREATE TABLE IF NOT EXISTS user_skill_archive_files (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_id VARCHAR(36) NOT NULL REFERENCES user_skill_archives(id) ON DELETE CASCADE,
  archived_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  skill_slug VARCHAR(64) NULL,
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
  CONSTRAINT uq_user_skill_archive_files_archive_path
    UNIQUE (archive_id, normalized_path)
);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_files_archive_id
  ON user_skill_archive_files(archive_id);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_files_skill_slug
  ON user_skill_archive_files(skill_slug);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_files_sha256
  ON user_skill_archive_files(sha256);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_files_storage_key
  ON user_skill_archive_files(storage_key);
CREATE INDEX IF NOT EXISTS ix_user_skill_archive_files_last_seen_snapshot_id
  ON user_skill_archive_files(last_seen_snapshot_id);

COMMIT;

-- Rollback (manual; delete the corresponding private OSS prefix as well):
-- DROP TABLE IF EXISTS user_skill_archive_files;
-- DROP TABLE IF EXISTS user_skill_archive_entries;
-- DROP TABLE IF EXISTS user_skill_archives;
