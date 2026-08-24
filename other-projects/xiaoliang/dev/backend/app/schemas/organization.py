from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class Organization(IdMixin, TimestampMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    plan_tier: Mapped[str] = mapped_column(String(32), nullable=False, default="free")

    memberships = relationship("Membership", back_populates="organization", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="organization")
    billing_orders = relationship("BillingOrder", back_populates="organization")
    usage_credit_grants = relationship("UsageCreditGrant", back_populates="organization")
    usage_charges = relationship("UsageCharge", back_populates="organization")
    agent_usage_runs = relationship("AgentUsageRun", back_populates="organization")