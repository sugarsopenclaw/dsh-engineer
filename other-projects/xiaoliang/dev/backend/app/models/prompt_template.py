from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class _PromptTemplateWriteBase(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    content: str = Field(min_length=1, max_length=20_000)

    @field_validator("title", "content")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value is required")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class PromptTemplateCreateRequest(_PromptTemplateWriteBase):
    pass


class PromptTemplateUpdateRequest(_PromptTemplateWriteBase):
    pass


class PromptTemplateView(BaseModel):
    id: str
    title: str
    description: str | None = None
    content: str
    created_at: datetime
    updated_at: datetime
