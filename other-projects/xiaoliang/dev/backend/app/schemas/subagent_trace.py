from __future__ import annotations

from datetime import datetime

from sqlalchemy import BIGINT, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class SubagentTraceArchive(IdMixin, TimestampMixin, Base):
    __tablename__ = "subagent_trace_archives"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "child_run_id",
            name="uq_subagent_trace_archives_org_child_run",
        ),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_archive_id: Mapped[str] = mapped_column(
        ForeignKey("project_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    archived_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    child_run_id: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_session_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    parent_prompt_id: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_pi_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    parent_pi_entry_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    client_run_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    agent_type: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    started_at_client: Mapped[str] = mapped_column(String(64), nullable=False)
    finished_at_client: Mapped[str] = mapped_column(String(64), nullable=False)
    usage_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    tool_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    artifact_refs_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    trace_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trace_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    trace_size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False, index=True)
    upload_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    training_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SubagentTraceBlobArchive(IdMixin, TimestampMixin, Base):
    __tablename__ = "subagent_trace_blob_archives"
    __table_args__ = (
        UniqueConstraint(
            "trace_archive_id",
            "sha256",
            name="uq_subagent_trace_blob_archives_trace_sha",
        ),
    )

    trace_archive_id: Mapped[str] = mapped_column(
        ForeignKey("subagent_trace_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False, index=True)
    upload_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
