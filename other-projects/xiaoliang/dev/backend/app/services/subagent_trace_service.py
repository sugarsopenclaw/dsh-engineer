from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.models.subagent_trace import (
    SubagentTraceBlobConfirmationResult,
    SubagentTraceBlobUploadTarget,
    SubagentTraceConfirmData,
    SubagentTraceConfirmRequest,
    SubagentTracePrepareData,
    SubagentTracePrepareRequest,
)
from app.models.user import CurrentUserData
from app.repositories.project_archive_repository import ProjectArchiveRepository
from app.repositories.subagent_trace_repository import (
    SubagentTraceRepository,
    SubagentTraceScopeConflictError,
)
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials


class TraceObjectIntegrityError(RuntimeError):
    pass


def _parse_client_timestamp(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AppError(422, "子代理运行时间无效。", error_code="subagent_trace_invalid_time") from exc


class SubagentTraceService:
    def __init__(self, settings: Settings, session: Session) -> None:
        self.settings = settings
        self.session = session
        self.repository = SubagentTraceRepository(session)
        self.project_repository = ProjectArchiveRepository(session)

    def prepare(
        self,
        current_user: CurrentUserData,
        payload: SubagentTracePrepareRequest,
    ) -> SubagentTracePrepareData:
        self._ensure_enabled()
        started_at = _parse_client_timestamp(payload.started_at)
        finished_at = _parse_client_timestamp(payload.finished_at)
        if finished_at < started_at:
            raise AppError(
                422,
                "子代理结束时间不能早于开始时间。",
                error_code="subagent_trace_invalid_time",
            )
        maximum_bytes = int(self.settings.subagent_trace_max_file_mb) * 1024 * 1024
        if payload.trace_size_bytes > maximum_bytes:
            raise AppError(
                413,
                f"子代理轨迹超过归档上限（{self.settings.subagent_trace_max_file_mb}MB）。",
                error_code="subagent_trace_too_large",
            )
        if sum(blob.size_bytes for blob in payload.blobs) > maximum_bytes:
            raise AppError(
                413,
                "子代理截图总量超过归档上限。",
                error_code="subagent_trace_blobs_too_large",
            )

        self._ensure_existing_trace_scope(current_user, payload)
        project = self._require_or_create_project(current_user, payload)
        storage_key = (
            f"subagent-traces/{current_user.organization.id}/{project.id}/"
            f"{payload.child_run_id}/{payload.trace_sha256}.jsonl"
        )
        try:
            record = self.repository.upsert(
                organization_id=current_user.organization.id,
                project_archive_id=project.id,
                user_id=current_user.user.id,
                storage_key=storage_key,
                payload=payload,
            )
        except SubagentTraceScopeConflictError as exc:
            raise AppError(
                409,
                "子代理运行标识已属于其他归档范围。",
                error_code="subagent_trace_scope_conflict",
            ) from exc
        blob_targets: list[SubagentTraceBlobUploadTarget] = []
        for blob in payload.blobs:
            extension = {
                "image/jpeg": ".jpg",
                "image/webp": ".webp",
                "image/gif": ".gif",
            }.get(blob.mime_type, ".png")
            blob_storage_key = (
                f"subagent-traces/{current_user.organization.id}/{project.id}/"
                f"{payload.child_run_id}/blobs/{blob.sha256}{extension}"
            )
            blob_record = self.repository.upsert_blob(
                trace_archive_id=record.id,
                sha256=blob.sha256,
                media_type=blob.mime_type,
                size_bytes=blob.size_bytes,
                storage_key=blob_storage_key,
            )
            if blob_record.upload_status == "ready":
                blob_targets.append(
                    SubagentTraceBlobUploadTarget(
                        sha256=blob.sha256,
                        upload_required=False,
                        storage_key=blob_storage_key,
                    )
                )
                continue
            blob_headers = {
                "Content-Type": blob.mime_type,
                "x-oss-meta-sha256": blob.sha256,
            }
            blob_targets.append(
                SubagentTraceBlobUploadTarget(
                    sha256=blob.sha256,
                    upload_required=True,
                    storage_key=blob_storage_key,
                    upload_url=self._sign_put_url(blob_storage_key, blob_headers),
                    required_headers=blob_headers,
                    expires_in_seconds=int(self.settings.subagent_trace_upload_url_ttl_seconds),
                )
            )
        if record.upload_status == "ready":
            self.session.commit()
            return SubagentTracePrepareData(
                trace_archive_id=record.id,
                child_run_id=record.child_run_id,
                trace_sha256=record.trace_sha256,
                upload_required=False,
                storage_key=record.storage_key,
                blob_targets=blob_targets,
            )

        required_headers = {
            "Content-Type": "application/x-ndjson",
            "x-oss-meta-sha256": payload.trace_sha256,
        }
        upload_url = self._sign_put_url(storage_key, required_headers)
        self.session.commit()
        return SubagentTracePrepareData(
            trace_archive_id=record.id,
            child_run_id=record.child_run_id,
            trace_sha256=record.trace_sha256,
            upload_required=True,
            storage_key=record.storage_key,
            upload_url=upload_url,
            required_headers=required_headers,
            expires_in_seconds=int(self.settings.subagent_trace_upload_url_ttl_seconds),
            blob_targets=blob_targets,
        )

    def confirm(
        self,
        current_user: CurrentUserData,
        payload: SubagentTraceConfirmRequest,
    ) -> SubagentTraceConfirmData:
        self._ensure_enabled()
        project = self._require_project(current_user, payload.local_project_id)
        record = self.repository.get(current_user.organization.id, payload.child_run_id)
        if (
            record is None
            or record.project_archive_id != project.id
            or record.trace_sha256 != payload.trace_sha256
        ):
            raise AppError(
                409,
                "子代理轨迹版本与确认请求不一致。",
                error_code="subagent_trace_mismatch",
            )

        record_id = record.id
        project_archive_id = project.id
        storage_key = record.storage_key
        expected_size = record.trace_size_bytes
        blob_checks: list[tuple[str, str, str, int, str]] = []
        for sha256 in payload.blob_sha256s:
            blob = self.repository.get_blob(record.id, sha256)
            if blob is None:
                raise AppError(
                    409,
                    "子代理截图清单与确认请求不一致。",
                    error_code="subagent_trace_blob_mismatch",
                )
            blob_checks.append((blob.id, blob.sha256, blob.storage_key, blob.size_bytes, blob.media_type))
        bucket = self._bucket()
        self.session.commit()
        self.session.close()

        status = "ready"
        error: str | None = None
        try:
            self._verify_object(
                bucket=bucket,
                storage_key=storage_key,
                expected_size=expected_size,
                expected_sha256=payload.trace_sha256,
            )
        except TraceObjectIntegrityError as exc:
            status = "mismatch"
            error = str(exc)
        except Exception as exc:  # noqa: BLE001
            status = "missing" if getattr(exc, "status", None) == 404 else "failed"
            error = "OSS 轨迹对象尚不可用。" if status == "missing" else f"OSS 轨迹确认失败: {exc}"

        blob_results: list[SubagentTraceBlobConfirmationResult] = []
        for blob_id, sha256, blob_storage_key, size_bytes, _media_type in blob_checks:
            blob_status = "ready"
            blob_error: str | None = None
            try:
                self._verify_object(
                    bucket=bucket,
                    storage_key=blob_storage_key,
                    expected_size=size_bytes,
                    expected_sha256=sha256,
                )
            except TraceObjectIntegrityError as exc:
                blob_status = "mismatch"
                blob_error = str(exc)
            except Exception as exc:  # noqa: BLE001
                blob_status = "missing" if getattr(exc, "status", None) == 404 else "failed"
                blob_error = "OSS 截图对象尚不可用。" if blob_status == "missing" else f"OSS 截图确认失败: {exc}"
            current_blob = self.repository.get_blob_by_id(blob_id)
            if (
                current_blob is None
                or current_blob.trace_archive_id != record_id
                or current_blob.sha256 != sha256
                or current_blob.storage_key != blob_storage_key
                or current_blob.size_bytes != size_bytes
            ):
                blob_status = "mismatch"
                blob_error = "子代理截图版本在确认期间发生变化。"
            elif blob_status == "ready":
                self.repository.mark_blob_ready(current_blob)
            else:
                self.repository.mark_blob_failed(current_blob, blob_error or "OSS 截图确认失败。")
            blob_results.append(
                SubagentTraceBlobConfirmationResult(
                    sha256=sha256,
                    status=blob_status,  # type: ignore[arg-type]
                    storage_key=blob_storage_key,
                    error=blob_error,
                )
            )

        incomplete_blob = next((item for item in blob_results if item.status != "ready"), None)
        if status == "ready" and incomplete_blob is not None:
            status = incomplete_blob.status
            error = (
                f"子代理截图 {incomplete_blob.sha256[:12]} 未完成完整性校验："
                f"{incomplete_blob.error or 'OSS 截图确认失败。'}"
            )

        current = self.repository.get_by_id(record_id)
        if (
            current is None
            or current.organization_id != current_user.organization.id
            or current.project_archive_id != project_archive_id
            or current.trace_sha256 != payload.trace_sha256
            or current.trace_size_bytes != expected_size
            or current.storage_key != storage_key
        ):
            status = "mismatch"
            error = "子代理轨迹版本在确认期间发生变化。"
        elif status == "ready":
            self.repository.mark_ready(current)
        else:
            self.repository.mark_failed(current, error or "OSS 轨迹确认失败。")
        self.session.commit()
        return SubagentTraceConfirmData(
            trace_archive_id=record_id,
            child_run_id=payload.child_run_id,
            trace_sha256=payload.trace_sha256,
            status=status,  # type: ignore[arg-type]
            storage_key=storage_key,
            error=error,
            blobs=blob_results,
        )

    def _ensure_existing_trace_scope(
        self,
        current_user: CurrentUserData,
        payload: SubagentTracePrepareRequest,
    ) -> None:
        existing = self.repository.get(current_user.organization.id, payload.child_run_id)
        if existing is None:
            return
        project = self.project_repository.get_project(
            current_user.organization.id,
            payload.local_project_id,
        )
        if (
            existing.archived_by_user_id != current_user.user.id
            or project is None
            or project.owner_user_id != current_user.user.id
            or existing.project_archive_id != project.id
        ):
            raise AppError(
                409,
                "子代理运行标识已属于其他归档范围。",
                error_code="subagent_trace_scope_conflict",
            )

    def _require_or_create_project(
        self,
        current_user: CurrentUserData,
        payload: SubagentTracePrepareRequest,
    ):
        project = self.project_repository.get_project(
            current_user.organization.id,
            payload.local_project_id,
        )
        if project is not None and project.owner_user_id != current_user.user.id:
            raise AppError(
                403,
                "当前用户无权归档该项目的子代理轨迹。",
                error_code="subagent_trace_forbidden",
            )
        if project is None:
            project = self.project_repository.upsert_project(
                organization_id=current_user.organization.id,
                user_id=current_user.user.id,
                local_project_id=payload.local_project_id,
                name=payload.project_name,
                description=payload.project_description,
                root_name=payload.project_root_name.strip() if payload.project_root_name else None,
            )
        return project

    def _require_project(self, current_user: CurrentUserData, local_project_id: str):
        project = self.project_repository.get_project(
            current_user.organization.id,
            local_project_id.strip(),
        )
        if project is None:
            raise AppError(404, "未找到对应的项目归档。", error_code="subagent_trace_project_not_found")
        if project.owner_user_id != current_user.user.id:
            raise AppError(403, "当前用户无权访问该轨迹。", error_code="subagent_trace_forbidden")
        return project

    @staticmethod
    def _verify_object(
        *,
        bucket: Any,
        storage_key: str,
        expected_size: int,
        expected_sha256: str,
    ) -> None:
        head = bucket.head_object(storage_key)
        content_length = int(getattr(head, "content_length", -1))
        headers = getattr(head, "headers", {}) or {}
        remote_sha256 = next(
            (
                str(value).strip().lower()
                for key, value in headers.items()
                if str(key).lower() == "x-oss-meta-sha256"
            ),
            "",
        )
        if content_length != expected_size or remote_sha256 != expected_sha256:
            raise TraceObjectIntegrityError("OSS 轨迹对象大小或 SHA-256 元数据不一致。")

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
            raise TraceObjectIntegrityError("OSS 轨迹对象实际内容的 SHA-256 不一致。")

    def _bucket(self):
        if not has_oss_credentials(self.settings):
            raise AppError(500, "子代理轨迹 OSS 配置不完整。", error_code="subagent_trace_oss_missing")
        return get_oss_bucket(self.settings)

    def _sign_put_url(self, storage_key: str, headers: dict[str, str]) -> str:
        try:
            return self._bucket().sign_url(
                "PUT",
                storage_key,
                int(self.settings.subagent_trace_upload_url_ttl_seconds),
                headers=headers,
                slash_safe=True,
            )
        except AppError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AppError(
                502,
                f"生成子代理轨迹 OSS 签名 URL 失败: {exc}",
                error_code="subagent_trace_sign_url_failed",
            ) from exc

    def _ensure_enabled(self) -> None:
        if not self.settings.subagent_trace_archive_enabled:
            raise AppError(404, "子代理轨迹归档未启用。", error_code="subagent_trace_disabled")
