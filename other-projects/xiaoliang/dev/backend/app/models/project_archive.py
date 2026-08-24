from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

PROJECT_ARCHIVE_MESSAGE_TEXT_MAX_CHARS = 1_000_000
PROJECT_ARCHIVE_CONVERSATION_MAX_BYTES = 8 * 1024 * 1024
PROJECT_ARCHIVE_MESSAGE_PARTS_MAX_ITEMS = 2_000


class ProjectArchiveIdentity(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20_000)
    root_name: str | None = Field(default=None, max_length=255)

    @field_validator("local_project_id", "name")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value is required")
        return value

    @field_validator("description", "root_name")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class ProjectArchiveUpsertRequest(ProjectArchiveIdentity):
    pass


class ProjectArchiveSnapshotStartRequest(ProjectArchiveIdentity):
    scanned_at: str | None = Field(default=None, max_length=64)


class ProjectArchiveProjectData(BaseModel):
    project_archive_id: str
    local_project_id: str
    sync_status: str


class ProjectArchiveSnapshotStartData(ProjectArchiveProjectData):
    snapshot_id: str


class ProjectArchiveFileManifestItem(BaseModel):
    relative_path: str = Field(min_length=1, max_length=2048)
    size_bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    modified_at: str | None = Field(default=None, max_length=64)
    media_type: str | None = Field(default=None, max_length=255)

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


class ProjectArchiveFilesPrepareRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    snapshot_id: str | None = Field(default=None, max_length=36)
    files: list[ProjectArchiveFileManifestItem] = Field(min_length=1, max_length=100)


class ProjectArchiveFileUploadTarget(BaseModel):
    relative_path: str
    sha256: str
    upload_required: bool
    upload_url: str | None = None
    required_headers: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int | None = None


class ProjectArchiveFilesPrepareData(BaseModel):
    project_archive_id: str
    targets: list[ProjectArchiveFileUploadTarget]


class ProjectArchiveFileConfirmation(BaseModel):
    relative_path: str = Field(min_length=1, max_length=2048)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")

    @field_validator("sha256")
    @classmethod
    def normalize_sha256(cls, value: str) -> str:
        return value.lower()


class ProjectArchiveFilesConfirmRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    files: list[ProjectArchiveFileConfirmation] = Field(min_length=1, max_length=100)


class ProjectArchiveFileConfirmationResult(BaseModel):
    relative_path: str
    sha256: str
    status: Literal["ready", "missing", "mismatch", "failed"]
    error: str | None = None


class ProjectArchiveFilesConfirmData(BaseModel):
    results: list[ProjectArchiveFileConfirmationResult]


class ProjectArchiveSnapshotCompleteRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    file_count: int = Field(ge=0)
    total_bytes: int = Field(ge=0)
    scan_complete: bool = True


class ProjectArchiveSnapshotCompleteData(ProjectArchiveProjectData):
    snapshot_id: str
    ready_file_count: int
    pending_file_count: int
    deleted_file_count: int
    file_count: int
    total_bytes: int
    scan_complete: bool


