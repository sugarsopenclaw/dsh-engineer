from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.models.user import CurrentUserData
from app.models.user_skill_archive import (
    UserSkillArchiveFileConfirmationResult,
    UserSkillArchiveFileUploadTarget,
    UserSkillArchiveFilesConfirmData,
    UserSkillArchiveFilesConfirmRequest,
    UserSkillArchiveFilesPrepareData,
    UserSkillArchiveFilesPrepareRequest,
    UserSkillArchiveSnapshotCompleteData,
    UserSkillArchiveSnapshotCompleteRequest,
    UserSkillArchiveSnapshotStartData,
    UserSkillArchiveSnapshotStartRequest,
)
from app.repositories.user_skill_archive_repository import UserSkillArchiveRepository
from app.schemas.base import utcnow
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials

logger = logging.getLogger(__name__)

SKILL_SLUG_PATTERN = re.compile(r"^(?=.{2,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$")


class ObjectIntegrityError(RuntimeError):
    pass


@dataclass
class _FileConfirmationCheck:
    relative_path: str
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
        raise AppError(400, "自制 skill 文件相对路径无效。", error_code="user_skill_archive_invalid_path")
    path = PurePosixPath(candidate)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise AppError(400, "自制 skill 文件相对路径无效。", error_code="user_skill_archive_invalid_path")
    normalized = path.as_posix()
    if len(normalized) > 2048:
        raise AppError(400, "自制 skill 文件相对路径过长。", error_code="user_skill_archive_path_too_long")
    return normalized, normalized.casefold()


def _safe_extension(relative_path: str) -> str:
    suffix = PurePosixPath(relative_path).suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9_-]{1,16}", suffix) else ""


def _skill_slug_from_path(relative_path: str, declared_slug: str | None) -> str | None:
    declared = (declared_slug or "").strip().lower()
    first_part = PurePosixPath(relative_path).parts[0].lower() if PurePosixPath(relative_path).parts else ""
    if relative_path.casefold() == "manifest.json":
        if declared:
            raise AppError(
                400,
                "manifest.json 不属于某个 skill slug。",
                error_code="user_skill_archive_slug_mismatch",
            )
        return None
    if declared:
        if not SKILL_SLUG_PATTERN.fullmatch(declared):
            raise AppError(400, "自制 skill slug 无效。", error_code="user_skill_archive_invalid_slug")
        if first_part != declared:
            raise AppError(
                400,
                "自制 skill 文件路径与 slug 不一致。",
                error_code="user_skill_archive_slug_mismatch",
            )
        return declared
    if SKILL_SLUG_PATTERN.fullmatch(first_part):
        return first_part
    return None


