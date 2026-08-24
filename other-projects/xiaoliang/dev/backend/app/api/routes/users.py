from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_credit_ledger_service, get_current_user
from app.models.common import ApiResponse
from app.models.user import CurrentUserData, OrganizationView, QuotaSummaryData
from app.services.billing.credit_ledger_service import CreditLedgerService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=ApiResponse[CurrentUserData])
def get_me(
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    ledger: Annotated[CreditLedgerService, Depends(get_credit_ledger_service)],
) -> ApiResponse[CurrentUserData]:
    summary = ledger.quota_summary(current_user.organization.id)
    organization = OrganizationView(
        id=current_user.organization.id,
        name=current_user.organization.name,
        slug=current_user.organization.slug,
        plan_tier=summary.plan_tier,
    )
    expiring_at = (
        summary.credits_expiring_at.isoformat() if summary.credits_expiring_at else None
    )
    quota = QuotaSummaryData(
        plan_tier=summary.plan_tier,
        credits_remaining=summary.credits_remaining,
        credits_total=summary.credits_total,
        credits_expiring_at=expiring_at,
        low_balance_threshold=summary.low_balance_threshold,
        quota_remaining=summary.credits_remaining,
        quota_limit=summary.credits_total,
        quota_period_ends_at=expiring_at,
    )
    return ApiResponse(
        data=CurrentUserData(
            user=current_user.user,
            organization=organization,
            role=current_user.role,
            quota=quota,
        )
    )
