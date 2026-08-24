-- User-owned prompt templates mirrored to private OSS (PostgreSQL).
-- Apply before releasing a desktop client that calls /users/me/prompt-templates.

BEGIN;

CREATE TABLE IF NOT EXISTS user_prompt_templates (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL,
  title_normalized VARCHAR(256) NOT NULL,
  description VARCHAR(500) NULL,
  content TEXT NOT NULL,
  storage_key VARCHAR(1024) NOT NULL UNIQUE,
  content_sha256 VARCHAR(64) NOT NULL,
  CONSTRAINT uq_user_prompt_templates_user_title
    UNIQUE (organization_id, user_id, title_normalized)
);

CREATE INDEX IF NOT EXISTS ix_user_prompt_templates_organization_id
  ON user_prompt_templates(organization_id);
CREATE INDEX IF NOT EXISTS ix_user_prompt_templates_user_id
  ON user_prompt_templates(user_id);
CREATE INDEX IF NOT EXISTS ix_user_prompt_templates_user_updated
  ON user_prompt_templates(user_id, updated_at);

COMMIT;

-- Rollback (manual; delete the corresponding private OSS prefix as well):
-- DROP TABLE IF EXISTS user_prompt_templates;
