-- XiaoLiang desktop update / OSS release migration (PostgreSQL)
-- Apply before deploying code that serves /desktop-updates and DB-backed /client-releases.

BEGIN;

CREATE TABLE IF NOT EXISTS desktop_releases (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(32) NOT NULL,
  arch VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  staging_percentage INTEGER NULL,
  notes_json TEXT NULL,
  release_date TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_desktop_releases_target_version UNIQUE (platform, arch, channel, version)
);
CREATE INDEX IF NOT EXISTS ix_desktop_releases_target_status
  ON desktop_releases(platform, arch, channel, status);

CREATE TABLE IF NOT EXISTS desktop_release_artifacts (
  id SERIAL PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES desktop_releases(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  file_name VARCHAR(260) NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha512 TEXT NULL,
  sha256 VARCHAR(64) NULL,
  object_key VARCHAR(1000) NULL,
  public_url TEXT NOT NULL,
  content_type VARCHAR(120) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_desktop_release_artifacts_release_file UNIQUE (release_id, file_name)
);
CREATE INDEX IF NOT EXISTS ix_desktop_release_artifacts_file_name
  ON desktop_release_artifacts(file_name);
CREATE INDEX IF NOT EXISTS ix_desktop_release_artifacts_release_id
  ON desktop_release_artifacts(release_id);

CREATE TABLE IF NOT EXISTS desktop_update_policies (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(32) NOT NULL,
  arch VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  minimum_supported_version VARCHAR(64) NULL,
  force_update_message TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_desktop_update_policies_target UNIQUE (platform, arch, channel)
);

CREATE TABLE IF NOT EXISTS desktop_update_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(32) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  arch VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NULL,
  current_version VARCHAR(64) NULL,
  target_version VARCHAR(64) NULL,
  file_name VARCHAR(260) NULL,
  release_id INTEGER NULL REFERENCES desktop_releases(id) ON DELETE SET NULL,
  artifact_id INTEGER NULL REFERENCES desktop_release_artifacts(id) ON DELETE SET NULL,
  source VARCHAR(120) NULL,
  ip_hash VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  referer TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_desktop_update_events_target_created_at
  ON desktop_update_events(platform, arch, channel, created_at);
CREATE INDEX IF NOT EXISTS ix_desktop_update_events_type_created_at
  ON desktop_update_events(event_type, created_at);

COMMIT;

-- Rollback:
-- BEGIN;
-- DROP TABLE IF EXISTS desktop_update_events;
-- DROP TABLE IF EXISTS desktop_update_policies;
-- DROP TABLE IF EXISTS desktop_release_artifacts;
-- DROP TABLE IF EXISTS desktop_releases;
-- COMMIT;
