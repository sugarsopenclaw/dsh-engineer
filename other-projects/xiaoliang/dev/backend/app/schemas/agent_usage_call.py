from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class AgentUsageCall(IdMixin, TimestampMixin, Base):
    __tablename__ = "agent_usage_calls"
    __table_args__ = (
        Index("ix_agent_usage_calls_run_started", "agent_run_id", "started_at"),
        Index(
            "ix_agent_usage_calls_org_purpose_started",
            "organization_id",
            "call_purpose",
            "started_at",
        ),
    )

    agent_run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_usage_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_run_id: Mapped[str] = mapped_column(String(128), nullable=False)
    child_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    call_purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    model_alias: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_model: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="started")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)

    run = relationship("AgentUsageRun", back_populates="usage_calls")
