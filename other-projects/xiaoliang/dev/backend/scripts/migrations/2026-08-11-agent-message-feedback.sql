-- XiaoLiang per-message Agent feedback (PostgreSQL).
-- Apply before releasing a desktop client that calls /users/me/agent-feedback.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_message_feedback (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_run_id VARCHAR(36) NULL REFERENCES agent_usage_runs(id) ON DELETE SET NULL,
  client_run_id VARCHAR(128) NULL,
  local_conversation_id VARCHAR(128) NOT NULL,
  local_message_id VARCHAR(128) NOT NULL,
  vote VARCHAR(16) NULL,
  outcome VARCHAR(16) NULL,
  issue_codes_json TEXT NOT NULL DEFAULT '[]',
  comment TEXT NULL,
  app_version VARCHAR(64) NULL,
  feedback_schema_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_agent_message_feedback_user_message
    UNIQUE (organization_id, user_id, local_conversation_id, local_message_id),
  CONSTRAINT ck_agent_message_feedback_vote
    CHECK (vote IS NULL OR vote IN ('up', 'down')),
  CONSTRAINT ck_agent_message_feedback_outcome
    CHECK (outcome IS NULL OR outcome IN ('success', 'partial', 'failure'))
);

CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_organization_id
  ON agent_message_feedback(organization_id);
CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_user_id
  ON agent_message_feedback(user_id);
CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_agent_run_id
  ON agent_message_feedback(agent_run_id);
CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_user_conversation
  ON agent_message_feedback(user_id, local_conversation_id, updated_at);
CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_client_run
  ON agent_message_feedback(organization_id, client_run_id);

-- Re-running this migration against a table created by an earlier draft must
-- still install the domain constraints (CREATE TABLE IF NOT EXISTS will not).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_agent_message_feedback_vote'
      AND conrelid = 'agent_message_feedback'::regclass
  ) THEN
    ALTER TABLE agent_message_feedback
      ADD CONSTRAINT ck_agent_message_feedback_vote
      CHECK (vote IS NULL OR vote IN ('up', 'down'));
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_agent_message_feedback_outcome'
      AND conrelid = 'agent_message_feedback'::regclass
  ) THEN
    ALTER TABLE agent_message_feedback
      ADD CONSTRAINT ck_agent_message_feedback_outcome
      CHECK (outcome IS NULL OR outcome IN ('success', 'partial', 'failure'));
  END IF;
END $$;

COMMIT;

-- Rollback (manual):
-- BEGIN;
-- DROP TABLE IF EXISTS agent_message_feedback;
-- COMMIT;
