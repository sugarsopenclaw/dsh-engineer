from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin, utcnow


class SkillRelease(IdMixin, TimestampMixin, Base):
    __tablename__ = "skill_releases"

    release_channel: Mapped[str] = mapped_column(String(64), nullable=False, index=True, default="stable")
    skill_pack_version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    skill_pack_checksum: Mapped[str] = mapped_column(String(128), nullable=False)
    pack_format_version: Mapped[int] = mapped_column(nullable=False, default=1)
    pack_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pack_manifest_json: Mapped[dict | None] = mapped_column("pack_manifest", JSON, nullable=True)
    skill_count: Mapped[int] = mapped_column(nullable=False, default=0)
    min_electron_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    release_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="published", index=True)
