from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class AgentUsageRun(IdMixin, TimestampMixin, Base):
    __tablename__ = "agent_usage_runs"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "client_run_id",
            name="uq_agent_usage_runs_org_client_run",
        ),
        Index("ix_agent_usage_runs_org_started_at", "organization_id", "started_at"),
        Index(
            "ix_agent_usage_runs_user_conversation_started",
            "user_id",
            "local_conversation_id",
            "started_at",
        ),
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
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="started")
    local_conversation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    task_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    organization = relationship("Organization", back_populates="agent_usage_runs")
    usage_calls = relationship("AgentUsageCall", back_populates="run", cascade="all, delete-orphan")
