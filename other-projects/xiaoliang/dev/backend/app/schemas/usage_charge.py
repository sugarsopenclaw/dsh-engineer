from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin

CHARGE_TYPE_GATEWAY = "gateway"
# Pre-credits rows keep their original type behind a legacy_ prefix, e.g.
# "legacy_grant" / "legacy_free". See the credits billing schema migration.
CHARGE_TYPE_LEGACY_PREFIX = "legacy_"

CHARGE_STATUS_CHARGED = "charged"
CHARGE_STATUS_SHADOW = "shadow"


class UsageCharge(IdMixin, TimestampMixin, Base):
    """One immutable credit ledger entry per billable model call.

    ``credits`` is what the call cost; ``unbacked_credits`` is the part no
    grant could cover (post-paid billing means the final call of a depleted
    balance can overdraw). Which grants actually paid is recorded in
    ``usage_charge_allocations``.
    """

    __tablename__ = "usage_charges"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_usage_charges_org_idempotency",
        ),
        Index("ix_usage_charges_org_created", "organization_id", "created_at"),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    agent_usage_call_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_usage_calls.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    entrypoint: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    charge_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=CHARGE_TYPE_GATEWAY,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=CHARGE_STATUS_CHARGED,
    )
    credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    micro_credits: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    unbacked_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pricing_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    organization = relationship("Organization", back_populates="usage_charges")
    allocations = relationship(
        "UsageChargeAllocation",
        back_populates="usage_charge",
        cascade="all, delete-orphan",
    )


class UsageChargeAllocation(IdMixin, TimestampMixin, Base):
    """How a single charge was split across the grants that funded it."""

    __tablename__ = "usage_charge_allocations"
    __table_args__ = (
        UniqueConstraint(
            "usage_charge_id",
            "usage_credit_grant_id",
            name="uq_usage_charge_allocations_charge_grant",
        ),
    )

    usage_charge_id: Mapped[str] = mapped_column(
        ForeignKey("usage_charges.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    usage_credit_grant_id: Mapped[str] = mapped_column(
        ForeignKey("usage_credit_grants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    credits: Mapped[int] = mapped_column(Integer, nullable=False)

    usage_charge = relationship("UsageCharge", back_populates="allocations")
    usage_credit_grant = relationship("UsageCreditGrant", back_populates="allocations")
