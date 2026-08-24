from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import PurePosixPath
from threading import BoundedSemaphore
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.models.project_archive import (
    ProjectArchiveConversationSyncData,
    ProjectArchiveConversationSyncRequest,
    ProjectArchiveFileConfirmationResult,
    ProjectArchiveFileUploadTarget,
    ProjectArchiveFilesConfirmData,
    ProjectArchiveFilesConfirmRequest,
    ProjectArchiveFilesPrepareData,
    ProjectArchiveFilesPrepareRequest,
    ProjectArchiveProjectData,
    ProjectArchiveMessageAttachmentConfirmationResult,
    ProjectArchiveMessageAttachmentUploadTarget,
    ProjectArchiveMessageAttachmentsConfirmData,
    ProjectArchiveMessageAttachmentsConfirmRequest,
    ProjectArchiveSnapshotCompleteData,
    ProjectArchiveSnapshotCompleteRequest,
    ProjectArchiveSnapshotStartData,
    ProjectArchiveSnapshotStartRequest,
    ProjectArchiveUpsertRequest,
    PiSessionArchiveConfirmData,
    PiSessionArchiveConfirmRequest,
    PiSessionArchivePrepareData,
    PiSessionArchivePrepareRequest,
    ProjectDocumentAnalyzeData,
    ProjectDocumentAnalyzeRequest,
)
from app.models.user import CurrentUserData
from app.repositories.project_archive_repository import ProjectArchiveRepository
from app.schemas.base import utcnow
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials

logger = logging.getLogger(__name__)

QWEN_DOC_EXTENSIONS = {
    ".txt",
    ".doc",
    ".docx",
    ".pdf",
    ".xls",
    ".xlsx",
    ".md",
    ".ppt",
    ".pptx",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
}
QWEN_LONG_EXTENSIONS = {
    ".txt",
    ".docx",
    ".pdf",
    ".xlsx",
    ".epub",
    ".mobi",
    ".md",
    ".csv",
    ".json",
    ".bmp",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
}
QWEN_LONG_IMAGE_EXTENSIONS = {".bmp", ".png", ".jpg", ".jpeg", ".gif"}
QWEN_LONG_MAX_IMAGE_BYTES = 20 * 1024 * 1024
QWEN_PDF_VISION_EXTENSIONS = {".pdf"}
CLOUD_DOCUMENT_EXTENSIONS = QWEN_DOC_EXTENSIONS | QWEN_LONG_EXTENSIONS

# Provider failure kinds. Only throttled/transient are worth retrying; quota and permanent
# failures will not resolve on their own, so we move to the next fallback immediately.
PROVIDER_KIND_THROTTLED = "throttled"
PROVIDER_KIND_QUOTA = "quota"
PROVIDER_KIND_TRANSIENT = "transient"
PROVIDER_KIND_PERMANENT = "permanent"
PROVIDER_RETRYABLE_KINDS = frozenset({PROVIDER_KIND_THROTTLED, PROVIDER_KIND_TRANSIENT})
PROVIDER_RETRY_MAX_SLEEP_SECONDS = 30.0

_THROTTLE_ERROR_HINTS = (
    "throttling",
    "rate_limit",
    "ratelimit",
    "rate limit",
    "requestlimitexceeded",
    "too_many_requests",
    "too many requests",
    "flow_control",
    "limit_requests",
    "server is busy",
    "服务繁忙",
    "请求过于频繁",
)
_QUOTA_ERROR_HINTS = (
    "insufficient_quota",
    "insufficientquota",
    "insufficient balance",
    "arrearage",
    "quota_exceeded",
    "quotaexceeded",
    "exceeded your current quota",
    "free_allocated_quota_exceeded",
    "欠费",
    "余额不足",
    "额度不足",
)


@lru_cache(maxsize=16)
def _document_analysis_limiter(max_concurrency: int) -> BoundedSemaphore:
    return BoundedSemaphore(max_concurrency)


@lru_cache(maxsize=16)
def _document_analysis_admission_limiter(
    max_concurrency: int,
    max_queue_depth: int,
) -> BoundedSemaphore:
    return BoundedSemaphore(max_concurrency + max_queue_depth)


@dataclass(frozen=True)
class ProviderFailure:
    leg: str
    kind: str
    message: str
    status: int | None = None
    code: str = ""
    retry_after: float | None = None

    @property
    def retryable(self) -> bool:
        return self.kind in PROVIDER_RETRYABLE_KINDS

    def describe(self) -> str:
        segments: list[str] = []
        if self.status is not None:
            segments.append(f"HTTP {self.status}")
        if self.code:
            segments.append(self.code)
        if self.message:
            segments.append(self.message)
        return f"{self.leg}: {' '.join(segments) if segments else '未知错误'}"


class DocumentProviderError(RuntimeError):
    def __init__(self, failure: ProviderFailure) -> None:
        super().__init__(failure.describe())
        self.failure = failure


def _provider_error(
    leg: str,
    kind: str,
    message: str,
    *,
    status: int | None = None,
    code: str = "",
    retry_after: float | None = None,
) -> DocumentProviderError:
    return DocumentProviderError(
        ProviderFailure(
            leg=leg,
            kind=kind,
            message=message,
            status=status,
            code=code,
            retry_after=retry_after,
        )
    )


def _extract_provider_error(payload: Any) -> tuple[str, str]:
    """Pull (code, message) out of a DashScope-native or OpenAI-compatible error body."""
    if not isinstance(payload, dict):
        return "", ""
    error = payload.get("error")
    if isinstance(error, dict):
        code = str(error.get("code") or error.get("type") or "").strip()
        return code, str(error.get("message") or "").strip()
    if isinstance(error, str) and error.strip():
        return "", error.strip()
    return str(payload.get("code") or "").strip(), str(payload.get("message") or "").strip()


def _classify_provider_error(status: int | None, code: str, message: str) -> str:
    haystack = f"{code} {message}".lower()
    # An explicit provider code/message is more specific than the HTTP status. OpenAI-style
    # APIs may use 429 for exhausted quota as well as rate limiting; retrying the former only
    # wastes time and obscures the actual account problem.
    if any(hint in haystack for hint in _QUOTA_ERROR_HINTS):
        return PROVIDER_KIND_QUOTA
    if status == 429 or any(hint in haystack for hint in _THROTTLE_ERROR_HINTS):
        return PROVIDER_KIND_THROTTLED
    if status is not None and status >= 500:
        return PROVIDER_KIND_TRANSIENT
    return PROVIDER_KIND_PERMANENT


def _parse_retry_after(headers: Any) -> float | None:
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return None
    raw = getter("retry-after")
    if not raw:
        return None
    try:
        seconds = float(str(raw).strip())
    except (TypeError, ValueError):
        # HTTP-date form; the caller's exponential backoff is a good enough substitute.
        return None
    return seconds if seconds >= 0 else None


def _consume_openai_stream(
    leg: str,
    lines: Any,
) -> tuple[str, dict[str, Any] | None]:
    """Concatenate an OpenAI-compatible SSE stream into text plus the trailing usage block."""
    chunks: list[str] = []
    usage: dict[str, Any] | None = None
    for raw_line in lines:
        line = str(raw_line or "").strip()
        if not line or line.startswith(":"):
            continue
        if not line.startswith("data:"):
            continue
        data = line[len("data:") :].strip()
        if not data or data == "[DONE]":
            continue
        try:
            event = json.loads(data)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        code, message = _extract_provider_error(event)
        if code or message:
            raise _provider_error(
                leg,
                _classify_provider_error(None, code, message),
                message or "流式响应返回错误",
                code=code,
            )
        if isinstance(event.get("usage"), dict):
            usage = event["usage"]
        choices = event.get("choices")
        if not isinstance(choices, list) or not choices:
            continue
        first = choices[0]
        if not isinstance(first, dict):
            continue
        delta = first.get("delta")
        piece = delta.get("content") if isinstance(delta, dict) else None
        if isinstance(piece, str):
            chunks.append(piece)
        elif isinstance(piece, list):
            chunks.extend(
                str(item.get("text") or "")
                for item in piece
                if isinstance(item, dict)
            )
    content = "".join(chunks).strip()
    if not content:
        raise _provider_error(leg, PROVIDER_KIND_TRANSIENT, "流式响应未返回任何内容")
    return content, usage


