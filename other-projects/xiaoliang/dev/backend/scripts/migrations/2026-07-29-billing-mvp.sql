-- XiaoLiang billing MVP migration (PostgreSQL)
-- Apply before deploying code that reads organizations.plan_tier or billing tables.
-- Rollback section at bottom.

BEGIN;

-- 1) Organization plan cache
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(32) NOT NULL DEFAULT 'free';

-- 2) Billing orders
CREATE TABLE IF NOT EXISTS billing_orders (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  product_id VARCHAR(64) NOT NULL,
  plan_tier VARCHAR(32) NOT NULL,
  amount_fen INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  out_trade_no VARCHAR(32) NOT NULL UNIQUE,
  transaction_id VARCHAR(64) UNIQUE,
  code_url TEXT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ NULL,
  synced_at TIMESTAMPTZ NULL,
  raw_notify_json TEXT NULL
);
CREATE INDEX IF NOT EXISTS ix_billing_orders_organization_id ON billing_orders(organization_id);
CREATE INDEX IF NOT EXISTS ix_billing_orders_org_created_at ON billing_orders(organization_id, created_at);
CREATE INDEX IF NOT EXISTS ix_billing_orders_org_status ON billing_orders(organization_id, status);
CREATE INDEX IF NOT EXISTS ix_billing_orders_out_trade_no ON billing_orders(out_trade_no);

-- 3) Usage credit grants
CREATE TABLE IF NOT EXISTS usage_credit_grants (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_order_id VARCHAR(36) NOT NULL UNIQUE REFERENCES billing_orders(id) ON DELETE CASCADE,
  plan_tier VARCHAR(32) NOT NULL,
  total_credits INTEGER NOT NULL,
  used_credits INTEGER NOT NULL DEFAULT 0,
  period_started_at TIMESTAMPTZ NOT NULL,
  period_ends_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usage_credit_grants_organization_id ON usage_credit_grants(organization_id);
CREATE INDEX IF NOT EXISTS ix_usage_credit_grants_org_period ON usage_credit_grants(organization_id, period_ends_at);

-- 4) Usage charges ledger
CREATE TABLE IF NOT EXISTS usage_charges (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL,
  usage_credit_grant_id VARCHAR(36) NULL REFERENCES usage_credit_grants(id) ON DELETE SET NULL,
  entrypoint VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  charge_type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'charged',
  period_date DATE NULL,
  CONSTRAINT uq_usage_charges_org_idempotency UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_usage_charges_organization_id ON usage_charges(organization_id);
CREATE INDEX IF NOT EXISTS ix_usage_charges_org_period_date ON usage_charges(organization_id, period_date);

-- 5) Agent usage runs
CREATE TABLE IF NOT EXISTS agent_usage_runs (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_run_id VARCHAR(128) NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'unknown',
  status VARCHAR(32) NOT NULL DEFAULT 'started',
  local_conversation_id VARCHAR(128) NULL,
  task_preview TEXT NULL,
  original_question TEXT NULL,
  final_answer TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NULL,
  duration_ms INTEGER NULL,
  error_message TEXT NULL,
  CONSTRAINT uq_agent_usage_runs_org_client_run UNIQUE (organization_id, client_run_id)
);
CREATE INDEX IF NOT EXISTS ix_agent_usage_runs_organization_id ON agent_usage_runs(organization_id);
CREATE INDEX IF NOT EXISTS ix_agent_usage_runs_user_id ON agent_usage_runs(user_id);
CREATE INDEX IF NOT EXISTS ix_agent_usage_runs_org_started_at ON agent_usage_runs(organization_id, started_at);

COMMIT;

-- Rollback (manual):
-- BEGIN;
-- DROP TABLE IF EXISTS agent_usage_runs;
-- DROP TABLE IF EXISTS usage_charges;
-- DROP TABLE IF EXISTS usage_credit_grants;
-- DROP TABLE IF EXISTS billing_orders;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS plan_tier;
-- COMMIT;
