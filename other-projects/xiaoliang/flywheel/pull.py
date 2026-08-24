"""Pull production archives into flywheel/corpus, grouped by user."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from flywheel.blobs import BlobStore, HashMismatch
from flywheel.classify import skip_download
from flywheel.config import corpus_dir
from flywheel.extra_orm import (
    ProjectDocumentAnalysis,
    UserPromptTemplate,
    UserSkillArchive,
    UserSkillArchiveEntry,
    UserSkillArchiveFile,
)
from flywheel.layout import (
    build_tree,
    folder_name,
    iso,
    safe_join,
    utc_now,
    user_dir_name,
    write_json,
    write_text,
)
from flywheel.prod import bootstrap_admin, prod_session
from flywheel.sqlite_store import LocalStore

bootstrap_admin()
from sqlalchemy import func, select  # noqa: E402
from app.schemas_orm import (  # noqa: E402
    AgentMessageFeedback,
    AgentUsageCall,
    AgentUsageRun,
    PiSessionArchive,
    ProjectArchive,
    ProjectArchiveConversation,
    ProjectArchiveFile,
    ProjectArchiveMessage,
    ProjectArchiveMessageAttachment,
    SubagentTraceArchive,
    SubagentTraceBlobArchive,
    User,
)

log = logging.getLogger("flywheel")

BLOB_MEDIA_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


@dataclass
class PullOptions:
    dry_run: bool = False
    force: bool = False
    workers: int = 4
    user_filter: str | None = None
    corpus: Path | None = None


@dataclass
class DownloadJob:
    table: str
    record_id: str
    storage_key: str
    expected_sha256: str | None
    expected_size: int | None
    source_kind: str
    dests: list[Path] = field(default_factory=list)


def _bool_int(value: Any) -> int | None:
    if value is None:
        return None
    return 1 if value else 0


class Puller:
    def __init__(self, options: PullOptions) -> None:
        self.options = options
        self.corpus = options.corpus or corpus_dir()
        self.users_root = self.corpus / "users"
        self.store = LocalStore(self.corpus / "index.sqlite")
        self.blobs = BlobStore(self.corpus / "blobs")
        self.stats: dict[str, Any] = defaultdict(int)
        self._jobs: list[DownloadJob] = []

    def run(self) -> dict[str, Any]:
        self.corpus.mkdir(parents=True, exist_ok=True)
        self.users_root.mkdir(parents=True, exist_ok=True)
        run_id = self.store.start_run(
            dry_run=self.options.dry_run,
            force=self.options.force,
            user_filter=self.options.user_filter,
        )
        status = "success"
        try:
            with prod_session() as db:
                users = self._included_users(db)
                log.info("included_users=%s dry_run=%s", len(users), self.options.dry_run)
                for user in users:
                    self._inventory_user(db, user)
            if not self.options.dry_run:
                self._download_all()
                self._materialize()
            else:
                log.info("dry-run: skipped OSS downloads (%s jobs planned)", len(self._jobs))
            self.stats["jobs_planned"] = len(self._jobs)
            self.stats["users"] = int(self.store.query("SELECT COUNT(*) AS n FROM users")[0]["n"])
            self.stats["file_status"] = self.store.file_status_counts()
            self.stats["counts"] = self.store.counts()
            write_json(self.corpus / "PULL_REPORT.json", {
                "finished_at": utc_now(),
                "dry_run": self.options.dry_run,
                "stats": self.stats,
            })
            return {"run_id": run_id, "stats": dict(self.stats)}
        except Exception:
            status = "failed"
            raise
        finally:
            self.store.finish_run(run_id, status, dict(self.stats))
            self.store.close()

    def _included_users(self, db) -> list[User]:
        msg_ids = set(
            db.execute(
                select(ProjectArchiveConversation.source_user_id)
                .join(
                    ProjectArchiveMessage,
                    ProjectArchiveMessage.conversation_id == ProjectArchiveConversation.id,
                )
                .where(
                    ProjectArchiveConversation.is_deleted.is_(False),
                    ProjectArchiveMessage.is_deleted.is_(False),
                    ProjectArchiveConversation.source_user_id.isnot(None),
                )
                .distinct()
            ).scalars()
        )
        run_ids = set(db.execute(select(AgentUsageRun.user_id).distinct()).scalars())
        stmt = select(User).order_by(User.created_at.asc())
        if self.options.user_filter:
            stmt = stmt.where(func.lower(User.email) == self.options.user_filter.lower())
        users = []
        for user in db.execute(stmt).scalars():
            email = (user.email or "").lower()
            if email.endswith("@example.com"):
                continue
            has_messages = user.id in msg_ids
            has_runs = user.id in run_ids
            if not has_messages and not has_runs:
                continue
            users.append(user)
            self.store.upsert("users", {
                "id": user.id,
                "email": user.email,
                "display_name": user.display_name,
                "is_active": _bool_int(user.is_active),
                "created_at": iso(user.created_at),
                "has_messages": int(has_messages),
                "has_usage_runs": int(has_runs),
                "archive_gap": None if has_messages else "no_project_conversation",
                "local_dir": str(self.users_root / user_dir_name(user.email)),
            })
        self.store.commit()
        return users

    def _scalars(self, db, stmt) -> list:
        return list(db.execute(stmt).scalars())

    def _group(self, rows, key) -> dict:
        grouped: dict[str, list] = defaultdict(list)
        for row in rows:
            grouped[key(row)].append(row)
        return grouped

    def _inventory_user(self, db, user: User) -> None:
        email_dir = self.users_root / user_dir_name(user.email)
        email_dir.mkdir(parents=True, exist_ok=True)

        owned_projects = self._scalars(db, select(ProjectArchive).where(ProjectArchive.owner_user_id == user.id))
        conversations = self._scalars(
            db,
            select(ProjectArchiveConversation)
            .where(
                ProjectArchiveConversation.source_user_id == user.id,
                ProjectArchiveConversation.is_deleted.is_(False),
            )
            .order_by(ProjectArchiveConversation.created_at.asc()),
        )
        extra_project_ids = {
            conv.project_archive_id
            for conv in conversations
            if conv.project_archive_id not in {p.id for p in owned_projects}
        }
        extra_projects = []
        if extra_project_ids:
            extra_projects = self._scalars(
                db, select(ProjectArchive).where(ProjectArchive.id.in_(extra_project_ids))
            )
        projects = list(owned_projects) + list(extra_projects)
        project_ids = [item.id for item in projects]
        conv_ids = [item.id for item in conversations]
        log.info(
            "inventory user=%s projects=%s convs=%s",
            user.email,
            len(projects),
            len(conversations),
        )

        files = []
        traces = []
        if project_ids:
            files = self._scalars(
                db,
                select(ProjectArchiveFile)
                .where(ProjectArchiveFile.project_archive_id.in_(project_ids))
                .order_by(ProjectArchiveFile.normalized_path.asc()),
            )
            traces = self._scalars(
                db, select(SubagentTraceArchive).where(SubagentTraceArchive.project_archive_id.in_(project_ids))
            )
        files_by_project = self._group(files, lambda item: item.project_archive_id)
        traces_by_project = self._group(traces, lambda item: item.project_archive_id)

        file_ids = [item.id for item in files]
        analyses = []
        if file_ids:
            analyses = self._scalars(
                db, select(ProjectDocumentAnalysis).where(ProjectDocumentAnalysis.project_file_id.in_(file_ids))
            )
        analyses_by_file = self._group(analyses, lambda item: item.project_file_id)

        messages = []
        sessions = []
        if conv_ids:
            messages = self._scalars(
                db,
                select(ProjectArchiveMessage)
                .where(ProjectArchiveMessage.conversation_id.in_(conv_ids))
                .order_by(ProjectArchiveMessage.ordinal.asc(), ProjectArchiveMessage.created_at.asc()),
            )
            sessions = self._scalars(
                db,
                select(PiSessionArchive)
                .where(PiSessionArchive.conversation_archive_id.in_(conv_ids))
                .order_by(PiSessionArchive.uploaded_at.desc().nullslast()),
            )
        messages_by_conv = self._group(messages, lambda item: item.conversation_id)
        sessions_by_conv = self._group(sessions, lambda item: item.conversation_archive_id)

        message_ids = [item.id for item in messages]
        attachments = []
        if message_ids:
            attachments = self._scalars(
                db,
                select(ProjectArchiveMessageAttachment).where(
                    ProjectArchiveMessageAttachment.message_id.in_(message_ids)
                ),
            )
        attachments_by_message = self._group(attachments, lambda item: item.message_id)

        trace_ids = [item.id for item in traces]
        trace_blobs = []
        if trace_ids:
            trace_blobs = self._scalars(
                db, select(SubagentTraceBlobArchive).where(SubagentTraceBlobArchive.trace_archive_id.in_(trace_ids))
            )
        blobs_by_trace = self._group(trace_blobs, lambda item: item.trace_archive_id)

        usage_runs = self._scalars(
            db,
            select(AgentUsageRun).where(AgentUsageRun.user_id == user.id).order_by(AgentUsageRun.started_at.asc()),
        )
        run_ids = [item.id for item in usage_runs]
        usage_calls = []
        if run_ids:
            usage_calls = self._scalars(db, select(AgentUsageCall).where(AgentUsageCall.agent_run_id.in_(run_ids)))
        feedback_rows = self._scalars(
            db, select(AgentMessageFeedback).where(AgentMessageFeedback.user_id == user.id)
        )
        templates = self._scalars(db, select(UserPromptTemplate).where(UserPromptTemplate.user_id == user.id))
        skill_archives = self._scalars(
            db, select(UserSkillArchive).where(UserSkillArchive.owner_user_id == user.id)
        )
        archive_ids = [item.id for item in skill_archives]
        skill_entries = []
        skill_files = []
        if archive_ids:
            skill_entries = self._scalars(
                db, select(UserSkillArchiveEntry).where(UserSkillArchiveEntry.archive_id.in_(archive_ids))
            )
            skill_files = self._scalars(
                db, select(UserSkillArchiveFile).where(UserSkillArchiveFile.archive_id.in_(archive_ids))
            )
        entries_by_archive = self._group(skill_entries, lambda item: item.archive_id)
        skill_files_by_archive = self._group(skill_files, lambda item: item.archive_id)

        catalog_projects = []
        catalog_conversations = []
        for project in projects:
            project_files = files_by_project.get(project.id, [])
            file_analyses = [
                item
                for file_row in project_files
                for item in analyses_by_file.get(file_row.id, [])
            ]
            catalog_projects.append(
                self._inventory_project(user, email_dir, project, conversations, project_files, file_analyses)
            )
        for conv in conversations:
            project = next((item for item in projects if item.id == conv.project_archive_id), None)
            catalog_conversations.append(
                self._inventory_conversation(
                    user,
                    email_dir,
                    conv,
                    project,
                    usage_runs,
                    usage_calls,
                    feedback_rows,
                    messages_by_conv.get(conv.id, []),
                    sessions_by_conv.get(conv.id, []),
                    traces_by_project.get(conv.project_archive_id, []),
                    attachments_by_message,
                    blobs_by_trace,
                )
            )

        self._inventory_skills(email_dir, skill_archives, entries_by_archive, skill_files_by_archive)
        self._inventory_templates(user, email_dir, templates)
        self._write_usage(email_dir, usage_runs, usage_calls)
        self._write_feedback(email_dir, feedback_rows)
        self._flush_unassigned_traces(blobs_by_trace)
        self.store.commit()

        has_messages = any(item["message_count"] > 0 for item in catalog_conversations)
        write_json(email_dir / "user.json", {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_active": user.is_active,
            "created_at": iso(user.created_at),
            "archive_gap": None if has_messages else "no_project_conversation",
            "project_count": len(projects),
            "conversation_count": len(conversations),
            "usage_run_count": len(usage_runs),
        })
        write_json(email_dir / "catalog.json", {
            "email": user.email,
            "projects": catalog_projects,
            "conversations": catalog_conversations,
            "skill_archive_count": len(skill_archives),
            "usage_run_count": len(usage_runs),
            "feedback_count": len(feedback_rows),
            "prompt_template_count": len(templates),
        })
        self.stats["inventory_users"] += 1
        log.info("inventory done user=%s files=%s messages=%s traces=%s", user.email, len(files), len(messages), len(traces))

    def _project_dir(self, email_dir: Path, project: ProjectArchive) -> Path:
        label = project.root_name or project.name or "project"
        return email_dir / "projects" / folder_name(project.id, label)

    def _enqueue_download(
        self,
        *,
        table: str,
        record_id: str,
        storage_key: str,
        expected_sha256: str | None,
        expected_size: int | None,
        source_kind: str,
        dests: list[Path],
    ) -> tuple[str, str | None]:
        """Queue an OSS GET only when the blob is not already on disk.

        Returns (download_status, blob_sha256). Already-cached objects are
        linked into the user tree immediately and never enter the download pool.
        """
        sha = (expected_sha256 or "").lower() or None
        cached = (
            not self.options.force
            and sha is not None
            and self.blobs.has(sha, expected_size)
        )
        if (
            not cached
            and not self.options.force
            and not sha
            and dests
            and all(path.exists() for path in dests)
        ):
            self.stats["already_on_disk"] += 1
            return "downloaded", None
        if cached:
            assert sha is not None
            path = self.blobs.path_for(sha)
            self.store.record_blob(sha, path.stat().st_size, storage_key, source_kind, str(path))
            self.store.record_oss_object(storage_key, sha, expected_size, source_kind)
            if not self.options.dry_run:
                for dest in dests:
                    try:
                        self.blobs.link_or_copy(sha, dest)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("link failed dest=%s err=%s", dest, exc)
                        self.stats["link_failed"] += 1
            self.stats["already_on_disk"] += 1
            return "downloaded", sha

        self._jobs.append(
            DownloadJob(
                table=table,
                record_id=record_id,
                storage_key=storage_key,
                expected_sha256=expected_sha256,
                expected_size=expected_size,
                source_kind=source_kind,
                dests=dests,
            )
        )
        return "pending", None

    def _inventory_project(
        self,
        user: User,
        email_dir: Path,
        project: ProjectArchive,
        user_conversations: list[ProjectArchiveConversation],
        files: list[ProjectArchiveFile],
        analyses: list[ProjectDocumentAnalysis],
    ) -> dict[str, Any]:
        project_dir = self._project_dir(email_dir, project)
        project_dir.mkdir(parents=True, exist_ok=True)

        file_index = []
        live_paths = []
        for item in files:
            rel = (item.normalized_path or item.relative_path or "").replace("\\", "/")
            skip_reason = skip_download(
                rel,
                project_name=project.name or "",
                root_name=project.root_name or "",
                extension=item.extension or "",
            )
            if item.is_deleted:
                status = "deleted"
            elif item.upload_status != "ready" or not item.storage_key:
                status = "missing"
            elif skip_reason:
                status = "skipped"
            else:
                status = "pending"
            blob_sha: str | None = None
            if status == "pending" and item.storage_key:
                status, blob_sha = self._enqueue_download(
                    table="project_files",
                    record_id=item.id,
                    storage_key=item.storage_key,
                    expected_sha256=item.sha256,
                    expected_size=item.size_bytes,
                    source_kind="project_file",
                    dests=[safe_join(project_dir / "files", rel)],
                )
            row = {
                "id": item.id,
                "project_archive_id": project.id,
                "relative_path": item.relative_path,
                "normalized_path": item.normalized_path,
                "filename": item.filename,
                "extension": item.extension,
                "media_type": item.media_type,
                "size_bytes": item.size_bytes,
                "sha256": item.sha256,
                "storage_key": item.storage_key,
                "upload_status": item.upload_status,
                "is_deleted": _bool_int(item.is_deleted),
                "download_status": status,
                "skip_reason": skip_reason,
                "blob_sha256": blob_sha,
            }
            self.store.upsert("project_files", row)
            if item.storage_key:
                self.store.record_oss_object(item.storage_key, item.sha256, item.size_bytes, "project_file")
            if not item.is_deleted:
                live_paths.append(rel)
            file_index.append({
                "relative_path": item.relative_path,
                "normalized_path": item.normalized_path,
                "size_bytes": item.size_bytes,
                "sha256": item.sha256,
                "storage_key": item.storage_key,
                "upload_status": item.upload_status,
                "is_deleted": item.is_deleted,
                "download_status": status,
                "skip_reason": skip_reason,
            })

        tree = build_tree(live_paths, project_name=project.name, root_name=project.root_name)
        write_json(project_dir / "project.json", {
            "id": project.id,
            "organization_id": project.organization_id,
            "owner_user_id": project.owner_user_id,
            "local_project_id": project.local_project_id,
            "name": project.name,
            "description": project.description,
            "root_name": project.root_name,
            "sync_status": project.sync_status,
            "file_count": project.file_count,
            "total_bytes": project.total_bytes,
            "last_synced_at": iso(project.last_synced_at),
            "created_at": iso(project.created_at),
        })
        write_json(project_dir / "tree.json", tree)
        write_json(project_dir / "files_index.json", {
            "project_archive_id": project.id,
            "file_count": len(file_index),
            "live_file_count": len(live_paths),
            "all_files": file_index,
        })
        if analyses:
            write_json(project_dir / "document_analyses.json", [
                {
                    "id": item.id,
                    "project_file_id": item.project_file_id,
                    "requested_by_user_id": item.requested_by_user_id,
                    "instruction": item.instruction,
                    "status": item.status,
                    "model": item.model,
                    "content": item.content,
                    "truncated": item.truncated,
                    "warnings_json": item.warnings_json,
                    "usage_json": item.usage_json,
                    "error_message": item.error_message,
                    "completed_at": iso(item.completed_at),
                }
                for item in analyses
            ])
            for item in analyses:
                self.store.upsert("document_analyses", {
                    "id": item.id,
                    "project_file_id": item.project_file_id,
                    "project_archive_id": project.id,
                    "requested_by_user_id": item.requested_by_user_id,
                    "instruction": item.instruction,
                    "status": item.status,
                    "content": item.content,
                    "truncated": _bool_int(item.truncated),
                    "model": item.model,
                    "error_message": item.error_message,
                    "completed_at": iso(item.completed_at),
                })

        self.store.upsert("projects", {
            "id": project.id,
            "organization_id": project.organization_id,
            "owner_user_id": project.owner_user_id,
            "local_project_id": project.local_project_id,
            "name": project.name,
            "description": project.description,
            "root_name": project.root_name,
            "sync_status": project.sync_status,
            "file_count": project.file_count,
            "total_bytes": project.total_bytes,
            "last_synced_at": iso(project.last_synced_at),
            "created_at": iso(project.created_at),
            "local_dir": str(project_dir),
        })
        conv_count = sum(1 for item in user_conversations if item.project_archive_id == project.id)
        return {
            "id": project.id,
            "name": project.name,
            "root_name": project.root_name,
            "file_count": len(files),
            "conversation_count": conv_count,
            "local_dir": str(project_dir.relative_to(self.corpus)),
        }

    def _inventory_conversation(
        self,
        user: User,
        email_dir: Path,
        conv: ProjectArchiveConversation,
        project: ProjectArchive | None,
        usage_runs: list[AgentUsageRun],
        usage_calls: list[AgentUsageCall],
        feedback_rows: list[AgentMessageFeedback],
        messages: list[ProjectArchiveMessage],
        sessions: list[PiSessionArchive],
        traces: list[SubagentTraceArchive],
        attachments_by_message: dict[str, list[ProjectArchiveMessageAttachment]],
        blobs_by_trace: dict[str, list[SubagentTraceBlobArchive]],
    ) -> dict[str, Any]:
        live_messages = [item for item in messages if not item.is_deleted]
        has_ready_session = any(item.upload_status == "ready" and item.storage_key for item in sessions)

        should_folder = bool(live_messages) or has_ready_session
        project_dir = self._project_dir(email_dir, project) if project else email_dir / "projects" / "unknown"
        conv_dir = project_dir / "conversations" / folder_name(conv.id, conv.title) if should_folder else None

        prev = self.store.query(
            "SELECT last_synced_at, message_count FROM conversations WHERE id=?",
            (conv.id,),
        )
        messages_unchanged = bool(
            not self.options.force
            and conv_dir is not None
            and (conv_dir / "messages.jsonl").exists()
            and prev
            and prev[0]["last_synced_at"] == iso(conv.last_synced_at)
            and int(prev[0]["message_count"] or 0) == len(live_messages)
        )

        self.store.upsert("conversations", {
            "id": conv.id,
            "project_archive_id": conv.project_archive_id,
            "source_user_id": conv.source_user_id,
            "local_conversation_id": conv.local_conversation_id,
            "title": conv.title,
            "creation_source": conv.creation_source,
            "conversation_mode": conv.conversation_mode,
            "drawing_id": conv.drawing_id,
            "drawing_name": conv.drawing_name,
            "preferred_model_id": conv.preferred_model_id,
            "preferred_thinking_mode": conv.preferred_thinking_mode,
            "parent_local_conversation_id": conv.parent_local_conversation_id,
            "forked_from_entry_id": conv.forked_from_entry_id,
            "last_synced_at": iso(conv.last_synced_at),
            "created_at": iso(conv.created_at),
            "is_deleted": _bool_int(conv.is_deleted),
            "message_count": len(live_messages),
            "has_pi_session": int(bool(sessions)),
            "local_dir": str(conv_dir) if conv_dir else None,
        })

        catalog_item = {
            "id": conv.id,
            "title": conv.title,
            "project_archive_id": conv.project_archive_id,
            "project_name": project.name if project else None,
            "message_count": len(live_messages),
            "pi_session_snapshots": len(sessions),
            "empty_stub": not should_folder,
            "local_dir": str(conv_dir.relative_to(self.corpus)) if conv_dir else None,
        }
        if conv_dir is None:
            return catalog_item

        conv_dir.mkdir(parents=True, exist_ok=True)
        write_json(conv_dir / "conversation.json", {
            "id": conv.id,
            "title": conv.title,
            "local_conversation_id": conv.local_conversation_id,
            "project_archive_id": conv.project_archive_id,
            "project_name": project.name if project else None,
            "creation_source": conv.creation_source,
            "conversation_mode": conv.conversation_mode,
            "drawing_id": conv.drawing_id,
            "drawing_name": conv.drawing_name,
            "preferred_model_id": conv.preferred_model_id,
            "preferred_thinking_mode": conv.preferred_thinking_mode,
            "parent_local_conversation_id": conv.parent_local_conversation_id,
            "forked_from_entry_id": conv.forked_from_entry_id,
            "last_synced_at": iso(conv.last_synced_at),
            "created_at": iso(conv.created_at),
            "message_count": len(live_messages),
        })
        if messages_unchanged:
            self.stats["conversations_unchanged"] += 1
        else:
            self._write_messages(conv_dir, conv, user, project, live_messages)
        self._inventory_attachments(conv, live_messages, conv_dir, attachments_by_message)
        self._inventory_sessions(sessions, conv_dir)
        self._inventory_traces(conv, project, sessions, conv_dir, email_dir, traces, blobs_by_trace)

        client_run_ids = {item.client_run_id for item in live_messages if item.client_run_id}
        conv_runs = [
            item for item in usage_runs
            if item.client_run_id in client_run_ids or item.local_conversation_id == conv.local_conversation_id
        ]
        conv_run_ids = {item.id for item in conv_runs}
        conv_calls = [item for item in usage_calls if item.agent_run_id in conv_run_ids]
        write_json(conv_dir / "usage.json", {
            "runs": [_usage_run_dict(item) for item in conv_runs],
            "calls": [_usage_call_dict(item) for item in conv_calls],
        })
        conv_feedback = [
            item for item in feedback_rows
            if item.local_conversation_id == conv.local_conversation_id
            or (item.pi_session_id and item.pi_session_id in {s.pi_session_id for s in sessions})
        ]
        write_json(conv_dir / "feedback.json", [_feedback_dict(item) for item in conv_feedback])
        return catalog_item

    def _write_messages(
        self,
        conv_dir: Path,
        conv: ProjectArchiveConversation,
        user: User,
        project: ProjectArchive | None,
        messages: list[ProjectArchiveMessage],
    ) -> None:
        jsonl_path = conv_dir / "messages.jsonl"
        lines = []
        md = [
            f"# {conv.title}",
            "",
            f"- conversation_id: `{conv.id}`",
            f"- user: `{user.email}`",
            f"- project: {project.name if project else ''}",
            f"- messages: {len(messages)}",
            "",
        ]
        for index, row in enumerate(messages):
            payload = {
                "id": row.id,
                "ordinal": row.ordinal,
                "role": row.role,
                "local_message_id": row.local_message_id,
                "client_run_id": row.client_run_id,
                "pi_session_id": row.pi_session_id,
                "pi_entry_id": row.pi_entry_id,
                "source_key": row.source_key,
                "content": row.content,
                "tool_name": row.tool_name,
                "tool_args": row.tool_args,
                "tool_result": row.tool_result,
                "thinking": row.thinking,
                "parts_json": row.parts_json,
                "source_created_at": row.source_created_at,
                "is_deleted": row.is_deleted,
            }
            lines.append(json.dumps(payload, ensure_ascii=False, default=str))
            self.store.upsert("messages", {
                "id": row.id,
                "conversation_id": conv.id,
                "local_message_id": row.local_message_id,
                "client_run_id": row.client_run_id,
                "pi_session_id": row.pi_session_id,
                "pi_entry_id": row.pi_entry_id,
                "source_key": row.source_key,
                "ordinal": row.ordinal,
                "role": row.role,
                "tool_name": row.tool_name or None,
                "content_chars": len(row.content or ""),
                "thinking_chars": len(row.thinking or ""),
                "jsonl_offset": index,
                "source_created_at": row.source_created_at,
            })
            md.append(f"## [{row.ordinal}] {row.role}")
            if row.tool_name:
                md.append(f"- tool: `{row.tool_name}`")
            if row.client_run_id:
                md.append(f"- client_run_id: `{row.client_run_id}`")
            md.append("")
            if row.thinking:
                md.append("<details><summary>thinking</summary>\n")
                md.append("```")
                md.append(row.thinking)
                md.append("```\n</details>\n")
            if row.content:
                md.append(row.content)
                md.append("")
            if row.tool_args:
                md.append("```json")
                md.append(row.tool_args)
                md.append("```")
                md.append("")
            if row.tool_result:
                md.append("```")
                md.append(row.tool_result)
                md.append("```")
                md.append("")
        write_text(jsonl_path, "\n".join(lines) + ("\n" if lines else ""))
        write_text(conv_dir / "messages.md", "\n".join(md))

    def _inventory_attachments(
        self,
        conv: ProjectArchiveConversation,
        messages: list[ProjectArchiveMessage],
        conv_dir: Path,
        attachments_by_message: dict[str, list[ProjectArchiveMessageAttachment]],
    ) -> None:
        rows = [
            item
            for message in messages
            for item in attachments_by_message.get(message.id, [])
        ]
        if not rows:
            return
        index = []
        for item in rows:
            if item.is_deleted:
                status = "deleted"
            elif item.upload_status != "ready" or not item.storage_key:
                status = "missing"
            else:
                status = "pending"
            blob_sha: str | None = None
            if status == "pending" and item.storage_key:
                ext = BLOB_MEDIA_EXT.get((item.media_type or "").lower(), "")
                name = item.filename or f"{(item.local_attachment_id or item.id)[:12]}{ext}"
                status, blob_sha = self._enqueue_download(
                    table="attachments",
                    record_id=item.id,
                    storage_key=item.storage_key,
                    expected_sha256=item.sha256,
                    expected_size=item.size_bytes,
                    source_kind="attachment",
                    dests=[conv_dir / "attachments" / name],
                )
            self.store.upsert("attachments", {
                "id": item.id,
                "message_id": item.message_id,
                "conversation_id": conv.id,
                "local_attachment_id": item.local_attachment_id,
                "filename": item.filename,
                "media_type": item.media_type,
                "size_bytes": item.size_bytes,
                "sha256": item.sha256,
                "storage_key": item.storage_key,
                "upload_status": item.upload_status,
                "download_status": status,
                "blob_sha256": blob_sha,
            })
            if item.storage_key:
                self.store.record_oss_object(item.storage_key, item.sha256, item.size_bytes, "attachment")
            index.append({
                "id": item.id,
                "filename": item.filename,
                "media_type": item.media_type,
                "size_bytes": item.size_bytes,
                "sha256": item.sha256,
                "download_status": status,
            })
        write_json(conv_dir / "attachments_index.json", index)

    def _inventory_sessions(self, sessions: list[PiSessionArchive], conv_dir: Path) -> None:
        latest_by_sid: dict[str, str] = {}
        for item in sessions:
            if item.pi_session_id not in latest_by_sid:
                latest_by_sid[item.pi_session_id] = item.id
        index = []
        for item in sessions:
            is_latest = latest_by_sid.get(item.pi_session_id) == item.id
            if item.upload_status != "ready" or not item.storage_key:
                status = "missing"
            else:
                status = "pending"
            blob_sha: str | None = None
            if status == "pending" and item.storage_key:
                dest = conv_dir / "pi_sessions" / item.pi_session_id / f"{item.sha256}.jsonl"
                status, blob_sha = self._enqueue_download(
                    table="pi_sessions",
                    record_id=item.id,
                    storage_key=item.storage_key,
                    expected_sha256=item.sha256,
                    expected_size=item.size_bytes,
                    source_kind="pi_session",
                    dests=[dest],
                )
            self.store.upsert("pi_sessions", {
                "id": item.id,
                "conversation_archive_id": item.conversation_archive_id,
                "project_archive_id": item.project_archive_id,
                "pi_session_id": item.pi_session_id,
                "parent_pi_session_id": item.parent_pi_session_id,
                "sha256": item.sha256,
                "size_bytes": item.size_bytes,
                "storage_key": item.storage_key,
                "upload_status": item.upload_status,
                "entry_count": item.entry_count,
                "uploaded_at": iso(item.uploaded_at),
                "is_latest": int(is_latest),
                "download_status": status,
                "blob_sha256": blob_sha,
            })
            if item.storage_key:
                self.store.record_oss_object(item.storage_key, item.sha256, item.size_bytes, "pi_session")
            index.append({
                "id": item.id,
                "pi_session_id": item.pi_session_id,
                "sha256": item.sha256,
                "size_bytes": item.size_bytes,
                "entry_count": item.entry_count,
                "uploaded_at": iso(item.uploaded_at),
                "is_latest": is_latest,
                "download_status": status,
            })
        write_json(conv_dir / "pi_sessions" / "index.json", index)
        for session_id, latest_id in latest_by_sid.items():
            meta = next((item for item in sessions if item.id == latest_id), None)
            if meta is None:
                continue
            write_json(conv_dir / "pi_sessions" / session_id / "meta.json", {
                "pi_session_id": session_id,
                "latest_archive_id": latest_id,
                "latest_sha256": meta.sha256,
                "snapshot_count": sum(1 for item in sessions if item.pi_session_id == session_id),
            })

    def _inventory_traces(
        self,
        conv: ProjectArchiveConversation,
        project: ProjectArchive | None,
        sessions: list[PiSessionArchive],
        conv_dir: Path,
        email_dir: Path,
        traces: list[SubagentTraceArchive],
        blobs_by_trace: dict[str, list[SubagentTraceBlobArchive]],
    ) -> None:
        parent_sids = {item.pi_session_id for item in sessions}
        assigned = []
        for trace in traces:
            if trace.parent_session_id == conv.local_conversation_id:
                assigned.append(trace)
            elif trace.parent_pi_session_id and trace.parent_pi_session_id in parent_sids:
                assigned.append(trace)
        assigned_ids = {item.id for item in assigned}
        self._write_traces(assigned, conv.id, conv_dir / "traces", assigned=True, blobs_by_trace=blobs_by_trace)
        self.stats["traces_assigned"] += len(assigned)
        if project is None:
            return
        pending = getattr(self, "_pending_unassigned", None)
        if pending is None:
            pending = {}
            self._pending_unassigned = pending
        bucket = pending.setdefault(
            project.id,
            {
                "project": project,
                "email_dir": email_dir,
                "claimed": set(),
                "all": traces,
                "blobs_by_trace": blobs_by_trace,
            },
        )
        bucket["claimed"].update(assigned_ids)
        bucket["all"] = traces
        bucket["blobs_by_trace"] = blobs_by_trace

    def _write_traces(
        self,
        traces: list[SubagentTraceArchive],
        conversation_id: str | None,
        traces_dir: Path,
        *,
        assigned: bool,
        blobs_by_trace: dict[str, list[SubagentTraceBlobArchive]],
    ) -> None:
        if not traces:
            return
        traces_dir.mkdir(parents=True, exist_ok=True)
        index = []
        for trace in traces:
            folder = traces_dir / f"{trace.agent_type}_{trace.child_run_id}"
            folder.mkdir(parents=True, exist_ok=True)
            if trace.upload_status != "ready" or not trace.storage_key:
                status = "missing"
            else:
                status = "pending"
            blob_sha: str | None = None
            if status == "pending" and trace.storage_key:
                status, blob_sha = self._enqueue_download(
                    table="traces",
                    record_id=trace.id,
                    storage_key=trace.storage_key,
                    expected_sha256=trace.trace_sha256,
                    expected_size=trace.trace_size_bytes,
                    source_kind="trace",
                    dests=[folder / "trace.jsonl"],
                )
            self.store.upsert("traces", {
                "id": trace.id,
                "project_archive_id": trace.project_archive_id,
                "conversation_archive_id": conversation_id,
                "child_run_id": trace.child_run_id,
                "parent_session_id": trace.parent_session_id,
                "parent_pi_session_id": trace.parent_pi_session_id,
                "parent_pi_entry_id": trace.parent_pi_entry_id,
                "client_run_id": trace.client_run_id,
                "agent_type": trace.agent_type,
                "status": trace.status,
                "model": trace.model,
                "storage_key": trace.storage_key,
                "upload_status": trace.upload_status,
                "trace_sha256": trace.trace_sha256,
                "trace_size_bytes": trace.trace_size_bytes,
                "assigned": int(assigned),
                "download_status": status,
                "blob_sha256": blob_sha,
            })
            if trace.storage_key:
                self.store.record_oss_object(trace.storage_key, trace.trace_sha256, trace.trace_size_bytes, "trace")
            meta = {
                "id": trace.id,
                "child_run_id": trace.child_run_id,
                "agent_type": trace.agent_type,
                "status": trace.status,
                "model": trace.model,
                "parent_session_id": trace.parent_session_id,
                "parent_pi_session_id": trace.parent_pi_session_id,
                "tool_call_count": trace.tool_call_count,
                "event_count": trace.event_count,
                "upload_status": trace.upload_status,
                "download_status": status,
            }
            write_json(folder / "meta.json", meta)
            index.append(meta)
            blobs = blobs_by_trace.get(trace.id, [])
            blob_index = []
            for blob in blobs:
                if blob.upload_status != "ready" or not blob.storage_key:
                    bstatus = "missing"
                else:
                    bstatus = "pending"
                blob_file_sha: str | None = None
                if bstatus == "pending" and blob.storage_key:
                    ext = BLOB_MEDIA_EXT.get((blob.media_type or "").lower(), ".bin")
                    dest = folder / "blobs" / f"{blob.sha256[:16]}{ext}"
                    bstatus, blob_file_sha = self._enqueue_download(
                        table="trace_blobs",
                        record_id=blob.id,
                        storage_key=blob.storage_key,
                        expected_sha256=blob.sha256,
                        expected_size=blob.size_bytes,
                        source_kind="trace_blob",
                        dests=[dest],
                    )
                self.store.upsert("trace_blobs", {
                    "id": blob.id,
                    "trace_archive_id": trace.id,
                    "sha256": blob.sha256,
                    "media_type": blob.media_type,
                    "size_bytes": blob.size_bytes,
                    "storage_key": blob.storage_key,
                    "upload_status": blob.upload_status,
                    "download_status": bstatus,
                    "blob_sha256": blob_file_sha,
                })
                if blob.storage_key:
                    self.store.record_oss_object(blob.storage_key, blob.sha256, blob.size_bytes, "trace_blob")
                blob_index.append({
                    "sha256": blob.sha256,
                    "media_type": blob.media_type,
                    "size_bytes": blob.size_bytes,
                    "download_status": bstatus,
                })
            write_json(folder / "blobs.json", blob_index)
        write_json(traces_dir / "index.json", index)

    def _inventory_skills(
        self,
        email_dir: Path,
        archives: list[UserSkillArchive],
        entries_by_archive: dict[str, list[UserSkillArchiveEntry]],
        skill_files_by_archive: dict[str, list[UserSkillArchiveFile]],
    ) -> None:
        if not archives:
            return
        skills_dir = email_dir / "skills"
        skills_dir.mkdir(parents=True, exist_ok=True)
        for archive in archives:
            self.store.upsert("skill_archives", {
                "id": archive.id,
                "organization_id": archive.organization_id,
                "owner_user_id": archive.owner_user_id,
                "skill_count": archive.skill_count,
                "file_count": archive.file_count,
                "total_bytes": archive.total_bytes,
                "skills_root_name": archive.skills_root_name,
                "sync_status": archive.sync_status,
                "last_synced_at": iso(archive.last_synced_at),
            })
            entries = entries_by_archive.get(archive.id, [])
            files = skill_files_by_archive.get(archive.id, [])
            write_json(skills_dir / "archive.json", {
                "id": archive.id,
                "skills_root_name": archive.skills_root_name,
                "skill_count": archive.skill_count,
                "file_count": archive.file_count,
                "total_bytes": archive.total_bytes,
                "sync_status": archive.sync_status,
                "last_synced_at": iso(archive.last_synced_at),
            })
            write_json(skills_dir / "entries.json", [
                {
                    "id": item.id,
                    "slug": item.slug,
                    "name": item.name,
                    "description": item.description,
                    "enabled": item.enabled,
                    "validation_status": item.validation_status,
                    "validation_message": item.validation_message,
                    "file_count": item.file_count,
                    "is_deleted": item.is_deleted,
                }
                for item in entries
            ])
            for item in entries:
                self.store.upsert("skill_entries", {
                    "id": item.id,
                    "archive_id": archive.id,
                    "slug": item.slug,
                    "name": item.name,
                    "description": item.description,
                    "enabled": _bool_int(item.enabled),
                    "validation_status": item.validation_status,
                    "file_count": item.file_count,
                    "is_deleted": _bool_int(item.is_deleted),
                })
            file_index = []
            for item in files:
                rel = (item.normalized_path or item.relative_path or "").replace("\\", "/")
                skip_reason = skip_download(
                    rel,
                    project_name=archive.skills_root_name or "skills",
                    extension=item.extension or "",
                )
                if item.is_deleted:
                    status = "deleted"
                elif item.upload_status != "ready" or not item.storage_key:
                    status = "missing"
                elif skip_reason:
                    status = "skipped"
                else:
                    status = "pending"
                blob_sha: str | None = None
                if status == "pending" and item.storage_key:
                    status, blob_sha = self._enqueue_download(
                        table="skill_files",
                        record_id=item.id,
                        storage_key=item.storage_key,
                        expected_sha256=item.sha256,
                        expected_size=item.size_bytes,
                        source_kind="skill_file",
                        dests=[safe_join(skills_dir / "files", rel)],
                    )
                self.store.upsert("skill_files", {
                    "id": item.id,
                    "archive_id": archive.id,
                    "skill_slug": item.skill_slug,
                    "relative_path": item.relative_path,
                    "normalized_path": item.normalized_path,
                    "filename": item.filename,
                    "extension": item.extension,
                    "size_bytes": item.size_bytes,
                    "sha256": item.sha256,
                    "storage_key": item.storage_key,
                    "upload_status": item.upload_status,
                    "is_deleted": _bool_int(item.is_deleted),
                    "download_status": status,
                    "skip_reason": skip_reason,
                    "blob_sha256": blob_sha,
                })
                if item.storage_key:
                    self.store.record_oss_object(item.storage_key, item.sha256, item.size_bytes, "skill_file")
                file_index.append({
                    "relative_path": item.relative_path,
                    "sha256": item.sha256,
                    "size_bytes": item.size_bytes,
                    "download_status": status,
                    "skip_reason": skip_reason,
                })
            write_json(skills_dir / "files_index.json", file_index)

    def _inventory_templates(self, user: User, email_dir: Path, templates: list[UserPromptTemplate]) -> None:
        write_json(email_dir / "prompt_templates.json", [
            {
                "id": item.id,
                "title": item.title,
                "description": item.description,
                "content": item.content,
                "storage_key": item.storage_key,
                "content_sha256": item.content_sha256,
            }
            for item in templates
        ])
        for item in templates:
            self.store.upsert("prompt_templates", {
                "id": item.id,
                "user_id": user.id,
                "organization_id": item.organization_id,
                "title": item.title,
                "description": item.description,
                "content": item.content,
                "storage_key": item.storage_key,
                "content_sha256": item.content_sha256,
            })
            if item.storage_key:
                dest = email_dir / "prompt_templates" / f"{item.id}.json"
                self._enqueue_download(
                    table="prompt_templates",
                    record_id=item.id,
                    storage_key=item.storage_key,
                    # OSS 对象是 JSON 包装，不等于 content 列的 sha256。
                    expected_sha256=None,
                    expected_size=None,
                    source_kind="prompt_template",
                    dests=[dest],
                )

    def _write_usage(self, email_dir: Path, runs: list[AgentUsageRun], calls: list[AgentUsageCall]) -> None:
        path = email_dir / "usage_runs.jsonl"
        lines = [json.dumps(_usage_run_dict(item), ensure_ascii=False, default=str) for item in runs]
        write_text(path, "\n".join(lines) + ("\n" if lines else ""))
        write_json(email_dir / "usage_calls.json", [_usage_call_dict(item) for item in calls])
        for item in runs:
            self.store.upsert("usage_runs", {
                "id": item.id,
                "user_id": item.user_id,
                "organization_id": item.organization_id,
                "client_run_id": item.client_run_id,
                "source": item.source,
                "status": item.status,
                "local_conversation_id": item.local_conversation_id,
                "task_preview": item.task_preview,
                "original_question": item.original_question,
                "final_answer": item.final_answer,
                "started_at": iso(item.started_at),
                "ended_at": iso(item.ended_at),
                "duration_ms": item.duration_ms,
                "error_message": item.error_message,
            })
        for item in calls:
            self.store.upsert("usage_calls", {
                "id": item.id,
                "agent_run_id": item.agent_run_id,
                "user_id": item.user_id,
                "client_run_id": item.client_run_id,
                "child_run_id": item.child_run_id,
                "call_purpose": item.call_purpose,
                "model_alias": item.model_alias,
                "provider_model": item.provider_model,
                "status": item.status,
                "duration_ms": item.duration_ms,
                "input_tokens": item.input_tokens,
                "output_tokens": item.output_tokens,
                "total_tokens": item.total_tokens,
                "image_count": item.image_count,
                "error_code": item.error_code,
            })

    def _write_feedback(self, email_dir: Path, rows: list[AgentMessageFeedback]) -> None:
        write_json(email_dir / "feedback.json", [_feedback_dict(item) for item in rows])
        for item in rows:
            self.store.upsert("feedback", {
                "id": item.id,
                "user_id": item.user_id,
                "agent_run_id": item.agent_run_id,
                "client_run_id": item.client_run_id,
                "pi_session_id": item.pi_session_id,
                "pi_entry_id": item.pi_entry_id,
                "local_conversation_id": item.local_conversation_id,
                "local_message_id": item.local_message_id,
                "vote": item.vote,
                "outcome": item.outcome,
                "issue_codes_json": item.issue_codes_json,
                "comment": item.comment,
                "app_version": item.app_version,
                "created_at": iso(item.created_at),
            })

    def _flush_unassigned_traces(self, blobs_by_trace: dict[str, list[SubagentTraceBlobArchive]]) -> None:
        pending = getattr(self, "_pending_unassigned", None)
        if not pending:
            return
        for payload in pending.values():
            project = payload["project"]
            email_dir = payload["email_dir"]
            claimed = payload["claimed"]
            leftover = [item for item in payload.get("all", []) if item.id not in claimed]
            if leftover:
                traces_dir = self._project_dir(email_dir, project) / "unassigned_traces"
                write_json(traces_dir / "README.json", {
                    "note": "Traces whose parent_session_id / parent_pi_session_id did not match any conversation of this user.",
                    "leftover_count": len(leftover),
                })
                self._write_traces(
                    leftover,
                    None,
                    traces_dir,
                    assigned=False,
                    blobs_by_trace=payload.get("blobs_by_trace") or blobs_by_trace,
                )
        self._pending_unassigned = {}

    def _download_all(self) -> None:
        grouped: dict[str, list[DownloadJob]] = {}
        for job in self._jobs:
            key = (job.expected_sha256 or "") or job.storage_key
            grouped.setdefault(key, []).append(job)
        groups = list(grouped.values())
        log.info(
            "download groups=%s jobs=%s already_on_disk=%s workers=%s",
            len(groups),
            len(self._jobs),
            int(self.stats.get("already_on_disk") or 0),
            self.options.workers,
        )
        if not groups:
            return
        done = 0
        with ThreadPoolExecutor(max_workers=max(1, self.options.workers)) as pool:
            futures = [pool.submit(self._fetch_group, group) for group in groups]
            for future in as_completed(futures):
                group, result, error = future.result()
                done += 1
                if error is not None:
                    status = "hash_mismatch" if isinstance(error, HashMismatch) else "failed"
                    self.stats[f"download_{status}"] += len(group)
                    for job in group:
                        if job.table != "prompt_templates":
                            self.store.update_download(job.table, job.record_id, status, None)
                    log.warning("download failed (%s) key=%s err=%s", status, group[0].storage_key, error)
                else:
                    sha = result["sha256"]
                    size = result["size_bytes"]
                    self.store.record_blob(sha, size, group[0].storage_key, group[0].source_kind, result["path"])
                    for job in group:
                        if job.table != "prompt_templates":
                            self.store.update_download(job.table, job.record_id, "downloaded", sha)
                        self.store.record_oss_object(job.storage_key, sha, size, job.source_kind)
                    if result.get("cached"):
                        self.stats["download_cached"] += len(group)
                    else:
                        self.stats["download_ok"] += len(group)
                if done % 20 == 0:
                    self.store.commit()
                if done % 50 == 0 or done == len(groups):
                    log.info("download progress %s/%s", done, len(groups))
        self.store.commit()

    def _fetch_group(self, group: list[DownloadJob]) -> tuple[list[DownloadJob], dict | None, Exception | None]:
        job = group[0]
        try:
            result = self.blobs.fetch(
                job.storage_key,
                expected_sha256=job.expected_sha256,
                expected_size=job.expected_size,
                force=self.options.force,
            )
            return group, result, None
        except Exception as exc:  # noqa: BLE001
            return group, None, exc

    def _materialize(self) -> None:
        log.info("materialize user trees from blobs")
        linked = 0
        for job in self._jobs:
            sha = self._job_blob_sha(job)
            if not sha or not self.blobs.has(sha):
                continue
            for dest in job.dests:
                try:
                    self.blobs.link_or_copy(sha, dest)
                    linked += 1
                except Exception as exc:  # noqa: BLE001
                    log.warning("link failed dest=%s err=%s", dest, exc)
                    self.stats["link_failed"] += 1
        self.stats["links"] = linked
        log.info("materialize links=%s", linked)

    def _job_blob_sha(self, job: DownloadJob) -> str | None:
        if job.table == "prompt_templates":
            sha = (job.expected_sha256 or "").lower()
            return sha or None
        rows = self.store.query(
            f"SELECT download_status, blob_sha256 FROM {job.table} WHERE id=?",
            (job.record_id,),
        )
        if not rows:
            return None
        if rows[0]["download_status"] != "downloaded":
            return None
        return rows[0]["blob_sha256"]


def _usage_run_dict(item: AgentUsageRun) -> dict[str, Any]:
    return {
        "id": item.id,
        "client_run_id": item.client_run_id,
        "source": item.source,
        "status": item.status,
        "local_conversation_id": item.local_conversation_id,
        "task_preview": item.task_preview,
        "original_question": item.original_question,
        "final_answer": item.final_answer,
        "started_at": iso(item.started_at),
        "ended_at": iso(item.ended_at),
        "duration_ms": item.duration_ms,
        "error_message": item.error_message,
    }


def _usage_call_dict(item: AgentUsageCall) -> dict[str, Any]:
    return {
        "id": item.id,
        "agent_run_id": item.agent_run_id,
        "client_run_id": item.client_run_id,
        "child_run_id": item.child_run_id,
        "call_purpose": item.call_purpose,
        "model_alias": item.model_alias,
        "provider_model": item.provider_model,
        "status": item.status,
        "duration_ms": item.duration_ms,
        "input_tokens": item.input_tokens,
        "output_tokens": item.output_tokens,
        "cache_read_tokens": item.cache_read_tokens,
        "cache_write_tokens": item.cache_write_tokens,
        "reasoning_tokens": item.reasoning_tokens,
        "total_tokens": item.total_tokens,
        "image_count": item.image_count,
        "error_code": item.error_code,
    }


def _feedback_dict(item: AgentMessageFeedback) -> dict[str, Any]:
    return {
        "id": item.id,
        "agent_run_id": item.agent_run_id,
        "client_run_id": item.client_run_id,
        "pi_session_id": item.pi_session_id,
        "pi_entry_id": item.pi_entry_id,
        "local_conversation_id": item.local_conversation_id,
        "local_message_id": item.local_message_id,
        "vote": item.vote,
        "outcome": item.outcome,
        "issue_codes_json": item.issue_codes_json,
        "comment": item.comment,
        "app_version": item.app_version,
        "created_at": iso(item.created_at),
    }


def run_pull(options: PullOptions) -> dict[str, Any]:
    return Puller(options).run()