def _provider_http_failure(
    leg: str,
    response: Any,
    *,
    body_text: str | None = None,
) -> DocumentProviderError:
    status = getattr(response, "status_code", None)
    if body_text is None:
        try:
            body_text = response.text
        except Exception:  # noqa: BLE001 - streaming bodies may not be readable
            body_text = ""
    try:
        parsed = json.loads(body_text) if body_text else None
    except ValueError:
        parsed = None
    code, message = _extract_provider_error(parsed)
    if not message:
        message = (body_text or "").strip()[:300]
    return _provider_error(
        leg,
        _classify_provider_error(status, code, message),
        message or f"服务返回 HTTP {status}",
        status=status,
        code=code,
        retry_after=_parse_retry_after(getattr(response, "headers", None)),
    )


class ObjectIntegrityError(RuntimeError):
    pass


@dataclass(frozen=True)
class _ProviderLeg:
    model: str
    run: Callable[[], tuple[str, dict[str, Any] | None]]


@dataclass
class _FileConfirmationCheck:
    relative_path: str
    sha256: str
    record_id: str | None = None
    size_bytes: int = 0
    storage_key: str = ""
    status: str | None = None
    error: str | None = None


@dataclass
class _AttachmentConfirmationCheck:
    message_source_key: str
    attachment_id: str
    sha256: str
    record_id: str | None = None
    size_bytes: int = 0
    storage_key: str = ""
    status: str | None = None
    error: str | None = None


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_relative_path(value: str) -> tuple[str, str]:
    candidate = value.strip().replace("\\", "/")
    if not candidate or candidate.startswith("/") or "\x00" in candidate:
        raise AppError(400, "项目文件相对路径无效。", error_code="project_archive_invalid_path")
    path = PurePosixPath(candidate)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise AppError(400, "项目文件相对路径无效。", error_code="project_archive_invalid_path")
    normalized = path.as_posix()
    if len(normalized) > 2048:
        raise AppError(400, "项目文件相对路径过长。", error_code="project_archive_path_too_long")
    return normalized, normalized.casefold()


def _safe_extension(relative_path: str) -> str:
    suffix = PurePosixPath(relative_path).suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9_-]{1,16}", suffix) else ""


