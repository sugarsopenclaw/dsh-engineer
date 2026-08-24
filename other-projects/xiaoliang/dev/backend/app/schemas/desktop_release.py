from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.schemas.base import utcnow


class DesktopRelease(Base):
    __tablename__ = "desktop_releases"
    __table_args__ = (
        UniqueConstraint("platform", "arch", "channel", "version", name="uq_desktop_releases_target_version"),
        Index("ix_desktop_releases_target_status", "platform", "arch", "channel", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="windows")
    arch: Mapped[str] = mapped_column(String(32), nullable=False, default="x64")
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="stable")
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    staging_percentage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    release_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    artifacts: Mapped[list[DesktopReleaseArtifact]] = relationship(
        back_populates="release",
        cascade="all, delete-orphan",
        order_by="DesktopReleaseArtifact.id",
    )
    update_events: Mapped[list[DesktopUpdateEvent]] = relationship(back_populates="release")


class DesktopReleaseArtifact(Base):
    __tablename__ = "desktop_release_artifacts"
    __table_args__ = (
        UniqueConstraint("release_id", "file_name", name="uq_desktop_release_artifacts_release_file"),
        Index("ix_desktop_release_artifacts_file_name", "file_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    release_id: Mapped[int] = mapped_column(ForeignKey("desktop_releases.id"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    file_name: Mapped[str] = mapped_column(String(260), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha512: Mapped[str | None] = mapped_column(Text, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    public_url: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    release: Mapped[DesktopRelease] = relationship(back_populates="artifacts")
    update_events: Mapped[list[DesktopUpdateEvent]] = relationship(back_populates="artifact")


class DesktopUpdatePolicy(Base):
    __tablename__ = "desktop_update_policies"
    __table_args__ = (
        UniqueConstraint("platform", "arch", "channel", name="uq_desktop_update_policies_target"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="windows")
    arch: Mapped[str] = mapped_column(String(32), nullable=False, default="x64")
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="stable")
    minimum_supported_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    force_update_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


class DesktopUpdateEvent(Base):
    __tablename__ = "desktop_update_events"
    __table_args__ = (
        Index("ix_desktop_update_events_target_created_at", "platform", "arch", "channel", "created_at"),
        Index("ix_desktop_update_events_type_created_at", "event_type", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    arch: Mapped[str] = mapped_column(String(32), nullable=False)
    channel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    current_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
    release_id: Mapped[int | None] = mapped_column(ForeignKey("desktop_releases.id"), nullable=True)
    artifact_id: Mapped[int | None] = mapped_column(ForeignKey("desktop_release_artifacts.id"), nullable=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    referer: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    release: Mapped[DesktopRelease | None] = relationship(back_populates="update_events")
    artifact: Mapped[DesktopReleaseArtifact | None] = relationship(back_populates="update_events")