class UserSkillArchiveService:
    def __init__(self, settings: Settings, session: Session) -> None:
        self.settings = settings
        self.session = session
        self.repository = UserSkillArchiveRepository(session)

    def start_snapshot(
        self,
        current_user: CurrentUserData,
        payload: UserSkillArchiveSnapshotStartRequest,
    ) -> UserSkillArchiveSnapshotStartData:
        self._ensure_archive_enabled()
        archive = self.repository.upsert_archive(
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
            skills_root_name=payload.skills_root_name,
        )
        snapshot_id = str(uuid4())
        archive.active_snapshot_id = snapshot_id
        archive.sync_status = "scanning"
        archive.last_scanned_at = _clean_optional(payload.scanned_at)
        self.session.commit()
        return UserSkillArchiveSnapshotStartData(
            archive_id=archive.id,
            sync_status=archive.sync_status,
            snapshot_id=snapshot_id,
        )

    def prepare_files(
        self,
        current_user: CurrentUserData,
        payload: UserSkillArchiveFilesPrepareRequest,
    ) -> UserSkillArchiveFilesPrepareData:
        self._ensure_archive_enabled()
        archive = self._require_archive(current_user)
        snapshot_id = _clean_optional(payload.snapshot_id)
        if snapshot_id and archive.active_snapshot_id != snapshot_id:
            raise AppError(
                409,
                "自制 skill 快照已被更新，请重新开始同步。",
                error_code="user_skill_archive_snapshot_superseded",
            )

        max_bytes = int(self.settings.project_archive_max_file_mb) * 1024 * 1024
        targets: list[UserSkillArchiveFileUploadTarget] = []
        for item in payload.files:
            if item.size_bytes > max_bytes:
                raise AppError(
                    413,
                    f"自制 skill 文件超过归档上限（{self.settings.project_archive_max_file_mb}MB）。",
                    error_code="user_skill_archive_file_too_large",
                    details={"relative_path": item.relative_path, "size_bytes": item.size_bytes},
                )
            relative_path, normalized_path = _normalize_relative_path(item.relative_path)
            skill_slug = _skill_slug_from_path(relative_path, item.skill_slug)
            extension = _safe_extension(relative_path)
            storage_key = self._file_storage_key(
                current_user.organization.id,
                current_user.user.id,
                item.sha256,
                extension,
            )
            record = self.repository.upsert_file(
                archive_id=archive.id,
                user_id=current_user.user.id,
                skill_slug=skill_slug,
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
                    UserSkillArchiveFileUploadTarget(
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
                UserSkillArchiveFileUploadTarget(
                    relative_path=relative_path,
                    sha256=record.sha256,
                    upload_required=True,
                    upload_url=upload_url,
                    required_headers=required_headers,
                    expires_in_seconds=int(self.settings.project_archive_upload_url_ttl_seconds),
                )
            )

        if snapshot_id:
            archive.sync_status = "uploading"
        archive.last_synced_by_user_id = current_user.user.id
        self.session.commit()
        return UserSkillArchiveFilesPrepareData(archive_id=archive.id, targets=targets)

    def confirm_files(
        self,
        current_user: CurrentUserData,
        payload: UserSkillArchiveFilesConfirmRequest,
    ) -> UserSkillArchiveFilesConfirmData:
        self._ensure_archive_enabled()
        archive = self._require_archive(current_user)
        archive_id = archive.id
        bucket = self._bucket()
        checks: list[_FileConfirmationCheck] = []
        for item in payload.files:
            relative_path, normalized_path = _normalize_relative_path(item.relative_path)
            record = self.repository.get_file(archive_id, normalized_path)
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
                        error="数据库中的自制 skill 文件版本与确认请求不一致。",
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
                or record.archive_id != archive_id
                or record.is_deleted
                or record.sha256 != check.sha256
                or record.size_bytes != check.size_bytes
                or record.storage_key != check.storage_key
            ):
                check.status = "mismatch"
                check.error = "自制 skill 文件版本在确认期间发生变化。"
                continue
            if check.status == "ready":
                self.repository.mark_file_ready(record)
            else:
                self.repository.mark_file_failed(record, check.error or "OSS 对象确认失败。")

        self.session.commit()
        return UserSkillArchiveFilesConfirmData(
            results=[
                UserSkillArchiveFileConfirmationResult(
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
        payload: UserSkillArchiveSnapshotCompleteRequest,
    ) -> UserSkillArchiveSnapshotCompleteData:
        self._ensure_archive_enabled()
        archive = self._require_archive(current_user)
        if archive.active_snapshot_id != snapshot_id:
            raise AppError(
                409,
                "自制 skill 快照已被更新，旧快照不能完成。",
                error_code="user_skill_archive_snapshot_superseded",
            )

        for skill in payload.skills:
            self.repository.upsert_entry(
                archive_id=archive.id,
                slug=skill.slug,
                name=skill.name,
                description=skill.description or "",
                enabled=skill.enabled,
                validation_status=skill.validation_status,
                validation_message=skill.validation_message,
                file_count=skill.file_count,
                updated_at_client=skill.updated_at,
                snapshot_id=snapshot_id,
            )

        ready_count, pending_count, deleted_count, skill_count = self.repository.complete_snapshot(
            archive,
            snapshot_id,
            mark_missing_deleted=payload.scan_complete,
        )
        archive.active_snapshot_id = None
        if payload.scan_complete:
            archive.last_completed_snapshot_id = snapshot_id
            archive.file_count = payload.file_count
            archive.total_bytes = payload.total_bytes
            archive.skill_count = skill_count
            if payload.skills_root_name is not None:
                archive.skills_root_name = payload.skills_root_name
        archive.sync_status = "ready" if payload.scan_complete and pending_count == 0 else "partial"
        archive.last_synced_by_user_id = current_user.user.id
        archive.last_synced_at = utcnow()
        self.session.commit()
        return UserSkillArchiveSnapshotCompleteData(
            archive_id=archive.id,
            snapshot_id=snapshot_id,
            sync_status=archive.sync_status,
            ready_file_count=ready_count,
            pending_file_count=pending_count,
            deleted_file_count=deleted_count,
            skill_count=skill_count,
            file_count=archive.file_count,
            total_bytes=archive.total_bytes,
            scan_complete=payload.scan_complete,
        )

    def _require_archive(self, current_user: CurrentUserData):
        archive = self.repository.get_archive(
            current_user.organization.id,
            current_user.user.id,
        )
        if archive is None:
            raise AppError(
                404,
                "未找到对应的自制 skill 归档。",
                error_code="user_skill_archive_not_found",
            )
        return archive

    @staticmethod
    def _file_storage_key(
        organization_id: str,
        user_id: str,
        sha256: str,
        extension: str,
    ) -> str:
        return (
            f"user-skill-archives/{organization_id}/{user_id}/files/"
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
            raise AppError(500, "自制 skill 归档 OSS 配置不完整。", error_code="user_skill_archive_oss_missing")
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
                error_code="user_skill_archive_sign_url_failed",
            ) from exc

    def _ensure_archive_enabled(self) -> None:
        if not self.settings.project_archive_enabled:
            raise AppError(
                404,
                "项目归档与自制 skill 归档未启用。",
                error_code="project_archive_disabled",
            )