def _json_or_none(value: object) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _parse_json_dict(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def _extract_dashscope_text(payload: dict[str, Any]) -> str:
    output = payload.get("output")
    if isinstance(output, dict):
        choices = output.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else None
            message = first.get("message") if isinstance(first, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                parts = [
                    str(item.get("text") or item.get("content") or "").strip()
                    for item in content
                    if isinstance(item, dict)
                ]
                return "\n".join(part for part in parts if part).strip()
        text = output.get("text")
        if isinstance(text, str):
            return text.strip()
    return ""


def _extract_openai_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else None
    message = first.get("message") if isinstance(first, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            str(item.get("text") or "").strip()
            for item in content
            if isinstance(item, dict)
        ]
        return "\n".join(part for part in parts if part).strip()
    return ""


class ProjectArchiveService:
    def __init__(self, settings: Settings, session: Session) -> None:
        self.settings = settings
        self.session = session
        self.repository = ProjectArchiveRepository(session)

    def upsert_project(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveUpsertRequest,
    ) -> ProjectArchiveProjectData:
        self._ensure_archive_enabled()
        project = self._upsert_project_record(current_user, payload)
        project.last_synced_at = utcnow()
        if project.sync_status == "pending":
            project.sync_status = "metadata_ready"
        self.session.commit()
        return ProjectArchiveProjectData(
            project_archive_id=project.id,
            local_project_id=project.local_project_id,
            sync_status=project.sync_status,
        )

    def start_snapshot(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveSnapshotStartRequest,
    ) -> ProjectArchiveSnapshotStartData:
        self._ensure_archive_enabled()
        project = self._upsert_project_record(current_user, payload)
        snapshot_id = str(uuid4())
        project.active_snapshot_id = snapshot_id
        project.sync_status = "scanning"
        project.last_scanned_at = _clean_optional(payload.scanned_at)
        self.session.commit()
        return ProjectArchiveSnapshotStartData(
            project_archive_id=project.id,
            local_project_id=project.local_project_id,
            sync_status=project.sync_status,
            snapshot_id=snapshot_id,
        )

    def prepare_files(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveFilesPrepareRequest,
    ) -> ProjectArchiveFilesPrepareData:
        self._ensure_archive_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        snapshot_id = _clean_optional(payload.snapshot_id)
        if snapshot_id and project.active_snapshot_id != snapshot_id:
            raise AppError(
                409,
                "项目文件快照已被更新，请重新开始同步。",
                error_code="project_archive_snapshot_superseded",
            )

        max_bytes = int(self.settings.project_archive_max_file_mb) * 1024 * 1024
        targets: list[ProjectArchiveFileUploadTarget] = []
        for item in payload.files:
            if item.size_bytes > max_bytes:
                raise AppError(
                    413,
                    f"项目文件超过归档上限（{self.settings.project_archive_max_file_mb}MB）。",
                    error_code="project_archive_file_too_large",
                    details={"relative_path": item.relative_path, "size_bytes": item.size_bytes},
                )
            relative_path, normalized_path = _normalize_relative_path(item.relative_path)
            extension = _safe_extension(relative_path)
            storage_key = self._project_file_storage_key(
                current_user.organization.id,
                project.id,
                item.sha256,
                extension,
            )
            record = self.repository.upsert_file(
                project_archive_id=project.id,
                user_id=current_user.user.id,
                relative_path=relative_path,
                normalized_path=normalized_path,
                filename=PurePosixPath(relative_path).name,
                extension=extension,
                media_type=(item.media_type or "application/octet-stream").strip(),
                size_bytes=item.size_bytes,
                sha256=item.sha256,
                modified_at_client=_clean_optional(item.modified_at),
                storage_key=storage_key,
                snapshot_id=snapshot_id,
            )

            if record.upload_status == "ready":
                targets.append(
                    ProjectArchiveFileUploadTarget(
                        relative_path=relative_path,
                        sha256=record.sha256,
                        upload_required=False,
                    )
                )
                continue

            required_headers = {
                "Content-Type": record.media_type,
                "x-oss-meta-sha256": record.sha256,
            }
            upload_url = self._sign_url(
                method="PUT",
                storage_key=storage_key,
                expires_seconds=int(self.settings.project_archive_upload_url_ttl_seconds),
                headers=required_headers,
            )
            targets.append(
                ProjectArchiveFileUploadTarget(
                    relative_path=relative_path,
                    sha256=record.sha256,
                    upload_required=True,
                    upload_url=upload_url,
                    required_headers=required_headers,
                    expires_in_seconds=int(self.settings.project_archive_upload_url_ttl_seconds),
                )
            )

        if snapshot_id:
            project.sync_status = "uploading"
        project.last_synced_by_user_id = current_user.user.id
        self.session.commit()
        return ProjectArchiveFilesPrepareData(project_archive_id=project.id, targets=targets)

    def confirm_files(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveFilesConfirmRequest,
    ) -> ProjectArchiveFilesConfirmData:
        self._ensure_archive_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        project_archive_id = project.id
        bucket = self._bucket()
        checks: list[_FileConfirmationCheck] = []
        for item in payload.files:
            relative_path, normalized_path = _normalize_relative_path(item.relative_path)
            record = self.repository.get_file(project_archive_id, normalized_path)
            if (
                record is None
                or record.is_deleted
                or record.sha256 != item.sha256
                or not record.storage_key
            ):
                checks.append(
                    _FileConfirmationCheck(
                        relative_path=relative_path,
                        sha256=item.sha256,
                        status="mismatch",
                        error="数据库中的项目文件版本与确认请求不一致。",
                    )
                )
                continue

            checks.append(
                _FileConfirmationCheck(
                    relative_path=relative_path,
                    sha256=item.sha256,
                    record_id=record.id,
                    size_bytes=record.size_bytes,
                    storage_key=record.storage_key,
                )
            )

        # Do not retain a checked-out DB connection while hashing potentially large OSS objects.
        self.session.commit()
        self.session.close()

        for check in checks:
            if check.record_id is None:
                continue
            try:
                self._verify_oss_object(
                    bucket=bucket,
                    storage_key=check.storage_key,
                    expected_size=check.size_bytes,
                    expected_sha256=check.sha256,
                )
                check.status = "ready"
            except ObjectIntegrityError as exc:
                check.status = "mismatch"
                check.error = str(exc)
            except Exception as exc:  # noqa: BLE001
                status = getattr(exc, "status", None)
                check.status = "missing" if status == 404 else "failed"
                check.error = (
                    "OSS 对象尚不可用。" if status == 404 else f"OSS 对象确认失败: {exc}"
                )

        for check in checks:
            if check.record_id is None:
                continue
            record = self.repository.get_file_by_id(check.record_id)
            if (
                record is None
                or record.project_archive_id != project_archive_id
                or record.is_deleted
                or record.sha256 != check.sha256
                or record.size_bytes != check.size_bytes
                or record.storage_key != check.storage_key
            ):
                check.status = "mismatch"
                check.error = "项目文件版本在确认期间发生变化。"
                continue
            if check.status == "ready":
                self.repository.mark_file_ready(record)
            else:
                self.repository.mark_file_failed(record, check.error or "OSS 对象确认失败。")

        self.session.commit()
        return ProjectArchiveFilesConfirmData(
            results=[
                ProjectArchiveFileConfirmationResult(
                    relative_path=check.relative_path,
                    sha256=check.sha256,
                    status=check.status or "failed",
                    error=check.error,
                )
                for check in checks
            ]
        )

    def complete_snapshot(
        self,
        current_user: CurrentUserData,
        snapshot_id: str,
        payload: ProjectArchiveSnapshotCompleteRequest,
    ) -> ProjectArchiveSnapshotCompleteData:
        self._ensure_archive_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        if project.active_snapshot_id != snapshot_id:
            raise AppError(
                409,
                "项目文件快照已被更新，旧快照不能完成。",
                error_code="project_archive_snapshot_superseded",
            )
        ready_count, pending_count, deleted_count = self.repository.complete_snapshot(
            project,
            snapshot_id,
            mark_missing_deleted=payload.scan_complete,
        )
        project.active_snapshot_id = None
        if payload.scan_complete:
            project.last_completed_snapshot_id = snapshot_id
            project.file_count = payload.file_count
            project.total_bytes = payload.total_bytes
        project.sync_status = "ready" if payload.scan_complete and pending_count == 0 else "partial"
        project.last_synced_by_user_id = current_user.user.id
        project.last_synced_at = utcnow()
        self.session.commit()
        return ProjectArchiveSnapshotCompleteData(
            project_archive_id=project.id,
            local_project_id=project.local_project_id,
            sync_status=project.sync_status,
            snapshot_id=snapshot_id,
            ready_file_count=ready_count,
            pending_file_count=pending_count,
            deleted_file_count=deleted_count,
            file_count=project.file_count,
            total_bytes=project.total_bytes,
            scan_complete=payload.scan_complete,
        )

    def sync_conversation(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveConversationSyncRequest,
    ) -> ProjectArchiveConversationSyncData:
        self._ensure_archive_enabled()
        project = self._upsert_project_record(current_user, payload)
        source = payload.conversation
        conversation = self.repository.upsert_conversation(
            project_archive_id=project.id,
            user_id=current_user.user.id,
            local_conversation_id=source.id.strip(),
            title=source.title.strip() or "新对话",
            creation_source=source.creation_source,
            conversation_mode=source.conversation_mode.strip() or "knowledge_qa",
            drawing_id=_clean_optional(source.drawing_id),
            drawing_name=_clean_optional(source.drawing_name),
            is_pinned=source.is_pinned,
            preferred_model_id=_clean_optional(source.preferred_model_id),
            preferred_thinking_mode=_clean_optional(source.preferred_thinking_mode),
            context_usage_json=_json_or_none(source.context_usage),
            session_sync_scope=source.session_sync_scope,
            parent_local_conversation_id=_clean_optional(source.parent_conversation_id),
            forked_from_entry_id=_clean_optional(source.forked_from_entry_id),
            source_updated_at=_clean_optional(source.updated_at),
        )
        self.repository.mark_conversation_messages_deleted(conversation.id)

        attachment_count = 0
        attachment_error_count = 0
        attachment_uploads: list[ProjectArchiveMessageAttachmentUploadTarget] = []
        for ordinal, message_input in enumerate(source.messages):
            message = self.repository.upsert_message(
                conversation_id=conversation.id,
                local_message_id=_clean_optional(message_input.id),
                client_run_id=_clean_optional(message_input.client_run_id),
                pi_session_id=_clean_optional(message_input.pi_session_id),
                pi_entry_id=_clean_optional(message_input.pi_entry_id),
                source_key=message_input.source_key,
                ordinal=ordinal,
                role=message_input.role,
                content=message_input.content,
                tool_name=message_input.tool_name,
                tool_args=message_input.tool_args,
                tool_result=message_input.tool_result,
                thinking=message_input.thinking,
                parts_json=_json_or_none(message_input.parts),
                source_created_at=_clean_optional(message_input.created_at),
            )
            self.repository.mark_message_attachments_deleted(message.id)
            for attachment_input in message_input.attachments:
                attachment_count += 1
                attachment = self.repository.upsert_attachment(
                    message_id=message.id,
                    local_attachment_id=attachment_input.id.strip(),
                    filename=_clean_optional(attachment_input.name),
                    media_type=attachment_input.mime_type.strip(),
                )
                if attachment_input.sha256 and attachment_input.size_bytes is not None:
                    max_bytes = int(self.settings.project_message_attachment_max_mb) * 1024 * 1024
                    if attachment_input.size_bytes > max_bytes:
                        attachment_error_count += 1
                        attachment.size_bytes = attachment_input.size_bytes
                        attachment.sha256 = attachment_input.sha256
                        attachment.upload_status = "failed"
                        attachment.upload_error = (
                            f"消息附件超过 {self.settings.project_message_attachment_max_mb}MB 上限"
                        )
                        continue
                    extension = self._extension_for_media_type(
                        attachment.media_type,
                        attachment.filename,
                    )
                    storage_key = (
                        f"project-archives/{current_user.organization.id}/{project.id}/"
                        f"message-attachments/{attachment_input.sha256[:2]}/"
                        f"{attachment_input.sha256}{extension}"
                    )
                    unchanged_ready = (
                        attachment.upload_status == "ready"
                        and attachment.sha256 == attachment_input.sha256
                        and attachment.size_bytes == attachment_input.size_bytes
                        and attachment.storage_key == storage_key
                    )
                    attachment.size_bytes = attachment_input.size_bytes
                    attachment.sha256 = attachment_input.sha256
                    attachment.storage_key = storage_key
                    attachment.upload_error = None
                    if unchanged_ready:
                        continue
                    attachment.upload_status = "pending"
                    required_headers = {
                        "Content-Type": attachment.media_type,
                        "x-oss-meta-sha256": attachment_input.sha256,
                    }
                    try:
                        upload_url = self._sign_url(
                            method="PUT",
                            storage_key=storage_key,
                            expires_seconds=int(
                                self.settings.project_archive_upload_url_ttl_seconds
                            ),
                            headers=required_headers,
                        )
                    except Exception as exc:  # noqa: BLE001
                        attachment_error_count += 1
                        attachment.upload_status = "failed"
                        attachment.upload_error = str(exc)[:4000]
                        continue
                    attachment_uploads.append(
                        ProjectArchiveMessageAttachmentUploadTarget(
                            message_source_key=message_input.source_key,
                            attachment_id=attachment.local_attachment_id,
                            sha256=attachment_input.sha256,
                            upload_url=upload_url,
                            required_headers=required_headers,
                            expires_in_seconds=int(
                                self.settings.project_archive_upload_url_ttl_seconds
                            ),
                        )
                    )
                    continue
                attachment.size_bytes = 0
                attachment.sha256 = None
                attachment.storage_key = None
                attachment.upload_status = "metadata_only"
                attachment.upload_error = None
                attachment.uploaded_at = None

        project.last_synced_by_user_id = current_user.user.id
        project.last_synced_at = utcnow()
        self.session.commit()
        return ProjectArchiveConversationSyncData(
            project_archive_id=project.id,
            conversation_archive_id=conversation.id,
            message_count=len(source.messages),
            attachment_count=attachment_count,
            attachment_error_count=attachment_error_count,
            attachment_uploads=attachment_uploads,
        )

    def prepare_pi_session_archive(
        self,
        current_user: CurrentUserData,
        payload: PiSessionArchivePrepareRequest,
    ) -> PiSessionArchivePrepareData:
        self._ensure_archive_enabled()
        maximum_bytes = int(self.settings.project_archive_max_file_mb) * 1024 * 1024
        if payload.size_bytes > maximum_bytes:
            raise AppError(
                413,
                f"Pi Session 超过归档上限（{self.settings.project_archive_max_file_mb}MB）。",
                error_code="pi_session_archive_too_large",
            )

        project = self._upsert_project_record(current_user, payload)
        conversation = self.repository.get_conversation(
            project.id,
            payload.local_conversation_id,
        )
        if conversation is None or conversation.source_user_id != current_user.user.id:
            raise AppError(
                409,
                "请先同步会话元数据，再归档 Pi Session。",
                error_code="pi_session_archive_conversation_missing",
            )

        storage_key = (
            f"project-archives/{current_user.organization.id}/{project.id}/"
            f"pi-sessions/{payload.pi_session_id}/{payload.sha256[:2]}/"
            f"{payload.sha256}.jsonl"
        )
        record = self.repository.upsert_pi_session_archive(
            organization_id=current_user.organization.id,
            project_archive_id=project.id,
            conversation_archive_id=conversation.id,
            user_id=current_user.user.id,
            local_conversation_id=payload.local_conversation_id,
            pi_session_id=payload.pi_session_id,
            parent_pi_session_id=payload.parent_pi_session_id,
            runtime_version=payload.runtime_version,
            jsonl_schema_version=payload.jsonl_schema_version,
            current_leaf_entry_id=payload.current_leaf_entry_id,
            entry_count=payload.entry_count,
            sha256=payload.sha256,
            size_bytes=payload.size_bytes,
            source_modified_at=payload.source_modified_at,
            storage_key=storage_key,
            training_consent=payload.training_consent,
        )
        if record.upload_status == "ready":
            self.session.commit()
            return PiSessionArchivePrepareData(
                archive_id=record.id,
                pi_session_id=record.pi_session_id,
                sha256=record.sha256,
                upload_required=False,
                storage_key=record.storage_key,
            )

        required_headers = {
            "Content-Type": "application/x-ndjson",
            "x-oss-meta-sha256": payload.sha256,
        }
        upload_url = self._sign_url(
            method="PUT",
            storage_key=storage_key,
            expires_seconds=int(self.settings.project_archive_upload_url_ttl_seconds),
            headers=required_headers,
        )
        self.session.commit()
        return PiSessionArchivePrepareData(
            archive_id=record.id,
            pi_session_id=record.pi_session_id,
            sha256=record.sha256,
            upload_required=True,
            storage_key=record.storage_key,
            upload_url=upload_url,
            required_headers=required_headers,
            expires_in_seconds=int(self.settings.project_archive_upload_url_ttl_seconds),
        )

    def confirm_pi_session_archive(
        self,
        current_user: CurrentUserData,
        payload: PiSessionArchiveConfirmRequest,
    ) -> PiSessionArchiveConfirmData:
        self._ensure_archive_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        conversation = self.repository.get_conversation(
            project.id,
            payload.local_conversation_id,
        )
        record = (
            self.repository.get_pi_session_archive(
                conversation_archive_id=conversation.id,
                pi_session_id=payload.pi_session_id,
                sha256=payload.sha256,
            )
            if conversation is not None
            else None
        )
        if (
            conversation is None
            or conversation.source_user_id != current_user.user.id
            or record is None
            or record.organization_id != current_user.organization.id
            or record.project_archive_id != project.id
        ):
            raise AppError(
                409,
                "Pi Session 归档版本与确认请求不一致。",
                error_code="pi_session_archive_mismatch",
            )

        record_id = record.id
        project_archive_id = project.id
        storage_key = record.storage_key
        expected_size = record.size_bytes
        bucket = self._bucket()
        self.session.commit()
        self.session.close()

        status = "ready"
        error: str | None = None
        try:
            self._verify_oss_object(
                bucket=bucket,
                storage_key=storage_key,
                expected_size=expected_size,
                expected_sha256=payload.sha256,
            )
        except ObjectIntegrityError as exc:
            status = "mismatch"
            error = str(exc)
        except Exception as exc:  # noqa: BLE001
            status = "missing" if getattr(exc, "status", None) == 404 else "failed"
            error = (
                "OSS Pi Session 对象尚不可用。"
                if status == "missing"
                else f"OSS Pi Session 确认失败: {exc}"
            )

        current = self.repository.get_pi_session_archive_by_id(record_id)
        if (
            current is None
            or current.organization_id != current_user.organization.id
            or current.project_archive_id != project_archive_id
            or current.pi_session_id != payload.pi_session_id
            or current.sha256 != payload.sha256
            or current.size_bytes != expected_size
            or current.storage_key != storage_key
        ):
            status = "mismatch"
            error = "Pi Session 归档版本在确认期间发生变化。"
        elif status == "ready":
            self.repository.mark_pi_session_archive_ready(current)
        else:
            self.repository.mark_pi_session_archive_failed(
                current,
                error or "OSS Pi Session 确认失败。",
            )
        self.session.commit()
        return PiSessionArchiveConfirmData(
            archive_id=record_id,
            pi_session_id=payload.pi_session_id,
            sha256=payload.sha256,
            status=status,  # type: ignore[arg-type]
            storage_key=storage_key,
            error=error,
        )

    def confirm_message_attachments(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveMessageAttachmentsConfirmRequest,
    ) -> ProjectArchiveMessageAttachmentsConfirmData:
        self._ensure_archive_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        project_archive_id = project.id
        conversation = self.repository.get_conversation(
            project_archive_id,
            payload.local_conversation_id.strip(),
        )
        if conversation is None:
            raise AppError(
                404,
                "未找到对应的会话归档。",
                error_code="project_archive_conversation_not_found",
            )
        conversation_id = conversation.id
        bucket = self._bucket()
        checks: list[_AttachmentConfirmationCheck] = []
        for item in payload.attachments:
            message_source_key = item.message_source_key.lower()
            expected_sha256 = item.sha256.lower()
            attachment_id = item.attachment_id.strip()
            message = self.repository.get_message(conversation_id, message_source_key)
            attachment = (
                self.repository.get_attachment(message.id, attachment_id)
                if message is not None and not message.is_deleted
                else None
            )
            if (
                attachment is None
                or attachment.is_deleted
                or attachment.sha256 != expected_sha256
                or not attachment.storage_key
            ):
                checks.append(
                    _AttachmentConfirmationCheck(
                        message_source_key=message_source_key,
                        attachment_id=attachment_id,
                        sha256=expected_sha256,
                        status="mismatch",
                        error="数据库中的消息附件版本与确认请求不一致。",
                    )
                )
                continue

            checks.append(
                _AttachmentConfirmationCheck(
                    message_source_key=message_source_key,
                    attachment_id=attachment_id,
                    sha256=expected_sha256,
                    record_id=attachment.id,
                    size_bytes=attachment.size_bytes,
                    storage_key=attachment.storage_key,
                )
            )

        self.session.commit()
        self.session.close()

        for check in checks:
            if check.record_id is None:
                continue
            try:
                self._verify_oss_object(
                    bucket=bucket,
                    storage_key=check.storage_key,
                    expected_size=check.size_bytes,
                    expected_sha256=check.sha256,
                )
                check.status = "ready"
            except ObjectIntegrityError as exc:
                check.status = "mismatch"
                check.error = str(exc)
            except Exception as exc:  # noqa: BLE001
                status = getattr(exc, "status", None)
                check.status = "missing" if status == 404 else "failed"
                check.error = (
                    "OSS 对象尚不可用。" if status == 404 else f"OSS 对象确认失败: {exc}"
                )

        for check in checks:
            if check.record_id is None:
                continue
            attachment = self.repository.get_attachment_by_id(check.record_id)
            if (
                attachment is None
                or attachment.is_deleted
                or attachment.local_attachment_id != check.attachment_id
                or attachment.sha256 != check.sha256
                or attachment.size_bytes != check.size_bytes
                or attachment.storage_key != check.storage_key
            ):
                check.status = "mismatch"
                check.error = "消息附件版本在确认期间发生变化。"
                continue
            if check.status == "ready":
                attachment.upload_status = "ready"
                attachment.upload_error = None
                attachment.uploaded_at = utcnow()
            else:
                attachment.upload_status = "failed"
                attachment.upload_error = (check.error or "OSS 对象确认失败。")[:4000]

        self.session.commit()
        return ProjectArchiveMessageAttachmentsConfirmData(
            results=[
                ProjectArchiveMessageAttachmentConfirmationResult(
                    message_source_key=check.message_source_key,
                    attachment_id=check.attachment_id,
                    status=check.status or "failed",
                    error=check.error,
                )
                for check in checks
            ]
        )

    def analyze_document(
        self,
        current_user: CurrentUserData,
        payload: ProjectDocumentAnalyzeRequest,
    ) -> ProjectDocumentAnalyzeData:
        self._ensure_document_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        relative_path, normalized_path = _normalize_relative_path(payload.relative_path)
        project_file = self.repository.get_file(project.id, normalized_path)
        if (
            project_file is None
            or project_file.is_deleted
            or project_file.sha256 != payload.sha256
            or project_file.upload_status != "ready"
            or not project_file.storage_key
        ):
            raise AppError(
                409,
                "项目文档尚未完成 OSS 归档或本地文件已变化，请先重新同步。",
                error_code="project_document_not_archived",
            )
        if project_file.extension not in CLOUD_DOCUMENT_EXTENSIONS:
            raise AppError(
                415,
                f"云文档解析不支持 {project_file.extension or '该'} 格式。",
                error_code="project_document_type_unsupported",
            )
        max_bytes = int(self.settings.project_document_max_file_mb) * 1024 * 1024
        if project_file.size_bytes > max_bytes:
            raise AppError(
                413,
                f"云文档解析单文件不能超过 {self.settings.project_document_max_file_mb}MB。",
                error_code="project_document_too_large",
            )

        instruction = self._document_instruction(payload, relative_path)
        fingerprint_payload = {
            "sha256": project_file.sha256,
            "instruction": instruction,
            "strategy": payload.file_parsing_strategy,
            "max_chars": payload.max_chars,
            "primary_model": self.settings.project_document_model,
            "pdf_vision_model": (
                self.settings.project_document_pdf_vision_model
                if project_file.extension in QWEN_PDF_VISION_EXTENSIONS
                and self.settings.project_document_pdf_vision_enabled
                else None
            ),
            "fallback_model": self.settings.project_document_fallback_model,
            "max_output_tokens": self.settings.project_document_max_output_tokens,
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()

        project_archive_id = project.id
        project_file_id = project_file.id
        file_sha256 = project_file.sha256
        file_extension = project_file.extension
        file_size_bytes = project_file.size_bytes
        storage_key = str(project_file.storage_key)
        filename = project_file.filename
        media_type = project_file.media_type
        primary_model = self.settings.project_document_model

        def cached_result(cached_analysis: Any) -> ProjectDocumentAnalyzeData:
            return ProjectDocumentAnalyzeData(
                project_archive_id=project_archive_id,
                project_file_id=project_file_id,
                relative_path=relative_path,
                sha256=file_sha256,
                model=cached_analysis.model,
                primary_model=primary_model,
                fallback_used=cached_analysis.fallback_used,
                cached=True,
                content=cached_analysis.content,
                truncated=cached_analysis.truncated,
                warnings=_parse_json_list(cached_analysis.warnings_json),
                usage=_parse_json_dict(cached_analysis.usage_json),
            )

        cached = self.repository.get_analysis(project_file_id, fingerprint)
        if cached is not None and cached.status == "completed" and cached.model:
            return cached_result(cached)

        # End the read transaction before potentially waiting for capacity. Besides releasing
        # the connection, this clears SQLAlchemy's identity map so the post-queue cache lookup
        # cannot return the stale `pending` object observed above.
        self.session.close()
        max_concurrency = int(self.settings.project_document_max_concurrency)
        max_queue_depth = int(self.settings.project_document_max_queue_depth)
        queue_wait_seconds = float(self.settings.project_document_queue_wait_seconds)
        limiter = _document_analysis_limiter(max_concurrency)
        admission_limiter = _document_analysis_admission_limiter(
            max_concurrency,
            max_queue_depth,
        )
        if not admission_limiter.acquire(blocking=False):
            raise AppError(
                429,
                f"云文档解析本地队列已满（运行中 {max_concurrency}，排队上限 "
                f"{max_queue_depth}），请稍后重试。",
                error_code="project_document_queue_full",
            )

        # A queued sync request occupies one AnyIO worker until a slot frees or this wait expires.
        if not limiter.acquire(blocking=False):
            logger.info(
                "project document analysis queueing: all %d slots busy, waiting up to %.0fs",
                max_concurrency,
                queue_wait_seconds,
            )
            if not limiter.acquire(timeout=queue_wait_seconds):
                admission_limiter.release()
                raise AppError(
                    429,
                    f"云文档解析排队等待超过 {queue_wait_seconds:.0f} 秒（后端并发上限 "
                    f"{max_concurrency}），请稍后重试。",
                    error_code="project_document_queue_timeout",
                )

        try:
            # A request that held the slot may have completed while this one was queued. Reuse
            # that result instead of resetting the shared row to pending and calling DashScope
            # again. The fresh Session transaction above makes this a real database re-read.
            cached = self.repository.get_analysis(project_file_id, fingerprint)
            if cached is not None and cached.status == "completed" and cached.model:
                return cached_result(cached)

            self.repository.upsert_analysis(
                project_file_id=project_file_id,
                user_id=current_user.user.id,
                fingerprint=fingerprint,
                instruction=instruction,
                parsing_strategy=payload.file_parsing_strategy,
            )
            self.session.commit()
            # Commit expires ORM rows; closing here guarantees model/file IO owns no DB connection.
            self.session.close()

            legs, skipped = self._build_document_legs(
                file_extension=file_extension,
                file_size_bytes=file_size_bytes,
                storage_key=storage_key,
                filename=filename,
                media_type=media_type,
                instruction=instruction,
                parsing_strategy=payload.file_parsing_strategy,
            )
            if not legs:
                raise AppError(
                    415,
                    f"云文档解析没有可用的模型通道：{'；'.join(skipped) or '未知原因'}。",
                    error_code="project_document_no_provider",
                )

            warnings: list[str] = []
            failures: list[ProviderFailure] = []
            content = ""
            model_used = ""
            usage: dict[str, Any] | None = None
            succeeded = False
            for leg in legs:
                try:
                    content, usage = self._run_provider_leg(leg.model, leg.run)
                    model_used = leg.model
                    succeeded = True
                    break
                except DocumentProviderError as exc:
                    failures.append(exc.failure)
                    logger.warning(
                        "document analysis leg failed for %s: %s",
                        relative_path,
                        exc.failure.describe(),
                    )
            if not succeeded:
                raise self._document_chain_error(failures, skipped)

            fallback_used = model_used != primary_model
            if failures or not any(leg.model == primary_model for leg in legs):
                warnings.extend(f"{reason}，该通道已跳过。" for reason in skipped)
            warnings.extend(
                f"{failure.describe()}，已改用 {model_used} 兜底。" for failure in failures
            )

            content = content.strip()
            if not content:
                raise AppError(
                    502,
                    f"项目文档云解析失败：{model_used} 返回空内容。",
                    error_code="project_document_analysis_failed",
                )
            truncated = len(content) > payload.max_chars
            if truncated:
                content = f"{content[: max(0, payload.max_chars - 32)]}\n\n[云端解析内容过长，已截断。]"
                warnings.append("云端解析内容超过本次读取上限，已截断。")

            analysis = self.repository.get_analysis(project_file_id, fingerprint)
            if analysis is None:
                raise RuntimeError("云文档解析记录在执行期间被删除")
            self.repository.finish_analysis(
                analysis,
                model=model_used,
                fallback_used=fallback_used,
                content=content,
                truncated=truncated,
                warnings_json=json.dumps(warnings, ensure_ascii=False),
                usage_json=_json_or_none(usage),
            )
            self.session.commit()
            return ProjectDocumentAnalyzeData(
                project_archive_id=project_archive_id,
                project_file_id=project_file_id,
                relative_path=relative_path,
                sha256=file_sha256,
                model=model_used,
                primary_model=primary_model,
                fallback_used=fallback_used,
                cached=False,
                content=content,
                truncated=truncated,
                warnings=warnings,
                usage=usage,
            )
        except Exception as exc:  # noqa: BLE001
            self.session.rollback()
            self.repository.fail_analysis(
                project_file_id=project_file_id,
                fingerprint=fingerprint,
                error=str(exc),
            )
            self.session.commit()
            if isinstance(exc, AppError):
                raise
            raise AppError(
                502,
                f"项目文档云解析失败: {exc}",
                error_code="project_document_analysis_failed",
            ) from exc
        finally:
            limiter.release()
            admission_limiter.release()

    def _upsert_project_record(
        self,
        current_user: CurrentUserData,
        payload: ProjectArchiveUpsertRequest | ProjectArchiveSnapshotStartRequest | ProjectArchiveConversationSyncRequest,
    ):
        local_project_id = payload.local_project_id.strip()
        existing = self.repository.get_project(
            current_user.organization.id,
            local_project_id,
        )
        if existing is not None and existing.owner_user_id != current_user.user.id:
            raise AppError(
                403,
                "当前用户无权访问该项目归档。",
                error_code="project_archive_forbidden",
            )
        return self.repository.upsert_project(
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
            local_project_id=local_project_id,
            name=payload.name.strip(),
            description=payload.description.strip(),
            root_name=_clean_optional(payload.root_name),
        )

    def _require_project(self, current_user: CurrentUserData, local_project_id: str):
        project = self.repository.get_project(
            current_user.organization.id,
            local_project_id.strip(),
        )
        if project is None:
            raise AppError(
                404,
                "未找到对应的项目归档。",
                error_code="project_archive_not_found",
            )
        if project.owner_user_id != current_user.user.id:
            raise AppError(
                403,
                "当前用户无权访问该项目归档。",
                error_code="project_archive_forbidden",
            )
        return project

    def _project_file_storage_key(
        self,
        organization_id: str,
        project_id: str,
        sha256: str,
        extension: str,
    ) -> str:
        return (
            f"project-archives/{organization_id}/{project_id}/files/"
            f"{sha256[:2]}/{sha256}{extension}"
        )

    @staticmethod
    def _verify_oss_object(
        *,
        bucket: Any,
        storage_key: str,
        expected_size: int,
        expected_sha256: str,
    ) -> None:
        head = bucket.head_object(storage_key)
        content_length = int(getattr(head, "content_length", -1))
        headers = getattr(head, "headers", {}) or {}
        remote_sha256 = ""
        for key, value in headers.items():
            if str(key).lower() == "x-oss-meta-sha256":
                remote_sha256 = str(value).strip().lower()
                break

        if not remote_sha256:
            raise ObjectIntegrityError("OSS 对象缺少 SHA-256 元数据。")
        if content_length != expected_size or remote_sha256 != expected_sha256:
            raise ObjectIntegrityError("OSS 对象大小或 SHA-256 元数据与归档清单不一致。")

        digest = hashlib.sha256()
        bytes_read = 0
        oss_object = bucket.get_object(storage_key)
        try:
            while True:
                chunk = oss_object.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                bytes_read += len(chunk)
        finally:
            close = getattr(oss_object, "close", None)
            if callable(close):
                close()

        if bytes_read != expected_size or digest.hexdigest() != expected_sha256:
            raise ObjectIntegrityError("OSS 对象实际内容的 SHA-256 与归档清单不一致。")

    def _bucket(self):
        if not has_oss_credentials(self.settings):
            raise AppError(500, "项目归档 OSS 配置不完整。", error_code="project_archive_oss_missing")
        return get_oss_bucket(self.settings)

    def _sign_url(
        self,
        *,
        method: str,
        storage_key: str,
        expires_seconds: int,
        headers: dict[str, str] | None = None,
    ) -> str:
        try:
            return self._bucket().sign_url(
                method,
                storage_key,
                expires_seconds,
                headers=headers,
                slash_safe=True,
            )
        except AppError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AppError(
                502,
                f"生成 OSS {method} 签名 URL 失败: {exc}",
                error_code="project_archive_sign_url_failed",
            ) from exc

    def _sign_get_url(self, storage_key: str) -> str:
        signed_url = self._sign_url(
            method="GET",
            storage_key=storage_key,
            expires_seconds=int(self.settings.project_document_signed_url_ttl_seconds),
        )
        public_base = (self.settings.oss_public_base_url or "").strip()
        if not public_base:
            return signed_url
        if not public_base.startswith(("http://", "https://")):
            public_base = f"https://{public_base}"
        target = urlsplit(public_base)
        source = urlsplit(signed_url)
        if not target.netloc:
            return signed_url
        return urlunsplit((target.scheme or source.scheme, target.netloc, source.path, source.query, ""))

    def _build_document_legs(
        self,
        *,
        file_extension: str,
        file_size_bytes: int,
        storage_key: str,
        filename: str,
        media_type: str,
        instruction: str,
        parsing_strategy: str,
    ) -> tuple[list[_ProviderLeg], list[str]]:
        """Order the provider chain for this file and record why channels were left out.

        The signed GET URL is minted inside each closure so every attempt gets a fresh one;
        retries and later legs can otherwise outlive the signature TTL.
        """
        legs: list[_ProviderLeg] = []
        skipped: list[str] = []

        if file_extension in QWEN_DOC_EXTENSIONS:
            legs.append(
                _ProviderLeg(
                    model=self.settings.project_document_model,
                    run=lambda: self._analyze_with_qwen_doc(
                        doc_url=self._sign_get_url(storage_key),
                        instruction=instruction,
                        parsing_strategy=parsing_strategy,
                    ),
                )
            )
        else:
            skipped.append(
                f"{file_extension or '该格式'} 不在 qwen-doc 官方支持列表中"
            )

        if file_extension in QWEN_PDF_VISION_EXTENSIONS:
            if self.settings.project_document_pdf_vision_enabled:
                legs.append(
                    _ProviderLeg(
                        model=self.settings.project_document_pdf_vision_model,
                        run=lambda: self._analyze_with_pdf_vision(
                            doc_url=self._sign_get_url(storage_key),
                            instruction=instruction,
                        ),
                    )
                )
            else:
                skipped.append("PDF 视觉理解兜底已按配置关闭")

        if file_extension not in QWEN_LONG_EXTENSIONS:
            skipped.append(
                f"qwen-long 官方不支持 {file_extension or '该'} 格式"
            )
        elif (
            file_extension in QWEN_LONG_IMAGE_EXTENSIONS
            and file_size_bytes > QWEN_LONG_MAX_IMAGE_BYTES
        ):
            skipped.append("该图片超过 qwen-long 官方 20MB 上限")
        else:
            legs.append(
                _ProviderLeg(
                    model=self.settings.project_document_fallback_model,
                    run=lambda: self._analyze_with_qwen_long(
                        storage_key=storage_key,
                        filename=filename,
                        media_type=media_type,
                        instruction=instruction,
                    ),
                )
            )
        return legs, skipped

    @staticmethod
    def _document_chain_error(
        failures: list[ProviderFailure],
        skipped: list[str],
    ) -> AppError:
        """Report the provider's real state: only claim throttling when every leg was throttled."""
        details: dict[str, Any] = {
            "legs": [
                {
                    "leg": failure.leg,
                    "kind": failure.kind,
                    "status": failure.status,
                    "code": failure.code,
                    "message": failure.message,
                }
                for failure in failures
            ]
        }
        if skipped:
            details["skipped"] = list(skipped)
        reasons = "；".join(failure.describe() for failure in failures) or "未知原因"
        channels = " / ".join(dict.fromkeys(failure.leg for failure in failures))

        if failures and all(
            failure.kind == PROVIDER_KIND_THROTTLED for failure in failures
        ):
            retry_after = max(
                (
                    failure.retry_after
                    for failure in failures
                    if failure.retry_after is not None
                ),
                default=None,
            )
            if retry_after is not None:
                details["retry_after_seconds"] = retry_after
            return AppError(
                429,
                f"云端文档解析模型当前限流（{channels} 均已重试仍被限流），请稍后重试。",
                error_code="project_document_provider_throttled",
                details=details,
            )
        if failures and all(
            failure.kind == PROVIDER_KIND_QUOTA for failure in failures
        ):
            return AppError(
                502,
                f"云端文档解析模型额度不足或欠费（{channels}）：{reasons}。",
                error_code="project_document_provider_quota_exhausted",
                details=details,
            )
        suffix = f"；未启用的通道：{'；'.join(skipped)}" if skipped else ""
        return AppError(
            502,
            f"项目文档云解析失败：{reasons}{suffix}。",
            error_code="project_document_analysis_failed",
            details=details,
        )

    def _run_provider_leg(
        self,
        leg: str,
        call: Callable[[], tuple[str, dict[str, Any] | None]],
    ) -> tuple[str, dict[str, Any] | None]:
        """Run one fallback leg, retrying only failures that can plausibly clear on their own."""
        attempts = max(1, int(self.settings.project_document_provider_max_attempts))
        base_delay = float(self.settings.project_document_provider_retry_base_seconds)
        for attempt in range(1, attempts + 1):
            try:
                return call()
            except DocumentProviderError as exc:
                if not exc.failure.retryable or attempt >= attempts:
                    raise
                delay = exc.failure.retry_after
                if delay is None:
                    delay = base_delay * (2 ** (attempt - 1))
                delay = min(max(delay, 0.0), PROVIDER_RETRY_MAX_SLEEP_SECONDS)
                delay += random.uniform(0.0, min(base_delay, 1.0))
                logger.info(
                    "document provider %s attempt %d/%d failed (%s: %s), retrying in %.1fs",
                    leg,
                    attempt,
                    attempts,
                    exc.failure.kind,
                    exc.failure.message,
                    delay,
                )
                time.sleep(delay)
        raise RuntimeError("unreachable provider retry state")

    def _analyze_with_qwen_doc(
        self,
        *,
        doc_url: str,
        instruction: str,
        parsing_strategy: str,
    ) -> tuple[str, dict[str, Any] | None]:
        leg = self.settings.project_document_model
        api_key = (self.settings.dashscope_api_key or "").strip()
        if not api_key:
            raise _provider_error(leg, PROVIDER_KIND_PERMANENT, "DASHSCOPE_API_KEY 未配置")
        endpoint = f"{self._dashscope_native_base()}/services/aigc/text-generation/generation"
        request_body = {
            "model": self.settings.project_document_model,
            "input": {
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "你是晓量的项目文档解析器。严格基于文件内容输出，不得编造，"
                            "不得泄露或复述文件 URL。输出适合另一个 Agent 直接阅读的 Markdown。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": instruction},
                            {
                                "type": "doc_url",
                                "doc_url": [doc_url],
                                "file_parsing_strategy": parsing_strategy,
                            },
                        ],
                    },
                ]
            },
            "parameters": {
                "result_format": "message",
                "max_tokens": int(self.settings.project_document_max_output_tokens),
            },
        }
        try:
            with httpx.Client(timeout=float(self.settings.project_document_timeout_seconds)) as client:
                response = client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=request_body,
                )
        except httpx.HTTPError as exc:
            raise _provider_error(
                leg,
                PROVIDER_KIND_TRANSIENT,
                f"网络请求失败（{exc.__class__.__name__}）",
            ) from exc
        if response.status_code != 200:
            raise _provider_http_failure(leg, response)
        try:
            body = response.json()
        except ValueError as exc:
            raise _provider_error(
                leg, PROVIDER_KIND_TRANSIENT, "服务响应不是合法 JSON"
            ) from exc
        if not isinstance(body, dict):
            raise _provider_error(leg, PROVIDER_KIND_TRANSIENT, "服务响应结构异常")
        content = _extract_dashscope_text(body)
        if content:
            usage = body.get("usage") if isinstance(body.get("usage"), dict) else None
            return content, usage
        # The native API also reports failures as HTTP 200 with a top-level error code.
        code, message = _extract_provider_error(body)
        if code or message:
            raise _provider_error(
                leg,
                _classify_provider_error(None, code, message),
                message or "服务返回错误",
                code=code,
            )
        raise _provider_error(leg, PROVIDER_KIND_TRANSIENT, "服务返回空内容")

    def _analyze_with_pdf_vision(
        self,
        *,
        doc_url: str,
        instruction: str,
    ) -> tuple[str, dict[str, Any] | None]:
        leg = self.settings.project_document_pdf_vision_model
        api_key = (self.settings.dashscope_api_key or "").strip()
        if not api_key:
            raise _provider_error(leg, PROVIDER_KIND_PERMANENT, "DASHSCOPE_API_KEY 未配置")
        endpoint = f"{self._dashscope_compatible_base()}/chat/completions"
        request_body = {
            "model": leg,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是晓量的项目文档解析器。严格基于文件内容输出，不得编造，"
                        "不得泄露或复述文件 URL。输出适合另一个 Agent 直接阅读的 Markdown。"
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "file", "file": {"file_url": doc_url, "file_format": "pdf"}},
                        {"type": "text", "text": instruction},
                    ],
                },
            ],
            # PDF understanding has a 300s first-token ceiling, so streaming is required to
            # avoid the server cutting a long parse off before any output arrives.
            "stream": True,
            "stream_options": {"include_usage": True},
            # qwen3.8 is a reasoning model. Keep reasoning enabled for compatibility, but use
            # the lowest effort because this leg extracts document content rather than solving.
            "enable_thinking": True,
            "reasoning_effort": "low",
            "max_tokens": int(self.settings.project_document_max_output_tokens),
        }
        timeout = httpx.Timeout(
            float(self.settings.project_document_timeout_seconds),
            connect=30.0,
        )
        try:
            with httpx.Client(timeout=timeout) as client:
                with client.stream(
                    "POST",
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=request_body,
                ) as response:
                    if response.status_code != 200:
                        raise _provider_http_failure(
                            leg,
                            response,
                            body_text=response.read().decode("utf-8", errors="replace"),
                        )
                    return _consume_openai_stream(leg, response.iter_lines())
        except httpx.HTTPError as exc:
            raise _provider_error(
                leg,
                PROVIDER_KIND_TRANSIENT,
                f"网络请求失败（{exc.__class__.__name__}）",
            ) from exc

    def _analyze_with_qwen_long(
        self,
        *,
        storage_key: str,
        filename: str,
        media_type: str,
        instruction: str,
    ) -> tuple[str, dict[str, Any] | None]:
        leg = self.settings.project_document_fallback_model
        api_key = (self.settings.dashscope_api_key or "").strip()
        if not api_key:
            raise _provider_error(leg, PROVIDER_KIND_PERMANENT, "DASHSCOPE_API_KEY 未配置")
        base_url = self._dashscope_compatible_base()

        file_id: str | None = None
        timeout = float(self.settings.project_document_timeout_seconds)
        with httpx.Client(timeout=timeout) as client:
            headers = {"Authorization": f"Bearer {api_key}"}
            with tempfile.TemporaryFile() as temporary_file:
                try:
                    oss_object = self._bucket().get_object(storage_key)
                    while True:
                        chunk = oss_object.read(1024 * 1024)
                        if not chunk:
                            break
                        temporary_file.write(chunk)
                    temporary_file.seek(0)
                except Exception as exc:  # noqa: BLE001
                    raise _provider_error(
                        leg, PROVIDER_KIND_TRANSIENT, "读取 OSS 归档文件失败"
                    ) from exc

                try:
                    upload_response = client.post(
                        f"{base_url}/files",
                        headers=headers,
                        data={"purpose": "file-extract"},
                        files={"file": (filename, temporary_file, media_type)},
                    )
                except httpx.HTTPError as exc:
                    raise _provider_error(
                        leg, PROVIDER_KIND_TRANSIENT, "文件上传失败"
                    ) from exc
            if upload_response.status_code not in {200, 201}:
                raise _provider_http_failure(leg, upload_response)
            try:
                uploaded = upload_response.json()
                file_id = str(uploaded.get("id") or "").strip()
            except (ValueError, AttributeError) as exc:
                raise _provider_error(
                    leg, PROVIDER_KIND_TRANSIENT, "文件上传响应异常"
                ) from exc
            if not file_id:
                raise _provider_error(
                    leg, PROVIDER_KIND_TRANSIENT, "文件上传未返回 file-id"
                )

            try:
                deadline = time.monotonic() + float(
                    self.settings.project_document_fallback_parse_timeout_seconds
                )
                while True:
                    status_response = client.get(f"{base_url}/files/{file_id}", headers=headers)
                    if status_response.status_code != 200:
                        raise _provider_http_failure(leg, status_response)
                    status_payload = status_response.json()
                    if not isinstance(status_payload, dict):
                        raise _provider_error(
                            leg, PROVIDER_KIND_TRANSIENT, "文件状态响应结构异常"
                        )
                    status = str(status_payload.get("status") or "").lower()
                    if status == "processed":
                        break
                    if status in {"error", "failed", "cancelled"}:
                        raise _provider_error(
                            leg, PROVIDER_KIND_PERMANENT, "服务端文件解析失败"
                        )
                    if time.monotonic() >= deadline:
                        raise _provider_error(
                            leg, PROVIDER_KIND_TRANSIENT, "等待服务端文件解析超时"
                        )
                    time.sleep(float(self.settings.project_document_fallback_poll_interval_seconds))

                completion_response = client.post(
                    f"{base_url}/chat/completions",
                    headers={**headers, "Content-Type": "application/json"},
                    json={
                        "model": self.settings.project_document_fallback_model,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "你是晓量的项目文档解析器。严格基于文件内容输出，不得编造。"
                                    "输出适合另一个 Agent 直接阅读的 Markdown。"
                                ),
                            },
                            {"role": "system", "content": f"fileid://{file_id}"},
                            {"role": "user", "content": instruction},
                        ],
                        "stream": False,
                        "max_tokens": int(self.settings.project_document_max_output_tokens),
                    },
                )
                if completion_response.status_code != 200:
                    raise _provider_http_failure(leg, completion_response)
                completion = completion_response.json()
                if not isinstance(completion, dict):
                    raise _provider_error(leg, PROVIDER_KIND_TRANSIENT, "响应结构异常")
                content = _extract_openai_text(completion)
                if not content:
                    code, message = _extract_provider_error(completion)
                    if code or message:
                        raise _provider_error(
                            leg,
                            _classify_provider_error(None, code, message),
                            message or "服务返回错误",
                            code=code,
                        )
                    raise _provider_error(leg, PROVIDER_KIND_TRANSIENT, "返回空内容")
                usage = completion.get("usage") if isinstance(completion.get("usage"), dict) else None
                return content, usage
            except (httpx.HTTPError, ValueError) as exc:
                raise _provider_error(
                    leg, PROVIDER_KIND_TRANSIENT, f"调用失败（{exc.__class__.__name__}）"
                ) from exc
            finally:
                if file_id:
                    try:
                        client.delete(f"{base_url}/files/{file_id}", headers=headers)
                    except Exception:  # noqa: BLE001
                        logger.warning("failed to delete temporary DashScope file %s", file_id)

    @staticmethod
    def _extension_for_media_type(media_type: str, filename: str | None) -> str:
        if filename:
            suffix = _safe_extension(filename)
            if suffix:
                return suffix
        return {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "image/bmp": ".bmp",
        }.get(media_type.lower(), "")

    @staticmethod
    def _document_instruction(payload: ProjectDocumentAnalyzeRequest, relative_path: str) -> str:
        options: list[str] = []
        if payload.page_range:
            options.append(f"只处理页码范围：{payload.page_range}")
        if payload.sheet_names:
            options.append(f"重点处理工作表：{'、'.join(payload.sheet_names)}")
        if payload.max_rows_per_sheet:
            options.append(f"每个工作表最多输出 {payload.max_rows_per_sheet} 行")
        if payload.max_cols_per_sheet:
            options.append(f"每个工作表最多输出 {payload.max_cols_per_sheet} 列")
        if payload.include_formulas is not None:
            options.append("保留公式" if payload.include_formulas else "无需展开公式")
        return "\n".join(
            [
                f"项目相对路径：{relative_path}",
                "请忠实解析文档正文、标题层级、表格和关键结构；引用内容时保留页码、章节或工作表位置。",
                *options,
                "用户/Agent 的本次读取要求：",
                payload.instruction.strip(),
            ]
        )

    def _dashscope_native_base(self) -> str:
        value = (self.settings.dashscope_base_url or "").rstrip("/")
        if value.endswith("/compatible-mode/v1"):
            return value[: -len("/compatible-mode/v1")] + "/api/v1"
        return value or "https://dashscope.aliyuncs.com/api/v1"

    def _dashscope_compatible_base(self) -> str:
        value = (self.settings.dashscope_base_url or "").rstrip("/")
        if value.endswith("/api/v1"):
            return value[: -len("/api/v1")] + "/compatible-mode/v1"
        return value or "https://dashscope.aliyuncs.com/compatible-mode/v1"

    def _ensure_archive_enabled(self) -> None:
        if not self.settings.project_archive_enabled:
            raise AppError(404, "项目归档能力未启用。", error_code="project_archive_disabled")

    def _ensure_document_enabled(self) -> None:
        self._ensure_archive_enabled()
        if not self.settings.project_document_cloud_enabled:
            raise AppError(404, "项目文档云解析未启用。", error_code="project_document_disabled")
