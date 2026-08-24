-- Per-model-call usage telemetry for a charged XiaoLiang agent run (PostgreSQL).
-- Contains only identifiers, model/call metadata and counters; no prompts, responses or local paths.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_usage_calls (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_run_id VARCHAR(36) NOT NULL REFERENCES agent_usage_runs(id) ON DELETE CASCADE,
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_run_id VARCHAR(128) NOT NULL,
  child_run_id VARCHAR(128) NULL,
  call_purpose VARCHAR(32) NOT NULL,
  model_alias VARCHAR(128) NOT NULL,
  provider_model VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'started',
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NULL,
  duration_ms INTEGER NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(128) NULL
);

CREATE INDEX IF NOT EXISTS ix_agent_usage_calls_agent_run_id
  ON agent_usage_calls(agent_run_id);
CREATE INDEX IF NOT EXISTS ix_agent_usage_calls_organization_id
  ON agent_usage_calls(organization_id);
CREATE INDEX IF NOT EXISTS ix_agent_usage_calls_user_id
  ON agent_usage_calls(user_id);
CREATE INDEX IF NOT EXISTS ix_agent_usage_calls_run_started
  ON agent_usage_calls(agent_run_id, started_at);
CREATE INDEX IF NOT EXISTS ix_agent_usage_calls_org_purpose_started
  ON agent_usage_calls(organization_id, call_purpose, started_at);

COMMIT;

-- Rollback (manual):
-- BEGIN;
-- DROP TABLE IF EXISTS agent_usage_calls;
-- COMMIT;
