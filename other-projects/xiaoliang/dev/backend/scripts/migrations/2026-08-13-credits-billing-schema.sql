-- Credits billing, step 1 of 2: reshape the schema (PostgreSQL).
--
-- Additive and idempotent. Safe to apply while the old build is still serving
-- traffic, and it must land before the code deploy that runs the shadow window.
-- The grants themselves are step 2 (2026-08-13-credits-billing-data.sql), which
-- only runs once the shadow reconciliation passes.
--
-- Credits are computed from real DashScope usage:
--   credits = ceil(provider_cost_rmb * 4 / 0.008)
-- See app/domain/billing/pricing.py for the authoritative rate table.

BEGIN;

-- ---------------------------------------------------------------------------
-- usage_credit_grants becomes a general credit pool
-- ---------------------------------------------------------------------------

ALTER TABLE usage_credit_grants
  ALTER COLUMN source_order_id DROP NOT NULL;

ALTER TABLE usage_credit_grants
  ADD COLUMN IF NOT EXISTS grant_type VARCHAR(24) NOT NULL DEFAULT 'purchase';

ALTER TABLE usage_credit_grants
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';

-- A purchase grant is still one-per-order, but signup/migration grants have no
-- order at all, so the old NOT NULL unique constraint must become partial.
ALTER TABLE usage_credit_grants
  DROP CONSTRAINT IF EXISTS uq_usage_credit_grants_source_order;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_credit_grants_source_order
  ON usage_credit_grants(source_order_id)
  WHERE source_order_id IS NOT NULL;

-- At most one signup grant and one migration grant per organization; this is
-- what makes step 2 safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_credit_grants_org_signup
  ON usage_credit_grants(organization_id)
  WHERE grant_type = 'signup';

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_credit_grants_org_migration
  ON usage_credit_grants(organization_id)
  WHERE grant_type = 'migration';

CREATE INDEX IF NOT EXISTS ix_usage_credit_grants_org_status
  ON usage_credit_grants(organization_id, status);

-- ---------------------------------------------------------------------------
-- usage_charges becomes the credit ledger
-- ---------------------------------------------------------------------------

ALTER TABLE usage_charges
  ADD COLUMN IF NOT EXISTS agent_usage_call_id VARCHAR(36) NULL
    REFERENCES agent_usage_calls(id) ON DELETE SET NULL;

ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS micro_credits BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS unbacked_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS provider_model VARCHAR(128) NULL;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS pricing_version VARCHAR(64) NULL;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE usage_charges ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'charged';

-- Tag pre-existing per-run charges before dropping the columns that defined
-- them. Keep the old charge_type in the name so a refund audit can still tell a
-- free-tier run from one that consumed a paid pack.
UPDATE usage_charges
   SET pricing_version = 'legacy-per-run',
       charge_type = LEFT('legacy_' || charge_type, 16),
       credits = 0,
       micro_credits = 0
 WHERE pricing_version IS NULL;

-- units was always 1 under per-run billing, and period_date is recoverable from
-- created_at, so both are safe to drop.
ALTER TABLE usage_charges DROP COLUMN IF EXISTS units;
ALTER TABLE usage_charges DROP COLUMN IF EXISTS period_date;

-- Which pack a pre-credits run was billed against is real money history, so it
-- gets renamed out of the ORM's way rather than dropped. Credit-era charges
-- record this in usage_charge_allocations instead. Safe to drop once the old
-- per-run packs are fully settled.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'usage_charges' AND column_name = 'usage_credit_grant_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'usage_charges' AND column_name = 'legacy_credit_grant_id'
  ) THEN
    ALTER TABLE usage_charges RENAME COLUMN usage_credit_grant_id TO legacy_credit_grant_id;
  END IF;
END $$;

ALTER TABLE usage_charges DROP COLUMN IF EXISTS usage_credit_grant_id;

DROP INDEX IF EXISTS ix_usage_charges_org_period_date;

CREATE INDEX IF NOT EXISTS ix_usage_charges_org_created
  ON usage_charges(organization_id, created_at);

-- The shadow reconciliation scans by status; without this it seq-scans the
-- whole ledger on every run.
CREATE INDEX IF NOT EXISTS ix_usage_charges_status_created
  ON usage_charges(status, created_at);

-- ---------------------------------------------------------------------------
-- per-grant allocation of each charge
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_charge_allocations (
  id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usage_charge_id VARCHAR(36) NOT NULL REFERENCES usage_charges(id) ON DELETE CASCADE,
  usage_credit_grant_id VARCHAR(36) NOT NULL REFERENCES usage_credit_grants(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL,
  CONSTRAINT uq_usage_charge_allocations_charge_grant
    UNIQUE (usage_charge_id, usage_credit_grant_id)
);

CREATE INDEX IF NOT EXISTS ix_usage_charge_allocations_charge
  ON usage_charge_allocations(usage_charge_id);
CREATE INDEX IF NOT EXISTS ix_usage_charge_allocations_grant
  ON usage_charge_allocations(usage_credit_grant_id);

COMMIT;

-- Verification:
--   \d usage_charges
--   \d usage_credit_grants
--   SELECT charge_type, COUNT(*) FROM usage_charges GROUP BY 1;

-- Rollback (manual, destructive - credits history is lost):
-- BEGIN;
-- DROP TABLE IF EXISTS usage_charge_allocations;
-- ALTER TABLE usage_charges
--   DROP COLUMN IF EXISTS agent_usage_call_id,
--   DROP COLUMN IF EXISTS credits,
--   DROP COLUMN IF EXISTS micro_credits,
--   DROP COLUMN IF EXISTS unbacked_credits,
--   DROP COLUMN IF EXISTS provider_model,
--   DROP COLUMN IF EXISTS pricing_version,
--   DROP COLUMN IF EXISTS input_tokens,
--   DROP COLUMN IF EXISTS cached_input_tokens,
--   DROP COLUMN IF EXISTS cache_write_tokens,
--   DROP COLUMN IF EXISTS output_tokens,
--   DROP COLUMN IF EXISTS status;
-- ALTER TABLE usage_charges ADD COLUMN units INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE usage_charges ADD COLUMN period_date DATE NULL;
-- ALTER TABLE usage_credit_grants
--   DROP COLUMN IF EXISTS grant_type,
--   DROP COLUMN IF EXISTS status;
-- COMMIT;