class ProjectArchiveMessageAttachmentInput(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")
    size_bytes: int | None = Field(default=None, ge=0)
    mime_type: str = Field(min_length=1, max_length=255)
    name: str | None = Field(default=None, max_length=512)

    @field_validator("sha256")
    @classmethod
    def normalize_attachment_sha256(cls, value: str | None) -> str | None:
        return value.lower() if value else None

    @model_validator(mode="after")
    def validate_upload_metadata_pair(self) -> ProjectArchiveMessageAttachmentInput:
        if (self.sha256 is None) != (self.size_bytes is None):
            raise ValueError("sha256 and size_bytes must be provided together")
        return self


class ProjectArchiveMessageInput(BaseModel):
    id: str | None = Field(default=None, max_length=128)
    client_run_id: str | None = Field(default=None, max_length=128)
    pi_session_id: str | None = Field(default=None, max_length=128)
    pi_entry_id: str | None = Field(default=None, max_length=128)
    source_key: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    role: Literal["user", "assistant", "tool"]
    content: str = Field(default="", max_length=PROJECT_ARCHIVE_MESSAGE_TEXT_MAX_CHARS)
    tool_name: str = Field(default="", max_length=255)
    tool_args: str = Field(default="", max_length=PROJECT_ARCHIVE_MESSAGE_TEXT_MAX_CHARS)
    tool_result: str = Field(default="", max_length=PROJECT_ARCHIVE_MESSAGE_TEXT_MAX_CHARS)
    thinking: str = Field(default="", max_length=PROJECT_ARCHIVE_MESSAGE_TEXT_MAX_CHARS)
    parts: list[dict[str, Any]] | None = Field(
        default=None,
        max_length=PROJECT_ARCHIVE_MESSAGE_PARTS_MAX_ITEMS,
    )
    attachments: list[ProjectArchiveMessageAttachmentInput] = Field(default_factory=list, max_length=32)
    created_at: str | None = Field(default=None, max_length=64)

    @field_validator("source_key")
    @classmethod
    def normalize_source_key(cls, value: str) -> str:
        return value.lower()


class ProjectArchiveConversationInput(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    title: str = Field(default="新对话", max_length=500)
    creation_source: Literal[
        "desktop_first_message",
        "desktop_new_button",
        "desktop_tree_branch",
        "feishu",
        "legacy_unknown",
    ] = "legacy_unknown"
    conversation_mode: str = Field(default="knowledge_qa", max_length=32)
    drawing_id: str | None = Field(default=None, max_length=128)
    drawing_name: str | None = Field(default=None, max_length=512)
    is_pinned: bool = False
    preferred_model_id: str | None = Field(default=None, max_length=255)
    preferred_thinking_mode: str | None = Field(default=None, max_length=32)
    context_usage: dict[str, Any] | None = None
    session_sync_scope: Literal["active_path"] | None = None
    parent_conversation_id: str | None = Field(default=None, max_length=128)
    forked_from_entry_id: str | None = Field(default=None, max_length=128)
    updated_at: str | None = Field(default=None, max_length=64)
    messages: list[ProjectArchiveMessageInput] = Field(default_factory=list, max_length=10_000)


class ProjectArchiveConversationSyncRequest(ProjectArchiveIdentity):
    conversation: ProjectArchiveConversationInput

    @model_validator(mode="after")
    def validate_payload_size(self) -> ProjectArchiveConversationSyncRequest:
        payload_bytes = len(self.model_dump_json(exclude_none=True).encode("utf-8"))
        if payload_bytes > PROJECT_ARCHIVE_CONVERSATION_MAX_BYTES:
            raise ValueError("conversation sync payload exceeds the 8MB limit")
        return self


class ProjectArchiveConversationSyncData(BaseModel):
    project_archive_id: str
    conversation_archive_id: str
    message_count: int
    attachment_count: int
    attachment_error_count: int
    attachment_uploads: list["ProjectArchiveMessageAttachmentUploadTarget"] = Field(default_factory=list)


class PiSessionArchivePrepareRequest(ProjectArchiveIdentity):
    local_conversation_id: str = Field(min_length=1, max_length=128)
    pi_session_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
    parent_pi_session_id: str | None = Field(
        default=None,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$",
    )
    runtime_version: int = Field(ge=1, le=10_000)
    jsonl_schema_version: int = Field(ge=1, le=10_000)
    current_leaf_entry_id: str | None = Field(default=None, max_length=128)
    entry_count: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    size_bytes: int = Field(ge=1)
    source_modified_at: str | None = Field(default=None, max_length=64)
    # Raw archival is separate from any future training-consent workflow.
    training_consent: Literal[False] = False

    @field_validator("local_conversation_id", "pi_session_id")
    @classmethod
    def normalize_pi_archive_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value is required")
        return normalized

    @field_validator("parent_pi_session_id", "current_leaf_entry_id", "source_modified_at")
    @classmethod
    def normalize_pi_archive_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("sha256")
    @classmethod
    def normalize_pi_archive_sha256(cls, value: str) -> str:
        return value.lower()


class PiSessionArchivePrepareData(BaseModel):
    archive_id: str
    pi_session_id: str
    sha256: str
    upload_required: bool
    storage_key: str
    upload_url: str | None = None
    required_headers: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int | None = None


class PiSessionArchiveConfirmRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    local_conversation_id: str = Field(min_length=1, max_length=128)
    pi_session_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")

    @field_validator("sha256")
    @classmethod
    def normalize_pi_archive_confirm_sha256(cls, value: str) -> str:
        return value.lower()


class PiSessionArchiveConfirmData(BaseModel):
    archive_id: str
    pi_session_id: str
    sha256: str
    status: Literal["ready", "missing", "mismatch", "failed"]
    storage_key: str
    error: str | None = None


class ProjectArchiveMessageAttachmentUploadTarget(BaseModel):
    message_source_key: str
    attachment_id: str
    sha256: str
    upload_url: str
    required_headers: dict[str, str] = Field(default_factory=dict)
    expires_in_seconds: int


class ProjectArchiveMessageAttachmentConfirmation(BaseModel):
    message_source_key: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    attachment_id: str = Field(min_length=1, max_length=128)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


class ProjectArchiveMessageAttachmentsConfirmRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    local_conversation_id: str = Field(min_length=1, max_length=128)
    attachments: list[ProjectArchiveMessageAttachmentConfirmation] = Field(min_length=1, max_length=100)


class ProjectArchiveMessageAttachmentConfirmationResult(BaseModel):
    message_source_key: str
    attachment_id: str
    status: Literal["ready", "missing", "mismatch", "failed"]
    error: str | None = None


class ProjectArchiveMessageAttachmentsConfirmData(BaseModel):
    results: list[ProjectArchiveMessageAttachmentConfirmationResult]


class ProjectDocumentAnalyzeRequest(BaseModel):
    local_project_id: str = Field(min_length=1, max_length=128)
    relative_path: str = Field(min_length=1, max_length=2048)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    instruction: str = Field(min_length=1, max_length=20_000)
    file_parsing_strategy: Literal["auto", "text_only", "text_and_images"] = "auto"
    max_chars: int = Field(default=120_000, ge=1_000, le=500_000)
    page_range: str | None = Field(default=None, max_length=512)
    sheet_names: list[str] = Field(default_factory=list, max_length=100)
    max_rows_per_sheet: int | None = Field(default=None, ge=1, le=10_000)
    max_cols_per_sheet: int | None = Field(default=None, ge=1, le=1_000)
    include_formulas: bool | None = None

    @field_validator("sha256")
    @classmethod
    def normalize_sha256(cls, value: str) -> str:
        return value.lower()


class ProjectDocumentAnalyzeData(BaseModel):
    project_archive_id: str
    project_file_id: str
    relative_path: str
    sha256: str
    model: str
    primary_model: str
    fallback_used: bool
    cached: bool
    content: str
    truncated: bool
    warnings: list[str] = Field(default_factory=list)
    usage: dict[str, Any] | None = None
