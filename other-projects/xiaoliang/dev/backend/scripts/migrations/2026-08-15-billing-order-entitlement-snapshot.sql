-- Snapshot Credits entitlements on billing orders (PostgreSQL).
--
-- Apply before deploying the catalog change. Existing rows were created under
-- the previous catalog, so pending payments must keep those advertised values.

BEGIN;

ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS credits INTEGER NULL;
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS duration_days INTEGER NULL;

UPDATE billing_orders
   SET credits = CASE product_id
       WHEN 'credits_starter' THEN 10000
       WHEN 'credits_standard' THEN 62500
       WHEN 'credits_professional' THEN 135000
       ELSE credits
   END,
       duration_days = CASE
         WHEN product_id IN (
           'credits_starter',
           'credits_standard',
           'credits_professional'
         ) THEN 365
         ELSE duration_days
       END
 WHERE credits IS NULL OR duration_days IS NULL;

COMMIT;

-- Verification:
-- SELECT product_id, status, credits, duration_days, COUNT(*)
--   FROM billing_orders
--  GROUP BY product_id, status, credits, duration_days
--  ORDER BY product_id, status;

-- The columns are intentionally nullable for unknown legacy product ids. New
-- code always writes both values and refuses to grant a removed product that
-- has no usable snapshot.
