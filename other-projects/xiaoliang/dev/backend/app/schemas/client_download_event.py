from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, utcnow


class ClientDownloadEvent(IdMixin, Base):
    __tablename__ = "client_download_events"

    version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    release_channel: Mapped[str] = mapped_column(String(64), nullable=False, index=True, default="stable")
    platform: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    referer: Mapped[str | None] = mapped_column(Text, nullable=True)
    redirect_url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
