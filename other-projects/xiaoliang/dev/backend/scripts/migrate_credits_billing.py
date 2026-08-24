"""Apply the credits billing migration against the configured database.

The migration is deliberately two steps, because the shadow window sits between
them:

    # before the code deploy
    python scripts/migrate_credits_billing.py schema

    # deploy with BILLING_CREDITS_ENFORCE=false, let it run, then
    python scripts/reconcile_shadow_credits.py --days 7

    # once reconciliation passes, in the same window as the enforcement flip
    python scripts/migrate_credits_billing.py data --dry-run
    python scripts/migrate_credits_billing.py data

Running `data` before the shadow window would hand out credits that shadow
traffic then appears to burn. Both steps are idempotent.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import text

from app.core.database import get_engine

MIGRATIONS = BACKEND_ROOT / "scripts" / "migrations"
SCHEMA_FILE = MIGRATIONS / "2026-08-13-credits-billing-schema.sql"
DATA_FILE = MIGRATIONS / "2026-08-13-credits-billing-data.sql"

SCHEMA_PREVIEW_SQL = """
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'usage_charges'
      AND column_name = 'micro_credits') AS ledger_columns_present,
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'usage_charge_allocations') AS allocations_table_present,
  (SELECT COUNT(*) FROM usage_charges) AS usage_charges_rows
"""

DATA_PREVIEW_SQL = """
SELECT
  (SELECT COUNT(DISTINCT organization_id)
     FROM usage_credit_grants
    WHERE plan_tier IN ('plus', 'pro')
      AND status = 'active'
      AND period_ends_at > NOW()) AS paid_members_to_migrate,
  (SELECT COUNT(*) FROM organizations) AS organizations_total,
  (SELECT COUNT(*) FROM usage_credit_grants
    WHERE plan_tier IN ('plus', 'pro') AND status <> 'void') AS per_run_grants_to_void,
  (SELECT COUNT(*) FROM usage_charges WHERE status = 'shadow') AS shadow_charges_recorded
"""

GRANT_SUMMARY_SQL = """
SELECT grant_type, status, plan_tier, COUNT(*) AS grants, SUM(total_credits) AS credits
  FROM usage_credit_grants
 GROUP BY grant_type, status, plan_tier
 ORDER BY grant_type, status, plan_tier
"""


def run_sql_file(engine, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    # The files manage their own BEGIN/COMMIT blocks.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.execute(text(sql))


def print_preview(engine, sql: str) -> dict:
    with engine.connect() as connection:
        preview = dict(connection.execute(text(sql)).mappings().one())
    print("before:")
    for key, value in preview.items():
        print(f"  {key:<28} {value}")
    return preview


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "step",
        choices=("schema", "data"),
        help="schema reshapes tables; data grants credits to existing members",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what the step would touch without writing",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="run the data step even if no shadow charges were recorded",
    )
    args = parser.parse_args()

    engine = get_engine()
    if engine.dialect.name != "postgresql":
        print(f"refusing to run: expected postgresql, got {engine.dialect.name}")
        return 1

    if args.step == "schema":
        print_preview(engine, SCHEMA_PREVIEW_SQL)
        if args.dry_run:
            print("\ndry run, nothing written")
            return 0
        run_sql_file(engine, SCHEMA_FILE)
        print("\nschema applied; deploy with BILLING_CREDITS_ENFORCE=false next")
        return 0

    preview = print_preview(engine, DATA_PREVIEW_SQL)
    if not preview["shadow_charges_recorded"] and not args.force:
        print(
            "\nrefusing to run: no shadow charges recorded, so the pricing model "
            "has not been validated against real traffic yet.\n"
            "Run the shadow window first, or pass --force if this is a fresh "
            "environment with no traffic."
        )
        return 1

    if args.dry_run:
        print("\ndry run, nothing written")
        return 0

    run_sql_file(engine, DATA_FILE)

    with engine.connect() as connection:
        print("\nafter:")
        for row in connection.execute(text(GRANT_SUMMARY_SQL)).mappings():
            print(
                f"  {row['grant_type']:<10} {row['status']:<6} {row['plan_tier']:<14} "
                f"grants={row['grants']:<6} credits={row['credits'] or 0:,}"
            )

    print("\ngrants issued; flip BILLING_CREDITS_ENFORCE=true now")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
