from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field


class BillingProductView(BaseModel):
    id: str
    plan_tier: str
    name: str
    description: str
    amount_fen: int
    credits: int
    duration_days: int
    # Lets the client render "cheaper per credit" without duplicating the math.
    unit_price_rmb: float = 0.0
    discount_percent: int = 0


class QuotaSummaryView(BaseModel):
    """Credit balance for an organization.

    ``quota_*`` fields are deprecated aliases of the credit fields, kept so
    desktop builds released before the credits migration keep working.
    """

    plan_tier: str
    credits_remaining: int = 0
    credits_total: int = 0
    credits_expiring_at: datetime | None = None
    low_balance_threshold: int = 0

    quota_remaining: int = 0
    quota_limit: int = 0
    quota_period_ends_at: datetime | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def free_daily_used(self) -> int:
        return 0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def free_daily_limit(self) -> int:
        return 0


class ModelCreditRatesView(BaseModel):
    uncached_input_micro: int
    cached_input_micro: int
    cache_write_micro: int
    output_micro: int


class CreditPricingView(BaseModel):
    pricing_version: str
    credit_unit_price_rmb: float
    micro_per_credit: int
    models: dict[str, ModelCreditRatesView]


class CreateWeChatNativeOrderRequest(BaseModel):
    product_id: str = Field(..., min_length=1, max_length=64)


class WeChatNativeOrderView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_id: str
    product_id: str
    plan_tier: str
    status: str
    out_trade_no: str
    amount_fen: int
    code_url: str | None = None
    expires_at: datetime
    paid_at: datetime | None = None
    poll_after_seconds: int = 2
    quota: QuotaSummaryView | None = None


class BillingOrderStatusView(BaseModel):
    order_id: str
    product_id: str
    plan_tier: str
    status: str
    out_trade_no: str
    amount_fen: int
    expires_at: datetime
    paid_at: datetime | None = None
    quota: QuotaSummaryView
