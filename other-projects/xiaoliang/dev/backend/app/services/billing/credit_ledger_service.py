"""Credit balance and spending ledger.

Billing is post-paid: token usage is only known after the provider responds, so
a call is authorized on "balance > 0" and charged afterwards for what it really
consumed. The last call of a depleted balance can therefore overdraw; the
uncovered part is recorded as ``unbacked_credits`` rather than pushing a grant
negative, and the next authorization fails.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import utcnow
from app.domain.billing.errors import BillingErrorCode
from app.domain.billing.policies import (
    FREE_PLAN_TIER,
    LOW_BALANCE_WARNING_CREDITS,
    effective_plan_tier,
    ensure_utc,
    grant_remaining,
    sort_grant_key,
)
from app.domain.billing.pricing import CreditCost, credits_for_usage
from app.domain.billing.products import list_products
from app.models.billing import QuotaSummaryView
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.usage_charge_repository import UsageChargeRepository
from app.repositories.usage_credit_grant_repository import UsageCreditGrantRepository
from app.schemas.organization import Organization
from app.schemas.usage_charge import (
    CHARGE_STATUS_CHARGED,
    CHARGE_STATUS_SHADOW,
    CHARGE_TYPE_GATEWAY,
    UsageCharge,
    UsageChargeAllocation,
)
from app.schemas.usage_credit_grant import UsageCreditGrant

MAX_IDEMPOTENCY_KEY_LENGTH = 160


@dataclass(frozen=True)
class GrantBalance:
    grant: UsageCreditGrant
    remaining: int


class CreditLedgerService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.organizations = OrganizationRepository(session)
        self.grants = UsageCreditGrantRepository(session)
        self.charges = UsageChargeRepository(session)
        self.settings = get_settings()

    @property
    def enforce(self) -> bool:
        """When false the ledger records charges but never blocks a call."""
        return bool(self.settings.billing_credits_enforce)

    # ------------------------------------------------------------------
    # Balance
    # ------------------------------------------------------------------

    def active_grant_balances(self, organization_id: str, now: datetime) -> list[GrantBalance]:
        balances = [
            GrantBalance(
                grant=grant,
                remaining=grant_remaining(
                    total_credits=grant.total_credits,
                    used_credits=grant.used_credits,
                ),
            )
            for grant in self.grants.list_active(organization_id, now)
        ]
        return sorted(
            balances,
            key=lambda item: sort_grant_key(item.grant.period_ends_at, item.grant.id),
        )

    def remaining_credits(self, organization_id: str, now: datetime | None = None) -> int:
        now = ensure_utc(now or utcnow())
        return sum(item.remaining for item in self.active_grant_balances(organization_id, now))

    def quota_summary(
        self,
        organization_id: str,
        now: datetime | None = None,
    ) -> QuotaSummaryView:
        now = ensure_utc(now or utcnow())
        balances = self.active_grant_balances(organization_id, now)
        plan_tier = effective_plan_tier({item.grant.plan_tier for item in balances})

        organization = self.organizations.get_by_id(organization_id)
        if organization is not None:
            organization.plan_tier = plan_tier

        remaining = sum(item.remaining for item in balances)
        total = sum(int(item.grant.total_credits) for item in balances)
        # Show when credits actually start disappearing, i.e. the soonest expiry
        # among pools that still hold something.
        spendable = [item for item in balances if item.remaining > 0]
        expiring_at = (
            min(ensure_utc(item.grant.period_ends_at) for item in spendable) if spendable else None
        )

        return QuotaSummaryView(
            plan_tier=plan_tier,
            credits_remaining=remaining,
            credits_total=total,
            credits_expiring_at=expiring_at,
            low_balance_threshold=LOW_BALANCE_WARNING_CREDITS,
            quota_remaining=remaining,
            quota_limit=total,
            quota_period_ends_at=expiring_at,
        )

    def sync_plan_tier(self, organization: Organization, now: datetime | None = None) -> str:
        now = ensure_utc(now or utcnow())
        balances = self.active_grant_balances(organization.id, now)
        plan_tier = effective_plan_tier({item.grant.plan_tier for item in balances})
        organization.plan_tier = plan_tier
        self.session.flush()
        return plan_tier

    # ------------------------------------------------------------------
    # Authorization
    # ------------------------------------------------------------------

    def assert_can_spend(self, organization_id: str, now: datetime | None = None) -> int:
        """Authorize a model call. Returns the remaining balance."""
        now = ensure_utc(now or utcnow())
        remaining = self.remaining_credits(organization_id, now)
        if remaining > 0 or not self.enforce:
            return remaining
        raise self.quota_exceeded_error(organization_id, now)

    def quota_exceeded_error(self, organization_id: str, now: datetime) -> AppError:
        summary = self.quota_summary(organization_id, now)
        return AppError(
            402,
            "算力额度不足，请购买算力包后继续使用。",
            error_code=BillingErrorCode.QUOTA_EXCEEDED,
            details={
                "plan_tier": summary.plan_tier,
                "credits_remaining": summary.credits_remaining,
                "credits_total": summary.credits_total,
                "credits_expiring_at": (
                    summary.credits_expiring_at.isoformat()
                    if summary.credits_expiring_at
                    else None
                ),
                # Kept so older desktop builds can still read the payload.
                "quota_remaining": summary.credits_remaining,
                "products": [
                    {
                        "id": product.id,
                        "plan_tier": product.plan_tier,
                        "name": product.name,
                        "amount_fen": product.amount_fen,
                        "credits": product.credits,
                        "duration_days": product.duration_days,
                    }
                    for product in list_products()
                ],
            },
        )

    # ------------------------------------------------------------------
    # Spending
    # ------------------------------------------------------------------

    def spend_usage(
        self,
        *,
        organization_id: str,
        actor_user_id: str | None,
        entrypoint: str,
        idempotency_key: str,
        input_tokens: int,
        output_tokens: int,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        provider_model: str | None = None,
        agent_usage_call_id: str | None = None,
        now: datetime | None = None,
    ) -> UsageCharge | None:
        cost = credits_for_usage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_write_tokens=cache_write_tokens,
            provider_model=provider_model,
        )
        return self.spend(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            entrypoint=entrypoint,
            idempotency_key=idempotency_key,
            cost=cost,
            agent_usage_call_id=agent_usage_call_id,
            now=now,
        )

    def spend(
        self,
        *,
        organization_id: str,
        actor_user_id: str | None,
        entrypoint: str,
        idempotency_key: str,
        cost: CreditCost,
        agent_usage_call_id: str | None = None,
        now: datetime | None = None,
    ) -> UsageCharge | None:
        """Record a charge and draw it down across active grants.

        Returns None when the call consumed nothing (failed or empty usage), so
        that failures never produce a zero-credit ledger entry.
        """
        normalized_key = self._normalize_idempotency_key(idempotency_key)
        if cost.credits <= 0:
            return None

        existing = self.charges.get_by_idempotency(organization_id, normalized_key)
        if existing is not None:
            return existing

        # Serialize spending per organization so concurrent calls cannot both
        # read the same balance and over-draw it.
        organization = self.session.scalar(
            select(Organization).where(Organization.id == organization_id).with_for_update()
        )
        if organization is None:
            raise AppError(404, "机构不存在。", error_code="organization_not_found")

        now = ensure_utc(now or utcnow())
        charge = UsageCharge(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            agent_usage_call_id=agent_usage_call_id,
            entrypoint=entrypoint,
            idempotency_key=normalized_key,
            charge_type=CHARGE_TYPE_GATEWAY,
            status=CHARGE_STATUS_CHARGED if self.enforce else CHARGE_STATUS_SHADOW,
            credits=cost.credits,
            micro_credits=cost.micro_credits,
            unbacked_credits=0,
            provider_model=cost.provider_model,
            pricing_version=cost.pricing_version,
            input_tokens=cost.tokens.uncached_input_tokens,
            cached_input_tokens=cost.tokens.cached_input_tokens,
            cache_write_tokens=cost.tokens.cache_write_tokens,
            output_tokens=cost.tokens.output_tokens,
        )
        try:
            self.charges.add(charge)
        except IntegrityError:
            # Lost a race on the idempotency key; the winner's charge stands.
            self.session.rollback()
            return self.charges.get_by_idempotency(organization_id, normalized_key)

        if not self.enforce:
            # Shadow runs must stay reversible: price the call, record it, but
            # leave customer balances untouched so the enforcement flip starts
            # from pristine grants.
            self.session.flush()
            return charge

        outstanding = cost.credits
        for balance in self.active_grant_balances(organization_id, now):
            if outstanding <= 0:
                break
            locked_grant = self.session.scalar(
                select(UsageCreditGrant)
                .where(UsageCreditGrant.id == balance.grant.id)
                .with_for_update()
            )
            if locked_grant is None:
                continue
            available = grant_remaining(
                total_credits=locked_grant.total_credits,
                used_credits=locked_grant.used_credits,
            )
            if available <= 0:
                continue
            applied = min(available, outstanding)
            locked_grant.used_credits = int(locked_grant.used_credits) + applied
            outstanding -= applied
            self.charges.add_allocation(
                UsageChargeAllocation(
                    usage_charge_id=charge.id,
                    usage_credit_grant_id=locked_grant.id,
                    credits=applied,
                )
            )

        charge.unbacked_credits = outstanding
        self.sync_plan_tier(organization, now)
        self.session.flush()
        return charge

    # ------------------------------------------------------------------
    # Grants
    # ------------------------------------------------------------------

    def grant_credits(
        self,
        *,
        organization_id: str,
        plan_tier: str,
        credits: int,
        grant_type: str,
        duration_days: int,
        source_order_id: str | None = None,
        now: datetime | None = None,
    ) -> UsageCreditGrant:
        from datetime import timedelta

        now = ensure_utc(now or utcnow())
        grant = UsageCreditGrant(
            organization_id=organization_id,
            source_order_id=source_order_id,
            grant_type=grant_type,
            plan_tier=plan_tier,
            total_credits=max(0, int(credits)),
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=max(1, int(duration_days))),
        )
        self.grants.add(grant)
        organization = self.organizations.get_by_id(organization_id)
        if organization is not None:
            self.sync_plan_tier(organization, now)
        return grant

    def _normalize_idempotency_key(self, idempotency_key: str) -> str:
        normalized = (idempotency_key or "").strip()
        if not normalized:
            raise AppError(
                422,
                "idempotency_key is required.",
                error_code=BillingErrorCode.INVALID_USAGE_CHARGE,
            )
        if len(normalized) > MAX_IDEMPOTENCY_KEY_LENGTH:
            raise AppError(
                422,
                "idempotency_key is too long.",
                error_code=BillingErrorCode.INVALID_USAGE_CHARGE,
            )
        return normalized


__all__ = ["CreditLedgerService", "GrantBalance", "FREE_PLAN_TIER"]
