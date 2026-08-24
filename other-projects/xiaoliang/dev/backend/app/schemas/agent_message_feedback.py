from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class AgentMessageFeedback(IdMixin, TimestampMixin, Base):
    __tablename__ = "agent_message_feedback"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            "local_conversation_id",
            "local_message_id",
            name="uq_agent_message_feedback_user_message",
        ),
        CheckConstraint(
            "vote IS NULL OR vote IN ('up', 'down')",
            name="ck_agent_message_feedback_vote",
        ),
        CheckConstraint(
            "outcome IS NULL OR outcome IN ('success', 'partial', 'failure')",
            name="ck_agent_message_feedback_outcome",
        ),
        Index(
            "ix_agent_message_feedback_user_conversation",
            "user_id",
            "local_conversation_id",
            "updated_at",
        ),
        Index("ix_agent_message_feedback_client_run", "organization_id", "client_run_id"),
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
    agent_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_usage_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    client_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pi_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    pi_entry_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    local_conversation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    local_message_id: Mapped[str] = mapped_column(String(128), nullable=False)
    vote: Mapped[str | None] = mapped_column(String(16), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    issue_codes_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    feedback_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
