from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class UserSkillArchiveSnapshotStartRequest(BaseModel):
    scanned_at: str | None = Field(default=None, max_length=64)
    skills_root_name: str | None = Field(default=None, max_length=255)

    @field_validator("scanned_at", "skills_root_name")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class UserSkillArchiveSnapshotStartData(BaseModel):
    archive_id: str
    sync_status: str
    snapshot_id: str


class UserSkillArchiveFileManifestItem(BaseModel):
    relative_path: str = Field(min_length=1, max_length=2048)
    size_bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    modified_at: str | None = Field(default=None, max_length=64)
    media_type: str | None = Field(default=None, max_length=255)
    skill_slug: str | None = Field(default=None, max_length=64)

    @field_validator("relative_path")
    @classmethod
    def normalize_relative_path_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("relative_path is required")
        return value

    @field_validator("sha256")
    @classmethod
    def normalize_sha256(cls, value: str) -> str:
        return value.lower()

    @field_validator("skill_slug")
    @classmethod
    def normalize_skill_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().lower()
        return cleaned or None


class UserSkillArchiveFilesPrepareRequest(BaseModel):
    snapshot_id: str | None = Field(default=None, max_length=36)
    files: list[UserSkillArchiveFileManifestItem] = Field(min_length=1, max_length=100)


class UserSkillArchiveFileUploadTarget(BaseModel):
    relative_path: str
    sha256: str
    upload_required: bool
    upload_url: str | None = None
    required_headers: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int | None = None


class UserSkillArchiveFilesPrepareData(BaseModel):
    archive_id: str
    targets: list[UserSkillArchiveFileUploadTarget]


class UserSkillArchiveFileConfirmation(BaseModel):
    relative_path: str = Field(min_length=1, max_length=2048)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")

    @field_validator("sha256")
    @classmethod
    def normalize_sha256(cls, value: str) -> str:
        return value.lower()


class UserSkillArchiveFilesConfirmRequest(BaseModel):
    files: list[UserSkillArchiveFileConfirmation] = Field(min_length=1, max_length=100)


class UserSkillArchiveFileConfirmationResult(BaseModel):
    relative_path: str
    sha256: str
    status: Literal["ready", "missing", "mismatch", "failed"]
    error: str | None = None


class UserSkillArchiveFilesConfirmData(BaseModel):
    results: list[UserSkillArchiveFileConfirmationResult]


class UserSkillArchiveSkillInput(BaseModel):
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1024)
    enabled: bool = False
    validation_status: Literal["valid", "invalid"] = "invalid"
    validation_message: str | None = Field(default=None, max_length=2000)
    file_count: int = Field(default=0, ge=0)
    updated_at: str | None = Field(default=None, max_length=64)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name is required")
        return cleaned

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("validation_message", "updated_at")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class UserSkillArchiveSnapshotCompleteRequest(BaseModel):
    file_count: int = Field(ge=0)
    total_bytes: int = Field(ge=0)
    scan_complete: bool = True
    skills_root_name: str | None = Field(default=None, max_length=255)
    skills: list[UserSkillArchiveSkillInput] = Field(default_factory=list, max_length=500)

    @field_validator("skills_root_name")
    @classmethod
    def normalize_root_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class UserSkillArchiveSnapshotCompleteData(BaseModel):
    archive_id: str
    snapshot_id: str
    sync_status: str
    ready_file_count: int
    pending_file_count: int
    deleted_file_count: int
    skill_count: int
    file_count: int
    total_bytes: int
    scan_complete: bool
