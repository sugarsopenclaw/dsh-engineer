"""Production tables that admin schemas_orm does not map yet."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BIGINT, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from flywheel.prod import bootstrap_admin

bootstrap_admin()
from app.db import Base  # noqa: E402


class UserSkillArchive(Base):
    __tablename__ = "user_skill_archives"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(36))
    owner_user_id: Mapped[str] = mapped_column(String(36))
    last_synced_by_user_id: Mapped[str | None] = mapped_column(String(36))
    sync_status: Mapped[str] = mapped_column(String(32))
    active_snapshot_id: Mapped[str | None] = mapped_column(String(36))
    last_completed_snapshot_id: Mapped[str | None] = mapped_column(String(36))
    file_count: Mapped[int] = mapped_column(Integer)
    skill_count: Mapped[int] = mapped_column(Integer)
    total_bytes: Mapped[int] = mapped_column(BIGINT)
    skills_root_name: Mapped[str | None] = mapped_column(String(255))
    last_scanned_at: Mapped[str | None] = mapped_column(String(64))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserSkillArchiveEntry(Base):
    __tablename__ = "user_skill_archive_entries"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(36))
    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean)
    validation_status: Mapped[str] = mapped_column(String(32))
    validation_message: Mapped[str | None] = mapped_column(Text)
    file_count: Mapped[int] = mapped_column(Integer)
    updated_at_client: Mapped[str | None] = mapped_column(String(64))
    is_deleted: Mapped[bool] = mapped_column(Boolean)
    last_seen_snapshot_id: Mapped[str | None] = mapped_column(String(36))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserSkillArchiveFile(Base):
    __tablename__ = "user_skill_archive_files"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(36))
    archived_by_user_id: Mapped[str | None] = mapped_column(String(36))
    skill_slug: Mapped[str | None] = mapped_column(String(64))
    relative_path: Mapped[str] = mapped_column(Text)
    normalized_path: Mapped[str] = mapped_column(String(2048))
    filename: Mapped[str] = mapped_column(String(512))
    extension: Mapped[str] = mapped_column(String(32))
    media_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BIGINT)
    sha256: Mapped[str] = mapped_column(String(64))
    modified_at_client: Mapped[str | None] = mapped_column(String(64))
    storage_key: Mapped[str | None] = mapped_column(String(1024))
    upload_status: Mapped[str] = mapped_column(String(32))
    upload_error: Mapped[str | None] = mapped_column(Text)
    is_deleted: Mapped[bool] = mapped_column(Boolean)
    last_seen_snapshot_id: Mapped[str | None] = mapped_column(String(36))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserPromptTemplate(Base):
    __tablename__ = "user_prompt_templates"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(36))
    user_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(80))
    title_normalized: Mapped[str] = mapped_column(String(256))
    description: Mapped[str | None] = mapped_column(String(500))
    content: Mapped[str] = mapped_column(Text)
    storage_key: Mapped[str] = mapped_column(String(1024))
    content_sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ProjectDocumentAnalysis(Base):
    __tablename__ = "project_document_analyses"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_file_id: Mapped[str] = mapped_column(String(36))
    requested_by_user_id: Mapped[str | None] = mapped_column(String(36))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    instruction: Mapped[str] = mapped_column(Text)
    file_parsing_strategy: Mapped[str] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(128))
    fallback_used: Mapped[bool] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    truncated: Mapped[bool] = mapped_column(Boolean)
    warnings_json: Mapped[str | None] = mapped_column(Text)
    usage_json: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
