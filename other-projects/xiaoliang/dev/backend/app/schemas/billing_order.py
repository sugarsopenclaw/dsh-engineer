from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class BillingOrder(IdMixin, TimestampMixin, Base):
    __tablename__ = "billing_orders"
    __table_args__ = (
        Index("ix_billing_orders_org_created_at", "organization_id", "created_at"),
        Index("ix_billing_orders_org_status", "organization_id", "status"),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    product_id: Mapped[str] = mapped_column(String(64), nullable=False)
    plan_tier: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_fen: Mapped[int] = mapped_column(Integer, nullable=False)
    # Snapshot the entitlement at order creation. Product catalog values may
    # change while a WeChat order is still pending.
    credits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="CNY")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    out_trade_no: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    transaction_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    code_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_notify_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    organization = relationship("Organization", back_populates="billing_orders")
    usage_credit_grants = relationship("UsageCreditGrant", back_populates="source_order")
