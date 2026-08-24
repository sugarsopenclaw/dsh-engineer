from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin

GRANT_TYPE_PURCHASE = "purchase"
GRANT_TYPE_SIGNUP = "signup"
GRANT_TYPE_MIGRATION = "migration"
GRANT_TYPE_MANUAL = "manual"

GRANT_STATUS_ACTIVE = "active"
GRANT_STATUS_VOID = "void"


class UsageCreditGrant(IdMixin, TimestampMixin, Base):
    """A pool of credits an organization may spend until it expires.

    Uniqueness of purchase/signup/migration grants is enforced by partial
    unique indexes created in the SQL migration; SQLAlchemy cannot express
    those portably, so they are intentionally absent from __table_args__.
    """

    __tablename__ = "usage_credit_grants"
    __table_args__ = (
        Index("ix_usage_credit_grants_org_period", "organization_id", "period_ends_at"),
        Index("ix_usage_credit_grants_org_status", "organization_id", "status"),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_order_id: Mapped[str | None] = mapped_column(
        ForeignKey("billing_orders.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    grant_type: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default=GRANT_TYPE_PURCHASE,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=GRANT_STATUS_ACTIVE,
    )
    plan_tier: Mapped[str] = mapped_column(String(32), nullable=False)
    total_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    used_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    organization = relationship("Organization", back_populates="usage_credit_grants")
    source_order = relationship("BillingOrder", back_populates="usage_credit_grants")
    allocations = relationship("UsageChargeAllocation", back_populates="usage_credit_grant")
