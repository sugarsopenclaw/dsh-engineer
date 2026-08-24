from __future__ import annotations

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.schemas.base import utcnow
from app.schemas.user_skill_archive import (
    UserSkillArchive,
    UserSkillArchiveEntry,
    UserSkillArchiveFile,
)


class UserSkillArchiveRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_archive(self, organization_id: str, owner_user_id: str) -> UserSkillArchive | None:
        return self.session.scalar(
            select(UserSkillArchive).where(
                UserSkillArchive.organization_id == organization_id,
                UserSkillArchive.owner_user_id == owner_user_id,
            )
        )

    def upsert_archive(
        self,
        *,
        organization_id: str,
        user_id: str,
        skills_root_name: str | None = None,
    ) -> UserSkillArchive:
        archive = self.get_archive(organization_id, user_id)
        if archive is None:
            archive = UserSkillArchive(
                organization_id=organization_id,
                owner_user_id=user_id,
                last_synced_by_user_id=user_id,
                skills_root_name=skills_root_name,
            )
            self.session.add(archive)
        else:
            archive.last_synced_by_user_id = user_id
            if skills_root_name is not None:
                archive.skills_root_name = skills_root_name
        self.session.flush()
        return archive

    def get_file(self, archive_id: str, normalized_path: str) -> UserSkillArchiveFile | None:
        return self.session.scalar(
            select(UserSkillArchiveFile).where(
                UserSkillArchiveFile.archive_id == archive_id,
                UserSkillArchiveFile.normalized_path == normalized_path,
            )
        )

    def get_file_by_id(self, file_id: str) -> UserSkillArchiveFile | None:
        return self.session.get(UserSkillArchiveFile, file_id)

    def upsert_file(
        self,
        *,
        archive_id: str,
        user_id: str,
        skill_slug: str | None,
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
    ) -> UserSkillArchiveFile:
        record = self.get_file(archive_id, normalized_path)
        now = utcnow()
        if record is None:
            record = UserSkillArchiveFile(
                archive_id=archive_id,
                archived_by_user_id=user_id,
                skill_slug=skill_slug,
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
            record.skill_slug = skill_slug
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

    def mark_file_ready(self, record: UserSkillArchiveFile) -> None:
        record.upload_status = "ready"
        record.upload_error = None
        record.uploaded_at = utcnow()
        record.is_deleted = False
        self.session.flush()

    def mark_file_failed(self, record: UserSkillArchiveFile, error: str) -> None:
        record.upload_status = "failed"
        record.upload_error = error[:4000]
        self.session.flush()

    def get_entry(self, archive_id: str, slug: str) -> UserSkillArchiveEntry | None:
        return self.session.scalar(
            select(UserSkillArchiveEntry).where(
                UserSkillArchiveEntry.archive_id == archive_id,
                UserSkillArchiveEntry.slug == slug,
            )
        )

    def upsert_entry(
        self,
        *,
        archive_id: str,
        slug: str,
        name: str,
        description: str,
        enabled: bool,
        validation_status: str,
        validation_message: str | None,
        file_count: int,
        updated_at_client: str | None,
        snapshot_id: str | None,
    ) -> UserSkillArchiveEntry:
        record = self.get_entry(archive_id, slug)
        now = utcnow()
        if record is None:
            record = UserSkillArchiveEntry(
                archive_id=archive_id,
                slug=slug,
                name=name,
                description=description,
                enabled=enabled,
                validation_status=validation_status,
                validation_message=validation_message,
                file_count=file_count,
                updated_at_client=updated_at_client,
                is_deleted=False,
                last_seen_snapshot_id=snapshot_id,
                last_seen_at=now,
            )
            self.session.add(record)
        else:
            record.name = name
            record.description = description
            record.enabled = enabled
            record.validation_status = validation_status
            record.validation_message = validation_message
            record.file_count = file_count
            record.updated_at_client = updated_at_client
            record.is_deleted = False
            record.last_seen_snapshot_id = snapshot_id or record.last_seen_snapshot_id
            record.last_seen_at = now
        self.session.flush()
        return record

    def complete_snapshot(
        self,
        archive: UserSkillArchive,
        snapshot_id: str,
        *,
        mark_missing_deleted: bool,
    ) -> tuple[int, int, int, int]:
        deleted_count = 0
        if mark_missing_deleted:
            deleted_files = self.session.execute(
                update(UserSkillArchiveFile)
                .where(
                    UserSkillArchiveFile.archive_id == archive.id,
                    UserSkillArchiveFile.is_deleted.is_(False),
                    or_(
                        UserSkillArchiveFile.last_seen_snapshot_id.is_(None),
                        UserSkillArchiveFile.last_seen_snapshot_id != snapshot_id,
                    ),
                )
                .values(is_deleted=True)
            )
            deleted_count = int(deleted_files.rowcount or 0)
            self.session.execute(
                update(UserSkillArchiveEntry)
                .where(
                    UserSkillArchiveEntry.archive_id == archive.id,
                    UserSkillArchiveEntry.is_deleted.is_(False),
                    or_(
                        UserSkillArchiveEntry.last_seen_snapshot_id.is_(None),
                        UserSkillArchiveEntry.last_seen_snapshot_id != snapshot_id,
                    ),
                )
                .values(is_deleted=True)
            )
        ready_count = int(
            self.session.scalar(
                select(func.count(UserSkillArchiveFile.id)).where(
                    UserSkillArchiveFile.archive_id == archive.id,
                    UserSkillArchiveFile.is_deleted.is_(False),
                    UserSkillArchiveFile.upload_status == "ready",
                )
            )
            or 0
        )
        pending_count = int(
            self.session.scalar(
                select(func.count(UserSkillArchiveFile.id)).where(
                    UserSkillArchiveFile.archive_id == archive.id,
                    UserSkillArchiveFile.is_deleted.is_(False),
                    UserSkillArchiveFile.upload_status != "ready",
                )
            )
            or 0
        )
        skill_count = int(
            self.session.scalar(
                select(func.count(UserSkillArchiveEntry.id)).where(
                    UserSkillArchiveEntry.archive_id == archive.id,
                    UserSkillArchiveEntry.is_deleted.is_(False),
                )
            )
            or 0
        )
        return ready_count, pending_count, deleted_count, skill_count
