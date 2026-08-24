"""Decide whether the credit ledger is safe to enforce.

Run this after the shadow window (``BILLING_CREDITS_ENFORCE=false``), which
prices every model call and writes a ``status='shadow'`` ledger row without
touching customer balances. This script answers the three questions that gate
the enforcement flip:

1. Integrity  - does every shadow charge still reprice to the same number the
                ledger recorded? A mismatch means the pricing engine changed
                under us and the ledger cannot be trusted.
2. Coverage   - did we actually price the traffic, or did calls slip through
                unbilled (a stream that died before its usage chunk, a purpose
                the gateway forgot to meter)?
3. Blast radius - if enforcement were on today, who runs out, and how soon?

    python scripts/reconcile_shadow_credits.py --days 7
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.security import utcnow
from app.domain.billing.policies import ensure_utc, grant_remaining
from app.domain.billing.pricing import (
    CREDIT_UNIT_PRICE_RMB,
    PRICING_VERSION,
    credits_for_usage,
)
from app.domain.billing.products import list_products
from app.schemas.agent_usage_call import AgentUsageCall
from app.schemas.organization import Organization
from app.schemas.usage_charge import CHARGE_STATUS_SHADOW, UsageCharge
from app.schemas.usage_credit_grant import UsageCreditGrant

# An org burning less than this in the whole window is too quiet to extrapolate
# a runway from; reporting "0 days left" for them would be noise.
MIN_CREDITS_FOR_RUNWAY = 10


@dataclass
class OrgUsage:
    organization_id: str
    name: str = ""
    plan_tier: str = "free"
    credits: int = 0
    calls: int = 0
    balance: int = 0
    active_days: set = field(default_factory=set)

    def daily_burn(self, window_days: int) -> float:
        days = max(1, min(window_days, len(self.active_days) or window_days))
        return self.credits / days

    def runway_days(self, window_days: int) -> float | None:
        if self.credits < MIN_CREDITS_FOR_RUNWAY:
            return None
        burn = self.daily_burn(window_days)
        if burn <= 0:
            return None
        return self.balance / burn


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def check_integrity(session, since) -> tuple[int, int, list[str]]:
    """Reprice every shadow charge and report drift."""
    charges = session.scalars(
        select(UsageCharge)
        .where(UsageCharge.status == CHARGE_STATUS_SHADOW)
        .where(UsageCharge.created_at >= since)
    ).all()

    mismatches: list[str] = []
    stale_version = 0
    for charge in charges:
        if charge.pricing_version != PRICING_VERSION:
            stale_version += 1
            continue
        # The ledger stores tokens already split into billing buckets, so
        # repricing must feed them back in the same shape.
        recomputed = credits_for_usage(
            input_tokens=charge.input_tokens + charge.cached_input_tokens,
            output_tokens=charge.output_tokens,
            cache_read_tokens=charge.cached_input_tokens,
            cache_write_tokens=charge.cache_write_tokens,
            provider_model=charge.provider_model,
        )
        if recomputed.micro_credits != charge.micro_credits:
            mismatches.append(
                f"{charge.id}: ledger={charge.micro_credits} recomputed={recomputed.micro_credits}"
            )

    return len(charges), stale_version, mismatches


def check_coverage(session, since) -> tuple[int, int, dict[str, int]]:
    """Find finished model calls that consumed tokens but produced no charge."""
    rows = session.execute(
        select(
            AgentUsageCall.id,
            AgentUsageCall.call_purpose,
            AgentUsageCall.total_tokens,
            UsageCharge.id,
        )
        .outerjoin(UsageCharge, UsageCharge.agent_usage_call_id == AgentUsageCall.id)
        .where(AgentUsageCall.started_at >= since)
        .where(AgentUsageCall.status != "started")
    ).all()

    billable = 0
    unbilled = 0
    unbilled_by_purpose: dict[str, int] = defaultdict(int)
    for _call_id, purpose, total_tokens, charge_id in rows:
        if (total_tokens or 0) <= 0:
            continue
        billable += 1
        if charge_id is None:
            unbilled += 1
            unbilled_by_purpose[purpose or "unknown"] += 1

    return billable, unbilled, dict(unbilled_by_purpose)


def collect_org_usage(session, since, window_days: int) -> list[OrgUsage]:
    usage: dict[str, OrgUsage] = {}

    rows = session.execute(
        select(
            UsageCharge.organization_id,
            func.date(UsageCharge.created_at),
            func.sum(UsageCharge.credits),
            func.count(UsageCharge.id),
        )
        .where(UsageCharge.status == CHARGE_STATUS_SHADOW)
        .where(UsageCharge.created_at >= since)
        .group_by(UsageCharge.organization_id, func.date(UsageCharge.created_at))
    ).all()

    for organization_id, day, credits, calls in rows:
        entry = usage.setdefault(organization_id, OrgUsage(organization_id=organization_id))
        entry.credits += int(credits or 0)
        entry.calls += int(calls or 0)
        entry.active_days.add(day)

    if not usage:
        return []

    now = utcnow()
    grants = session.scalars(
        select(UsageCreditGrant)
        .where(UsageCreditGrant.organization_id.in_(usage.keys()))
        .where(UsageCreditGrant.status == "active")
    ).all()
    for grant in grants:
        if ensure_utc(grant.period_ends_at) <= now:
            continue
        entry = usage.get(grant.organization_id)
        if entry is None:
            continue
        entry.balance += grant_remaining(
            total_credits=grant.total_credits,
            used_credits=grant.used_credits,
        )

    organizations = session.scalars(
        select(Organization).where(Organization.id.in_(usage.keys()))
    ).all()
    for organization in organizations:
        entry = usage.get(organization.id)
        if entry is not None:
            entry.name = organization.name
            entry.plan_tier = organization.plan_tier

    return sorted(usage.values(), key=lambda item: item.credits, reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7, help="shadow window in days")
    parser.add_argument("--top", type=int, default=15, help="how many orgs to list")
    args = parser.parse_args()

    window_days = max(1, args.days)
    since = utcnow() - timedelta(days=window_days)
    settings = get_settings()

    print(f"pricing version : {PRICING_VERSION}")
    print(f"enforcement     : {'ON' if settings.billing_credits_enforce else 'OFF (shadow)'}")
    print(f"window          : last {window_days} days\n")

    if settings.billing_credits_enforce:
        print("! enforcement is already on; shadow rows below are historical\n")

    with SessionLocal() as session:
        total, stale_version, mismatches = check_integrity(session, since)
        print("1. integrity")
        print(f"  shadow charges     : {total:,}")
        print(f"  stale pricing rows : {stale_version:,}")
        print(f"  repricing mismatch : {len(mismatches):,}")
        for line in mismatches[:10]:
            print(f"    {line}")
        if total == 0:
            print("\n  no shadow charges recorded; run the shadow window before enforcing")
            return 1

        billable, unbilled, unbilled_by_purpose = check_coverage(session, since)
        coverage = (billable - unbilled) / billable * 100 if billable else 0.0
        print("\n2. coverage")
        print(f"  calls with tokens  : {billable:,}")
        print(f"  never charged      : {unbilled:,} ({100 - coverage:.2f}%)")
        for purpose, count in sorted(
            unbilled_by_purpose.items(), key=lambda item: item[1], reverse=True
        ):
            print(f"    {purpose:<16} {count:,}")

        orgs = collect_org_usage(session, since, window_days)

    total_credits = sum(item.credits for item in orgs)
    retail = total_credits * CREDIT_UNIT_PRICE_RMB
    provider = retail / max(1e-9, float(settings.billing_credit_markup))

    print("\n3. blast radius")
    print(f"  active orgs        : {len(orgs):,}")
    print(f"  credits burned     : {total_credits:,}")
    print(f"  retail value       : Y{retail:,.2f}")
    print(f"  provider cost      : Y{provider:,.2f}")
    if retail > 0:
        print(f"  gross margin       : {(retail - provider) / retail * 100:.1f}%")

    burns = [item.daily_burn(window_days) for item in orgs]
    print("\n  credits/day per org")
    print(f"    p50 {percentile(burns, 0.50):>10,.0f}")
    print(f"    p90 {percentile(burns, 0.90):>10,.0f}")
    print(f"    max {max(burns) if burns else 0:>10,.0f}")

    runways = [(item, item.runway_days(window_days)) for item in orgs]
    blocked_now = [item for item, _ in runways if item.balance <= 0]
    # Cumulative, so each line reads as "this many orgs are affected by then".
    within_7 = [item for item, days in runways if days is not None and days <= 7]
    within_30 = [item for item, days in runways if days is not None and days <= 30]

    print("\n  if enforcement were on today")
    print(f"    blocked immediately : {len(blocked_now):,}")
    print(f"    out of credits <= 7d  : {len(within_7):,}")
    print(f"    out of credits <=30d  : {len(within_30):,}")

    print(f"\n  top {args.top} consumers")
    print(
        f"    {'organization':<28} {'tier':<14} {'credits':>10} "
        f"{'calls':>7} {'balance':>10} {'runway':>8}"
    )
    for item in orgs[: args.top]:
        runway = item.runway_days(window_days)
        runway_text = "-" if runway is None else f"{runway:.1f}d"
        name = (item.name or item.organization_id)[:27]
        print(
            f"    {name:<28} {item.plan_tier:<14} {item.credits:>10,} "
            f"{item.calls:>7,} {item.balance:>10,} {runway_text:>8}"
        )

    print("\n  pack runway at the p90 burn rate")
    p90_burn = percentile(burns, 0.90)
    for product in list_products():
        if p90_burn > 0:
            print(
                f"    {product.name:<14} {product.credits:>8,} credits -> "
                f"{product.credits / p90_burn:>7.0f} days"
            )

    ready = not mismatches and stale_version == 0 and unbilled == 0
    print("\nverdict: " + ("safe to enforce" if ready else "NOT ready - resolve the above first"))
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
