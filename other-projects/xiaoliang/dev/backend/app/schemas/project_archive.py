from __future__ import annotations

from datetime import datetime

from sqlalchemy import BIGINT, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin, utcnow


class ProjectArchive(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_archives"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "local_project_id",
            name="uq_project_archives_org_local_project",
        ),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    last_synced_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    local_project_id: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    root_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sync_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    active_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    last_completed_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False, default=0)
    last_scanned_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectArchiveFile(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_archive_files"
    __table_args__ = (
        UniqueConstraint(
            "project_archive_id",
            "normalized_path",
            name="uq_project_archive_files_project_path",
        ),
    )

    project_archive_id: Mapped[str] = mapped_column(
        ForeignKey("project_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    archived_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    extension: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    media_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    modified_at_client: Mapped[str | None] = mapped_column(String(64), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
    upload_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seen_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectArchiveConversation(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_archive_conversations"
    __table_args__ = (
        UniqueConstraint(
            "project_archive_id",
            "local_conversation_id",
            name="uq_project_archive_conversations_project_local",
        ),
    )

    project_archive_id: Mapped[str] = mapped_column(
        ForeignKey("project_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    local_conversation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="新对话")
    creation_source: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="legacy_unknown",
    )
    conversation_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="knowledge_qa")
    drawing_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    drawing_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    preferred_model_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preferred_thinking_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    context_usage_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_sync_scope: Mapped[str | None] = mapped_column(String(32), nullable=True)
    parent_local_conversation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    forked_from_entry_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_updated_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ProjectArchiveMessage(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_archive_messages"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "source_key",
            name="uq_project_archive_messages_conversation_source",
        ),
    )

    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("project_archive_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    local_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    client_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    pi_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    pi_entry_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    source_key: Mapped[str] = mapped_column(String(64), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tool_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    tool_args: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tool_result: Mapped[str] = mapped_column(Text, nullable=False, default="")
    thinking: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parts_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_created_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PiSessionArchive(IdMixin, TimestampMixin, Base):
    __tablename__ = "pi_session_archives"
    __table_args__ = (
        UniqueConstraint(
            "conversation_archive_id",
            "pi_session_id",
            "sha256",
            name="uq_pi_session_archives_conversation_session_sha",
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
    conversation_archive_id: Mapped[str] = mapped_column(
        ForeignKey("project_archive_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    archived_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    local_conversation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    pi_session_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    parent_pi_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    runtime_version: Mapped[int] = mapped_column(Integer, nullable=False)
    jsonl_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    current_leaf_entry_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    entry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False)
    source_modified_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False, index=True)
    upload_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    training_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectArchiveMessageAttachment(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_archive_message_attachments"
    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "local_attachment_id",
            name="uq_project_archive_message_attachments_message_local",
        ),
    )

    message_id: Mapped[str] = mapped_column(
        ForeignKey("project_archive_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    local_attachment_id: Mapped[str] = mapped_column(String(128), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    upload_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectDocumentAnalysis(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_document_analyses"
    __table_args__ = (
        UniqueConstraint(
            "project_file_id",
            "request_fingerprint",
            name="uq_project_document_analyses_file_request",
        ),
    )

    project_file_id: Mapped[str] = mapped_column(
        ForeignKey("project_archive_files.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requested_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    file_parsing_strategy: Mapped[str] = mapped_column(String(32), nullable=False, default="auto")
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    fallback_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    warnings_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
