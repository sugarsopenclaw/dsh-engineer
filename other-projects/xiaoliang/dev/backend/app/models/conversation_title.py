from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ConversationTitleRequest(BaseModel):
    first_user_message: str = Field(min_length=1, max_length=8_000)

    @field_validator("first_user_message")
    @classmethod
    def normalize_first_user_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("first_user_message cannot be empty")
        return normalized


class ConversationTitleResult(BaseModel):
    title: str = Field(min_length=1, max_length=24)
