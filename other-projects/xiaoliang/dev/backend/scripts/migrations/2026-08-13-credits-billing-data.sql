-- Credits billing, step 2 of 2: move existing members onto credits (PostgreSQL).
--
-- Run this only after the shadow window has been reconciled
-- (scripts/reconcile_shadow_credits.py) and immediately before flipping
-- BILLING_CREDITS_ENFORCE=true. Running it earlier hands out credits that the
-- shadow window would then appear to burn.
--
-- Ordering matters: the migration grants are selected from the still-valid
-- plus/pro grants, so they must be inserted before those grants are voided.
-- Every statement is guarded by NOT EXISTS, so re-running changes nothing.

BEGIN;

-- 1. Members whose per-run pack has not expired yet get the Starter pack.
INSERT INTO usage_credit_grants (
  id, created_at, updated_at, organization_id, source_order_id,
  grant_type, status, plan_tier, total_credits, used_credits,
  period_started_at, period_ends_at
)
SELECT
  gen_random_uuid()::varchar,
  NOW(), NOW(), org.id, NULL,
  'migration', 'active', 'starter', 12375, 0,
  NOW(), NOW() + INTERVAL '365 days'
FROM (
  SELECT DISTINCT g.organization_id AS id
    FROM usage_credit_grants g
   WHERE g.plan_tier IN ('plus', 'pro')
     AND g.status = 'active'
     AND g.period_ends_at > NOW()
) AS org
WHERE NOT EXISTS (
  SELECT 1 FROM usage_credit_grants existing
   WHERE existing.organization_id = org.id
     AND existing.grant_type = 'migration'
);

-- 2. Everyone else keeps a free footing: the daily 3-run allowance is gone, so
--    without this backfill existing free accounts would be hard-locked.
INSERT INTO usage_credit_grants (
  id, created_at, updated_at, organization_id, source_order_id,
  grant_type, status, plan_tier, total_credits, used_credits,
  period_started_at, period_ends_at
)
SELECT
  gen_random_uuid()::varchar,
  NOW(), NOW(), o.id, NULL,
  'signup', 'active', 'free', 2000, 0,
  NOW(), NOW() + INTERVAL '365 days'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM usage_credit_grants existing
   WHERE existing.organization_id = o.id
     AND existing.grant_type IN ('signup', 'migration')
);

-- 3. Retire the per-run packs now that their replacement exists.
UPDATE usage_credit_grants
   SET status = 'void',
       updated_at = NOW()
 WHERE plan_tier IN ('plus', 'pro')
   AND status <> 'void';

-- 4. Old tier names no longer exist; the ledger recomputes this on next spend
--    but the cached column should not advertise a dead tier in the meantime.
UPDATE organizations
   SET plan_tier = 'starter'
 WHERE plan_tier IN ('plus', 'pro')
   AND EXISTS (
     SELECT 1 FROM usage_credit_grants g
      WHERE g.organization_id = organizations.id
        AND g.grant_type = 'migration'
        AND g.status = 'active'
   );

UPDATE organizations
   SET plan_tier = 'free'
 WHERE plan_tier IN ('plus', 'pro');

COMMIT;

-- Verification:
--   SELECT grant_type, status, plan_tier, COUNT(*), SUM(total_credits)
--     FROM usage_credit_grants GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
--   SELECT plan_tier, COUNT(*) FROM organizations GROUP BY 1;

-- Rollback (restores the per-run packs; purchased credits are kept):
-- BEGIN;
-- DELETE FROM usage_credit_grants WHERE grant_type IN ('signup', 'migration');
-- UPDATE usage_credit_grants SET status = 'active'
--  WHERE plan_tier IN ('plus', 'pro') AND status = 'void';
-- UPDATE organizations o SET plan_tier = (
--   SELECT g.plan_tier FROM usage_credit_grants g
--    WHERE g.organization_id = o.id AND g.status = 'active'
--      AND g.plan_tier IN ('plus', 'pro')
--    ORDER BY g.plan_tier DESC LIMIT 1
-- ) WHERE EXISTS (
--   SELECT 1 FROM usage_credit_grants g
--    WHERE g.organization_id = o.id AND g.status = 'active'
--      AND g.plan_tier IN ('plus', 'pro')
-- );
-- COMMIT;
