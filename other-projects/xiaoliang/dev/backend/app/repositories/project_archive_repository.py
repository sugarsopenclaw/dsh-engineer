from __future__ import annotations

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.schemas.base import utcnow
from app.schemas.project_archive import (
    ProjectArchive,
    ProjectArchiveConversation,
    ProjectArchiveFile,
    ProjectArchiveMessage,
    ProjectArchiveMessageAttachment,
    PiSessionArchive,
    ProjectDocumentAnalysis,
)


class ProjectArchiveRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_project(self, organization_id: str, local_project_id: str) -> ProjectArchive | None:
        return self.session.scalar(
            select(ProjectArchive).where(
                ProjectArchive.organization_id == organization_id,
                ProjectArchive.local_project_id == local_project_id,
            )
        )

    def upsert_project(
        self,
        *,
        organization_id: str,
        user_id: str,
        local_project_id: str,
        name: str,
        description: str,
        root_name: str | None,
    ) -> ProjectArchive:
        project = self.get_project(organization_id, local_project_id)
        if project is None:
            project = ProjectArchive(
                organization_id=organization_id,
                owner_user_id=user_id,
                last_synced_by_user_id=user_id,
                local_project_id=local_project_id,
                name=name,
                description=description,
                root_name=root_name,
            )
            self.session.add(project)
        else:
            project.last_synced_by_user_id = user_id
            project.name = name
            project.description = description
            project.root_name = root_name
        self.session.flush()
        return project

    def get_file(self, project_archive_id: str, normalized_path: str) -> ProjectArchiveFile | None:
        return self.session.scalar(
            select(ProjectArchiveFile).where(
                ProjectArchiveFile.project_archive_id == project_archive_id,
                ProjectArchiveFile.normalized_path == normalized_path,
            )
        )

    def get_file_by_id(self, project_file_id: str) -> ProjectArchiveFile | None:
        return self.session.get(ProjectArchiveFile, project_file_id)

    def upsert_file(
        self,
        *,
        project_archive_id: str,
        user_id: str,
        relative_path: str,
        normalized_path: str,
        filename: str,
        extension: str,
        media_type: str,
        size_bytes: int,
        sha256: str,
        modified_at_client: str | None,
        storage_key: str,
        snapshot_id: str | None,
    ) -> ProjectArchiveFile:
        record = self.get_file(project_archive_id, normalized_path)
        now = utcnow()
        if record is None:
            record = ProjectArchiveFile(
                project_archive_id=project_archive_id,
                archived_by_user_id=user_id,
                relative_path=relative_path,
                normalized_path=normalized_path,
                filename=filename,
                extension=extension,
                media_type=media_type,
                size_bytes=size_bytes,
                sha256=sha256,
                modified_at_client=modified_at_client,
                storage_key=storage_key,
                upload_status="pending",
                is_deleted=False,
                last_seen_snapshot_id=snapshot_id,
                last_seen_at=now,
            )
            self.session.add(record)
        else:
            content_changed = (
                record.sha256 != sha256
                or record.size_bytes != size_bytes
                or record.storage_key != storage_key
            )
            record.archived_by_user_id = user_id
            record.relative_path = relative_path
            record.filename = filename
            record.extension = extension
            record.media_type = media_type
            record.size_bytes = size_bytes
            record.sha256 = sha256
            record.modified_at_client = modified_at_client
            record.storage_key = storage_key
            record.is_deleted = False
            record.last_seen_snapshot_id = snapshot_id or record.last_seen_snapshot_id
            record.last_seen_at = now
            if content_changed:
                record.upload_status = "pending"
                record.upload_error = None
                record.uploaded_at = None

        self.session.flush()
        return record

    def mark_file_ready(self, record: ProjectArchiveFile) -> None:
        record.upload_status = "ready"
        record.upload_error = None
        record.uploaded_at = utcnow()
        record.is_deleted = False
        self.session.flush()

    def mark_file_failed(self, record: ProjectArchiveFile, error: str) -> None:
        record.upload_status = "failed"
        record.upload_error = error[:4000]
        self.session.flush()

    def complete_snapshot(
        self,
        project: ProjectArchive,
        snapshot_id: str,
        *,
        mark_missing_deleted: bool,
    ) -> tuple[int, int, int]:
        deleted_count = 0
        if mark_missing_deleted:
            deleted_result = self.session.execute(
                update(ProjectArchiveFile)
                .where(
                    ProjectArchiveFile.project_archive_id == project.id,
                    ProjectArchiveFile.is_deleted.is_(False),
                    or_(
                        ProjectArchiveFile.last_seen_snapshot_id.is_(None),
                        ProjectArchiveFile.last_seen_snapshot_id != snapshot_id,
                    ),
                )
                .values(is_deleted=True)
            )
            deleted_count = int(deleted_result.rowcount or 0)
        ready_count = int(
            self.session.scalar(
                select(func.count(ProjectArchiveFile.id)).where(
                    ProjectArchiveFile.project_archive_id == project.id,
                    ProjectArchiveFile.is_deleted.is_(False),
                    ProjectArchiveFile.upload_status == "ready",
                )
            )
            or 0
        )
        pending_count = int(
            self.session.scalar(
                select(func.count(ProjectArchiveFile.id)).where(
                    ProjectArchiveFile.project_archive_id == project.id,
                    ProjectArchiveFile.is_deleted.is_(False),
                    ProjectArchiveFile.upload_status != "ready",
                )
            )
            or 0
        )
        return ready_count, pending_count, deleted_count

    def get_conversation(
        self,
        project_archive_id: str,
        local_conversation_id: str,
    ) -> ProjectArchiveConversation | None:
        return self.session.scalar(
            select(ProjectArchiveConversation).where(
                ProjectArchiveConversation.project_archive_id == project_archive_id,
                ProjectArchiveConversation.local_conversation_id == local_conversation_id,
            )
        )

    def upsert_conversation(
        self,
        *,
        project_archive_id: str,
        user_id: str,
        local_conversation_id: str,
        title: str,
        creation_source: str,
        conversation_mode: str,
        drawing_id: str | None,
        drawing_name: str | None,
        is_pinned: bool,
        preferred_model_id: str | None,
        preferred_thinking_mode: str | None,
        context_usage_json: str | None,
        session_sync_scope: str | None,
        parent_local_conversation_id: str | None,
        forked_from_entry_id: str | None,
        source_updated_at: str | None,
    ) -> ProjectArchiveConversation:
        record = self.get_conversation(project_archive_id, local_conversation_id)
        now = utcnow()
        if record is None:
            record = ProjectArchiveConversation(
                project_archive_id=project_archive_id,
                source_user_id=user_id,
                local_conversation_id=local_conversation_id,
            )
            self.session.add(record)
        record.source_user_id = user_id
        record.title = title
        record.creation_source = creation_source
        record.conversation_mode = conversation_mode
        record.drawing_id = drawing_id
        record.drawing_name = drawing_name
        record.is_pinned = is_pinned
        record.preferred_model_id = preferred_model_id
        record.preferred_thinking_mode = preferred_thinking_mode
        record.context_usage_json = context_usage_json
        record.session_sync_scope = session_sync_scope
        record.parent_local_conversation_id = parent_local_conversation_id
        record.forked_from_entry_id = forked_from_entry_id
        record.source_updated_at = source_updated_at
        record.last_synced_at = now
        record.is_deleted = False
        self.session.flush()
        return record

    def mark_conversation_messages_deleted(self, conversation_id: str) -> None:
        self.session.execute(
            update(ProjectArchiveMessage)
            .where(ProjectArchiveMessage.conversation_id == conversation_id)
            .values(is_deleted=True)
        )

    def get_message(self, conversation_id: str, source_key: str) -> ProjectArchiveMessage | None:
        return self.session.scalar(
            select(ProjectArchiveMessage).where(
                ProjectArchiveMessage.conversation_id == conversation_id,
                ProjectArchiveMessage.source_key == source_key,
            )
        )

    def upsert_message(
        self,
        *,
        conversation_id: str,
        local_message_id: str | None,
        client_run_id: str | None,
        pi_session_id: str | None,
        pi_entry_id: str | None,
        source_key: str,
        ordinal: int,
        role: str,
        content: str,
        tool_name: str,
        tool_args: str,
        tool_result: str,
        thinking: str,
        parts_json: str | None,
        source_created_at: str | None,
    ) -> ProjectArchiveMessage:
        record = self.get_message(conversation_id, source_key)
        if record is None:
            record = ProjectArchiveMessage(
                conversation_id=conversation_id,
                source_key=source_key,
            )
            self.session.add(record)
        record.local_message_id = local_message_id
        record.client_run_id = client_run_id
        record.pi_session_id = pi_session_id
        record.pi_entry_id = pi_entry_id
        record.ordinal = ordinal
        record.role = role
        record.content = content
        record.tool_name = tool_name
        record.tool_args = tool_args
        record.tool_result = tool_result
        record.thinking = thinking
        record.parts_json = parts_json
        record.source_created_at = source_created_at
        record.last_synced_at = utcnow()
        record.is_deleted = False
        self.session.flush()
        return record

    def get_pi_session_archive(
        self,
        *,
        conversation_archive_id: str,
        pi_session_id: str,
        sha256: str,
    ) -> PiSessionArchive | None:
        return self.session.scalar(
            select(PiSessionArchive).where(
                PiSessionArchive.conversation_archive_id == conversation_archive_id,
                PiSessionArchive.pi_session_id == pi_session_id,
                PiSessionArchive.sha256 == sha256,
            )
        )

    def get_pi_session_archive_by_id(self, archive_id: str) -> PiSessionArchive | None:
        return self.session.get(PiSessionArchive, archive_id)

    def upsert_pi_session_archive(
        self,
        *,
        organization_id: str,
        project_archive_id: str,
        conversation_archive_id: str,
        user_id: str,
        local_conversation_id: str,
        pi_session_id: str,
        parent_pi_session_id: str | None,
        runtime_version: int,
        jsonl_schema_version: int,
        current_leaf_entry_id: str | None,
        entry_count: int,
        sha256: str,
        size_bytes: int,
        source_modified_at: str | None,
        storage_key: str,
        training_consent: bool,
    ) -> PiSessionArchive:
        record = self.get_pi_session_archive(
            conversation_archive_id=conversation_archive_id,
            pi_session_id=pi_session_id,
            sha256=sha256,
        )
        if record is None:
            record = PiSessionArchive(
                organization_id=organization_id,
                project_archive_id=project_archive_id,
                conversation_archive_id=conversation_archive_id,
                archived_by_user_id=user_id,
                local_conversation_id=local_conversation_id,
                pi_session_id=pi_session_id,
                sha256=sha256,
                size_bytes=size_bytes,
                storage_key=storage_key,
                runtime_version=runtime_version,
                jsonl_schema_version=jsonl_schema_version,
            )
            self.session.add(record)
        record.archived_by_user_id = user_id
        if parent_pi_session_id is not None:
            record.parent_pi_session_id = parent_pi_session_id
        record.runtime_version = runtime_version
        record.jsonl_schema_version = jsonl_schema_version
        record.current_leaf_entry_id = current_leaf_entry_id
        record.entry_count = entry_count
        record.size_bytes = size_bytes
        record.source_modified_at = source_modified_at
        record.storage_key = storage_key
        record.training_consent = training_consent
        self.session.flush()
        return record

    def mark_pi_session_archive_ready(self, record: PiSessionArchive) -> None:
        record.upload_status = "ready"
        record.upload_error = None
        record.uploaded_at = utcnow()
        self.session.flush()

    def mark_pi_session_archive_failed(self, record: PiSessionArchive, error: str) -> None:
        record.upload_status = "failed"
        record.upload_error = error[:4000]
        self.session.flush()

    def mark_message_attachments_deleted(self, message_id: str) -> None:
        self.session.execute(
            update(ProjectArchiveMessageAttachment)
            .where(ProjectArchiveMessageAttachment.message_id == message_id)
            .values(is_deleted=True)
        )

    def get_attachment(
        self,
        message_id: str,
        local_attachment_id: str,
    ) -> ProjectArchiveMessageAttachment | None:
        return self.session.scalar(
            select(ProjectArchiveMessageAttachment).where(
                ProjectArchiveMessageAttachment.message_id == message_id,
                ProjectArchiveMessageAttachment.local_attachment_id == local_attachment_id,
            )
        )

    def get_attachment_by_id(
        self,
        attachment_id: str,
    ) -> ProjectArchiveMessageAttachment | None:
        return self.session.get(ProjectArchiveMessageAttachment, attachment_id)

    def upsert_attachment(
        self,
        *,
        message_id: str,
        local_attachment_id: str,
        filename: str | None,
        media_type: str,
    ) -> ProjectArchiveMessageAttachment:
        record = self.get_attachment(message_id, local_attachment_id)
        if record is None:
            record = ProjectArchiveMessageAttachment(
                message_id=message_id,
                local_attachment_id=local_attachment_id,
                media_type=media_type,
            )
            self.session.add(record)
        record.filename = filename
        record.media_type = media_type
        record.is_deleted = False
        self.session.flush()
        return record

    def get_analysis(self, project_file_id: str, fingerprint: str) -> ProjectDocumentAnalysis | None:
        return self.session.scalar(
            select(ProjectDocumentAnalysis).where(
                ProjectDocumentAnalysis.project_file_id == project_file_id,
                ProjectDocumentAnalysis.request_fingerprint == fingerprint,
            )
        )

    def upsert_analysis(
        self,
        *,
        project_file_id: str,
        user_id: str,
        fingerprint: str,
        instruction: str,
        parsing_strategy: str,
    ) -> ProjectDocumentAnalysis:
        record = self.get_analysis(project_file_id, fingerprint)
        if record is None:
            record = ProjectDocumentAnalysis(
                project_file_id=project_file_id,
                requested_by_user_id=user_id,
                request_fingerprint=fingerprint,
                instruction=instruction,
                file_parsing_strategy=parsing_strategy,
            )
            self.session.add(record)
        else:
            record.requested_by_user_id = user_id
            record.instruction = instruction
            record.file_parsing_strategy = parsing_strategy
            record.status = "pending"
            record.error_message = None
        self.session.flush()
        return record

    @staticmethod
    def finish_analysis(
        record: ProjectDocumentAnalysis,
        *,
        model: str,
        fallback_used: bool,
        content: str,
        truncated: bool,
        warnings_json: str,
        usage_json: str | None,
    ) -> None:
        record.model = model
        record.fallback_used = fallback_used
        record.status = "completed"
        record.content = content
        record.truncated = truncated
        record.warnings_json = warnings_json
        record.usage_json = usage_json
        record.error_message = None
        record.completed_at = utcnow()

    def fail_analysis(
        self,
        *,
        project_file_id: str,
        fingerprint: str,
        error: str,
    ) -> bool:
        """Mark an unfinished attempt failed without destroying a completed cache row."""
        result = self.session.execute(
            update(ProjectDocumentAnalysis)
            .where(
                ProjectDocumentAnalysis.project_file_id == project_file_id,
                ProjectDocumentAnalysis.request_fingerprint == fingerprint,
                ProjectDocumentAnalysis.status != "completed",
            )
            .values(
                status="failed",
                error_message=error[:4000],
                completed_at=utcnow(),
            )
            .execution_options(synchronize_session=False)
        )
        return int(result.rowcount or 0) > 0
