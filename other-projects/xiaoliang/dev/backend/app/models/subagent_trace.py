from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SubagentTraceUsageInput(BaseModel):
    input: int = Field(default=0, ge=0)
    output: int = Field(default=0, ge=0)
    cache_read: int = Field(default=0, ge=0)
    cache_write: int = Field(default=0, ge=0)
    total: int = Field(default=0, ge=0)
    cost: float = Field(default=0, ge=0)


class SubagentTraceBlobManifestItem(BaseModel):
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    size_bytes: int = Field(ge=1, le=20 * 1024 * 1024)
    mime_type: Literal["image/png", "image/jpeg", "image/webp", "image/gif"]

    @field_validator("sha256")
    @classmethod
    def normalize_blob_sha256(cls, value: str) -> str:
        return value.lower()


class SubagentTracePrepareRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    project_name: str = Field(min_length=1, max_length=255)
    project_description: str = Field(default="", max_length=20_000)
    project_root_name: str | None = Field(default=None, max_length=255)
    child_run_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
    parent_session_id: str = Field(min_length=1, max_length=128)
    parent_prompt_id: str = Field(min_length=1, max_length=128)
    parent_pi_session_id: str | None = Field(default=None, max_length=128)
    parent_pi_entry_id: str | None = Field(default=None, max_length=128)
    client_run_id: str = Field(min_length=1, max_length=128)
    agent_type: str = Field(min_length=1, max_length=128)
    status: Literal["completed", "failed", "cancelled"]
    model: str = Field(min_length=1, max_length=128)
    started_at: str = Field(min_length=1, max_length=64)
    finished_at: str = Field(min_length=1, max_length=64)
    usage: SubagentTraceUsageInput = Field(default_factory=SubagentTraceUsageInput)
    tool_call_count: int = Field(default=0, ge=0)
    artifact_refs: list[str] = Field(default_factory=list, max_length=64)
    error_code: str | None = Field(default=None, max_length=64)
    trace_schema_version: int = Field(ge=1, le=100)
    event_count: int = Field(ge=1)
    trace_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    trace_size_bytes: int = Field(ge=1)
    # Archival is not training consent. A future consent workflow must use a separate endpoint.
    training_consent: Literal[False] = False
    blobs: list[SubagentTraceBlobManifestItem] = Field(default_factory=list, max_length=64)

    @field_validator(
        "local_project_id",
        "project_name",
        "parent_session_id",
        "parent_prompt_id",
        "client_run_id",
        "agent_type",
        "model",
        "started_at",
        "finished_at",
    )
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value is required")
        return normalized

    @field_validator("parent_pi_session_id", "parent_pi_entry_id")
    @classmethod
    def normalize_optional_pi_link(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("trace_sha256")
    @classmethod
    def normalize_sha256(cls, value: str) -> str:
        return value.lower()

    @field_validator("artifact_refs")
    @classmethod
    def validate_artifact_refs(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            normalized = value.strip()
            if not normalized or len(normalized) > 2048 or normalized.startswith(("/", "\\")):
                raise ValueError("artifact ref must be a bounded project-relative path")
            result.append(normalized)
        return list(dict.fromkeys(result))


class SubagentTracePrepareData(BaseModel):
    trace_archive_id: str
    child_run_id: str
    trace_sha256: str
    upload_required: bool
    storage_key: str
    upload_url: str | None = None
    required_headers: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int | None = None
    blob_targets: list["SubagentTraceBlobUploadTarget"] = Field(default_factory=list)


class SubagentTraceBlobUploadTarget(BaseModel):
    sha256: str
    upload_required: bool
    storage_key: str
    upload_url: str | None = None
    required_headers: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int | None = None


class SubagentTraceConfirmRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    child_run_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
    trace_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    blob_sha256s: list[str] = Field(default_factory=list, max_length=64)

    @field_validator("trace_sha256")
    @classmethod
    def normalize_confirm_sha256(cls, value: str) -> str:
        return value.lower()

    @field_validator("blob_sha256s")
    @classmethod
    def normalize_blob_sha256s(cls, values: list[str]) -> list[str]:
        normalized = [value.lower() for value in values]
        if any(len(value) != 64 or any(char not in "0123456789abcdef" for char in value) for value in normalized):
            raise ValueError("blob_sha256s contains an invalid digest")
        return list(dict.fromkeys(normalized))


class SubagentTraceBlobConfirmationResult(BaseModel):
    sha256: str
    status: Literal["ready", "missing", "mismatch", "failed"]
    storage_key: str
    error: str | None = None


class SubagentTraceConfirmData(BaseModel):
    trace_archive_id: str
    child_run_id: str
    trace_sha256: str
    status: Literal["ready", "missing", "mismatch", "failed"]
    storage_key: str
    error: str | None = None
    blobs: list[SubagentTraceBlobConfirmationResult] = Field(default_factory=list)
