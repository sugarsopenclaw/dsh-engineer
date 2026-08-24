from __future__ import annotations

from datetime import datetime
from pathlib import PurePath
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, Field, field_validator


def ensure_safe_file_name(value: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError("file name is required")
    if PurePath(text).name != text or "/" in text or "\\" in text:
        raise ValueError("file name must not contain path separators")
    if text in {".", ".."}:
        raise ValueError("file name is invalid")
    return text


class DesktopReleaseArtifactIn(BaseModel):
    kind: Literal["installer", "blockmap"]
    file_name: str = Field(min_length=1, max_length=260)
    size_bytes: int = Field(gt=0)
    sha512: str | None = None
    sha256: str | None = Field(default=None, min_length=64, max_length=64)
    object_key: str | None = None
    public_url: AnyHttpUrl
    content_type: str | None = Field(default=None, max_length=120)

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        return ensure_safe_file_name(value)


class DesktopReleaseArtifactOut(DesktopReleaseArtifactIn):
    id: int


class DesktopReleaseIn(BaseModel):
    platform: Literal["windows"] = "windows"
    arch: Literal["x64"] = "x64"
    channel: Literal["stable", "beta"] = "stable"
    version: str = Field(min_length=1, max_length=64)
    status: Literal["draft", "published", "paused", "yanked"] = "draft"
    staging_percentage: int | None = Field(default=None, ge=0, le=100)
    notes: list[str] = Field(default_factory=list)
    release_date: datetime | None = None
    artifacts: list[DesktopReleaseArtifactIn] = Field(min_length=1)


class DesktopReleasePatchIn(BaseModel):
    status: Literal["draft", "published", "paused", "yanked"] | None = None
    staging_percentage: int | None = Field(default=None, ge=0, le=100)
    notes: list[str] | None = None
    release_date: datetime | None = None


class DesktopReleaseOut(BaseModel):
    id: int
    platform: str
    arch: str
    channel: str
    version: str
    status: str
    staging_percentage: int | None = None
    notes: list[str] = Field(default_factory=list)
    release_date: datetime | None = None
    created_at: datetime
    updated_at: datetime
    artifacts: list[DesktopReleaseArtifactOut] = Field(default_factory=list)


class DesktopUpdatePolicyIn(BaseModel):
    minimum_supported_version: str | None = Field(default=None, max_length=64)
    force_update_message: str | None = None
    enabled: bool = True


class DesktopUpdatePolicyOut(BaseModel):
    id: int
    platform: str
    arch: str
    channel: str
    minimum_supported_version: str | None = None
    force_update_message: str | None = None
    enabled: bool
    created_at: datetime
    updated_at: datetime


class DesktopUpdatePolicyCheckIn(BaseModel):
    platform: Literal["windows"] = "windows"
    arch: Literal["x64"] = "x64"
    channel: Literal["stable", "beta"] = "stable"
    current_version: str = Field(min_length=1, max_length=64)
    client_id: str | None = Field(default=None, max_length=64)


class DesktopUpdatePolicyCheckOut(BaseModel):
    latest_version: str | None = None
    update_available: bool
    force_update: bool
    is_supported: bool
    feed_url: str | None = None
    notes: list[str] = Field(default_factory=list)
    minimum_supported_version: str | None = None
    force_update_message: str | None = None
