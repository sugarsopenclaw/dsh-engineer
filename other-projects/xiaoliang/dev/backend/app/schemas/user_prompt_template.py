from __future__ import annotations

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.schemas.base import IdMixin, TimestampMixin


class UserPromptTemplate(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_prompt_templates"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            "title_normalized",
            name="uq_user_prompt_templates_user_title",
        ),
        Index(
            "ix_user_prompt_templates_user_updated",
            "user_id",
            "updated_at",
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
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    title_normalized: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
