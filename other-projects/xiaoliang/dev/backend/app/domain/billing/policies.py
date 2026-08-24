from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta, timezone

from app.domain.billing.products import PLAN_TIER_PRIORITY

DEFAULT_POLL_AFTER_SECONDS = 2
ORDER_EXPIRES_MINUTES = 15

FREE_PLAN_TIER = "free"
SHANGHAI_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")

# Credits below this leave the balance badge in a warning state so users can
# top up before a long task dies half way through.
LOW_BALANCE_WARNING_CREDITS = 500


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def shanghai_day(value: datetime) -> date:
    return ensure_utc(value).astimezone(SHANGHAI_TZ).date()


def local_day_range(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=SHANGHAI_TZ).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=SHANGHAI_TZ).astimezone(UTC)
    return start, end


def grant_remaining(*, total_credits: int, used_credits: int) -> int:
    return max(0, int(total_credits) - int(used_credits))


def effective_plan_tier(plan_tiers: set[str]) -> str:
    """Highest-value tier among the organization's active purchases."""
    ranked = sorted(
        (tier for tier in plan_tiers if tier in PLAN_TIER_PRIORITY),
        key=lambda tier: PLAN_TIER_PRIORITY[tier],
    )
    return ranked[0] if ranked else FREE_PLAN_TIER


def sort_grant_key(period_ends_at: datetime, grant_id: str) -> tuple[datetime, str]:
    """Spend order: soonest to expire first, so credits are never wasted."""
    return (ensure_utc(period_ends_at), grant_id)
