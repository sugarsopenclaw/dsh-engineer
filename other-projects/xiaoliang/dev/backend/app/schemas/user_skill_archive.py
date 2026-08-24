from __future__ import annotations

from datetime import datetime

from sqlalchemy import BIGINT, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin, utcnow


class UserSkillArchive(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_skill_archives"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "owner_user_id",
            name="uq_user_skill_archives_org_owner",
        ),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    last_synced_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    sync_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    active_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    last_completed_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skill_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False, default=0)
    skills_root_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_scanned_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserSkillArchiveEntry(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_skill_archive_entries"
    __table_args__ = (
        UniqueConstraint(
            "archive_id",
            "slug",
            name="uq_user_skill_archive_entries_archive_slug",
        ),
    )

    archive_id: Mapped[str] = mapped_column(
        ForeignKey("user_skill_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    validation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="invalid")
    validation_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at_client: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seen_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class UserSkillArchiveFile(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_skill_archive_files"
    __table_args__ = (
        UniqueConstraint(
            "archive_id",
            "normalized_path",
            name="uq_user_skill_archive_files_archive_path",
        ),
    )

    archive_id: Mapped[str] = mapped_column(
        ForeignKey("user_skill_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    archived_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    skill_slug: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
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
