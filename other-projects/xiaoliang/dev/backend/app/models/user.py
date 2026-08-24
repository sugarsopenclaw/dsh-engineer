from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr


class OrganizationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    plan_tier: str = "free"


class UserView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str | None = None


class QuotaSummaryData(BaseModel):
    """Credit balance carried on the session payload.

    ``quota_*`` and ``free_daily_*`` are deprecated aliases retained so desktop
    builds released before the credits migration keep parsing this payload.
    """

    plan_tier: str
    credits_remaining: int = 0
    credits_total: int = 0
    credits_expiring_at: str | None = None
    low_balance_threshold: int = 0

    quota_remaining: int = 0
    quota_limit: int = 0
    quota_period_ends_at: str | None = None
    free_daily_used: int = 0
    free_daily_limit: int = 0


class CurrentUserData(BaseModel):
    user: UserView
    organization: OrganizationView
    role: str
    quota: QuotaSummaryData | None = None