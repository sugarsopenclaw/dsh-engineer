from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.subagent_trace import SubagentTracePrepareRequest
from app.schemas.base import utcnow
from app.schemas.subagent_trace import SubagentTraceArchive, SubagentTraceBlobArchive


class SubagentTraceScopeConflictError(RuntimeError):
    """Raised when an upsert attempts to move a child run across users or projects."""


class SubagentTraceRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, organization_id: str, child_run_id: str) -> SubagentTraceArchive | None:
        return self.session.scalar(
            select(SubagentTraceArchive).where(
                SubagentTraceArchive.organization_id == organization_id,
                SubagentTraceArchive.child_run_id == child_run_id,
            )
        )

    def get_by_id(self, trace_archive_id: str) -> SubagentTraceArchive | None:
        return self.session.get(SubagentTraceArchive, trace_archive_id)

    def upsert(
        self,
        *,
        organization_id: str,
        project_archive_id: str,
        user_id: str,
        storage_key: str,
        payload: SubagentTracePrepareRequest,
    ) -> SubagentTraceArchive:
        record = self.get(organization_id, payload.child_run_id)
        if record is None:
            record = SubagentTraceArchive(
                organization_id=organization_id,
                project_archive_id=project_archive_id,
                archived_by_user_id=user_id,
                child_run_id=payload.child_run_id,
                parent_session_id=payload.parent_session_id,
                parent_prompt_id=payload.parent_prompt_id,
                parent_pi_session_id=payload.parent_pi_session_id,
                parent_pi_entry_id=payload.parent_pi_entry_id,
                client_run_id=payload.client_run_id,
                agent_type=payload.agent_type,
                status=payload.status,
                model=payload.model,
                started_at_client=payload.started_at,
                finished_at_client=payload.finished_at,
                usage_json="{}",
                trace_schema_version=payload.trace_schema_version,
                event_count=payload.event_count,
                trace_sha256=payload.trace_sha256,
                trace_size_bytes=payload.trace_size_bytes,
                storage_key=storage_key,
            )
            self.session.add(record)
        elif (
            record.project_archive_id != project_archive_id
            or record.archived_by_user_id != user_id
        ):
            raise SubagentTraceScopeConflictError(
                "A subagent trace archive cannot be rebound to another user or project."
            )
        content_changed = (
            record.trace_sha256 != payload.trace_sha256
            or record.trace_size_bytes != payload.trace_size_bytes
            or record.storage_key != storage_key
        )
        record.parent_session_id = payload.parent_session_id
        record.parent_prompt_id = payload.parent_prompt_id
        record.parent_pi_session_id = payload.parent_pi_session_id
        record.parent_pi_entry_id = payload.parent_pi_entry_id
        record.client_run_id = payload.client_run_id
        record.agent_type = payload.agent_type
        record.status = payload.status
        record.model = payload.model
        record.started_at_client = payload.started_at
        record.finished_at_client = payload.finished_at
        record.usage_json = json.dumps(payload.usage.model_dump(), ensure_ascii=False, separators=(",", ":"))
        record.tool_call_count = payload.tool_call_count
        record.artifact_refs_json = json.dumps(payload.artifact_refs, ensure_ascii=False, separators=(",", ":"))
        record.error_code = payload.error_code
        record.trace_schema_version = payload.trace_schema_version
        record.event_count = payload.event_count
        record.trace_sha256 = payload.trace_sha256
        record.trace_size_bytes = payload.trace_size_bytes
        record.storage_key = storage_key
        record.training_consent = payload.training_consent
        if content_changed:
            record.upload_status = "pending"
            record.upload_error = None
            record.uploaded_at = None
        self.session.flush()
        return record

    def mark_ready(self, record: SubagentTraceArchive) -> None:
        record.upload_status = "ready"
        record.upload_error = None
        record.uploaded_at = utcnow()
        self.session.flush()

    def mark_failed(self, record: SubagentTraceArchive, error: str) -> None:
        record.upload_status = "failed"
        record.upload_error = error[:4000]
        self.session.flush()

    def get_blob(self, trace_archive_id: str, sha256: str) -> SubagentTraceBlobArchive | None:
        return self.session.scalar(
            select(SubagentTraceBlobArchive).where(
                SubagentTraceBlobArchive.trace_archive_id == trace_archive_id,
                SubagentTraceBlobArchive.sha256 == sha256,
            )
        )

    def get_blob_by_id(self, blob_archive_id: str) -> SubagentTraceBlobArchive | None:
        return self.session.get(SubagentTraceBlobArchive, blob_archive_id)

    def upsert_blob(
        self,
        *,
        trace_archive_id: str,
        sha256: str,
        media_type: str,
        size_bytes: int,
        storage_key: str,
    ) -> SubagentTraceBlobArchive:
        record = self.get_blob(trace_archive_id, sha256)
        if record is None:
            record = SubagentTraceBlobArchive(
                trace_archive_id=trace_archive_id,
                sha256=sha256,
                media_type=media_type,
                size_bytes=size_bytes,
                storage_key=storage_key,
            )
            self.session.add(record)
        content_changed = (
            record.media_type != media_type
            or record.size_bytes != size_bytes
            or record.storage_key != storage_key
        )
        record.media_type = media_type
        record.size_bytes = size_bytes
        record.storage_key = storage_key
        if content_changed:
            record.upload_status = "pending"
            record.upload_error = None
            record.uploaded_at = None
        self.session.flush()
        return record

    def mark_blob_ready(self, record: SubagentTraceBlobArchive) -> None:
        record.upload_status = "ready"
        record.upload_error = None
        record.uploaded_at = utcnow()
        self.session.flush()

    def mark_blob_failed(self, record: SubagentTraceBlobArchive, error: str) -> None:
        record.upload_status = "failed"
        record.upload_error = error[:4000]
        self.session.flush()
