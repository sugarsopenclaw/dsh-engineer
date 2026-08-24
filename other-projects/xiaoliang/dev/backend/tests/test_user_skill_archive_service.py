from __future__ import annotations

import hashlib
import io
import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
from app.core.config import get_settings
from app.core.database import Base
from app.core.errors import AppError
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.models.user_skill_archive import (
    UserSkillArchiveFilesConfirmRequest,
    UserSkillArchiveFilesPrepareRequest,
    UserSkillArchiveSnapshotCompleteRequest,
    UserSkillArchiveSnapshotStartRequest,
)
from app.repositories.user_skill_archive_repository import UserSkillArchiveRepository
from app.schemas.organization import Organization
from app.schemas.user import User
from app.schemas.user_skill_archive import UserSkillArchive, UserSkillArchiveEntry, UserSkillArchiveFile
from app.services.user_skill_archive_service import UserSkillArchiveService


class _FakeBucket:
    def __init__(self, data: bytes, sha256: str | None) -> None:
        self.data = data
        self.sha256 = sha256
        self.signed: list[tuple[str, str]] = []

    def sign_url(self, method: str, storage_key: str, _expires: int, **_kwargs):
        self.signed.append((method, storage_key))
        return f"https://signed.invalid/{method.lower()}/{storage_key}"

    def head_object(self, _storage_key: str):
        headers = {"x-oss-meta-sha256": self.sha256} if self.sha256 else {}
        return SimpleNamespace(content_length=len(self.data), headers=headers)

    def get_object(self, _storage_key: str):
        return io.BytesIO(self.data)


class UserSkillArchiveServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(
            bind=self.engine,
            autoflush=False,
            autocommit=False,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()
        self.organization = Organization(name="Test Org", slug="user-skill-archive-test")
        self.owner = User(
            email="skill-owner@example.com",
            password_hash="hashed",
            display_name="Owner",
        )
        self.other_user = User(
            email="skill-other@example.com",
            password_hash="hashed",
            display_name="Other",
        )
        self.session.add_all([self.organization, self.owner, self.other_user])
        self.session.commit()
        self.owner_context = self._current_user(self.owner)
        self.other_context = self._current_user(self.other_user)
        self.settings = get_settings().model_copy(update={"project_archive_enabled": True})

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def _current_user(self, user: User) -> CurrentUserData:
        return CurrentUserData(
            user=UserView.model_validate(user),
            organization=OrganizationView.model_validate(self.organization),
            role="member",
        )

    def _service(self, bucket: _FakeBucket | None = None) -> UserSkillArchiveService:
        service = UserSkillArchiveService(self.settings, self.session)
        if bucket is not None:
            service._bucket = lambda: bucket  # type: ignore[method-assign]
        else:
            service._sign_url = (  # type: ignore[method-assign]
                lambda **kwargs: f"https://signed.invalid/{kwargs['method'].lower()}/{kwargs['storage_key']}"
            )
        return service

    def test_each_user_gets_an_isolated_archive(self) -> None:
        owner_started = self._service().start_snapshot(
            self.owner_context,
            UserSkillArchiveSnapshotStartRequest(skills_root_name="skills"),
        )
        other_started = self._service().start_snapshot(
            self.other_context,
            UserSkillArchiveSnapshotStartRequest(skills_root_name="skills"),
        )
        archives = list(self.session.scalars(select(UserSkillArchive)))
        self.assertEqual(len(archives), 2)
        self.assertNotEqual(owner_started.archive_id, other_started.archive_id)
        self.assertEqual(
            {archive.owner_user_id for archive in archives},
            {self.owner.id, self.other_user.id},
        )

    def test_prepare_uses_account_scoped_oss_keys_and_does_not_inherit_ready(self) -> None:
        data = b"# custom skill\n"
        sha256 = hashlib.sha256(data).hexdigest()
        service = self._service()
        started = service.start_snapshot(
            self.owner_context,
            UserSkillArchiveSnapshotStartRequest(),
        )
        prepared = service.prepare_files(
            self.owner_context,
            UserSkillArchiveFilesPrepareRequest.model_validate(
                {
                    "snapshot_id": started.snapshot_id,
                    "files": [
                        {
                            "relative_path": "door-schedule/SKILL.md",
                            "size_bytes": len(data),
                            "sha256": sha256,
                            "media_type": "text/markdown",
                            "skill_slug": "door-schedule",
                        }
                    ],
                }
            ),
        )
        self.assertEqual(len(prepared.targets), 1)
        self.assertTrue(prepared.targets[0].upload_required)
        self.assertTrue(
            prepared.targets[0].upload_url.endswith(
                f"user-skill-archives/{self.organization.id}/{self.owner.id}/files/{sha256[:2]}/{sha256}.md"
            )
        )

        record = self.session.scalar(select(UserSkillArchiveFile))
        assert record is not None
        repository = UserSkillArchiveRepository(self.session)
        repository.mark_file_ready(record)
        self.session.commit()

        duplicate = repository.upsert_file(
            archive_id=record.archive_id,
            user_id=self.owner.id,
            skill_slug="door-schedule",
            relative_path="door-schedule/references/notes.md",
            normalized_path="door-schedule/references/notes.md",
            filename="notes.md",
            extension=".md",
            media_type="text/markdown",
            size_bytes=len(data),
            sha256=sha256,
            modified_at_client=None,
            storage_key=record.storage_key or "",
            snapshot_id=started.snapshot_id,
        )
        self.assertEqual(duplicate.upload_status, "pending")

    def test_confirm_rejects_object_bytes_that_do_not_match(self) -> None:
        expected = b"safe skill"
        sha256 = hashlib.sha256(expected).hexdigest()
        service = self._service()
        started = service.start_snapshot(self.owner_context, UserSkillArchiveSnapshotStartRequest())
        service.prepare_files(
            self.owner_context,
            UserSkillArchiveFilesPrepareRequest.model_validate(
                {
                    "snapshot_id": started.snapshot_id,
                    "files": [
                        {
                            "relative_path": "manifest.json",
                            "size_bytes": len(expected),
                            "sha256": sha256,
                            "media_type": "application/json",
                        }
                    ],
                }
            ),
        )
        record = self.session.scalar(select(UserSkillArchiveFile))
        assert record is not None
        record_id = record.id
        confirm_service = self._service(_FakeBucket(b"evil skill", sha256))
        result = confirm_service.confirm_files(
            self.owner_context,
            UserSkillArchiveFilesConfirmRequest.model_validate(
                {
                    "files": [{"relative_path": "manifest.json", "sha256": sha256}],
                }
            ),
        )
        self.assertEqual(result.results[0].status, "mismatch")
        self.assertIn("实际内容", result.results[0].error or "")
        refreshed = self.session.get(UserSkillArchiveFile, record_id)
        self.assertEqual(refreshed.upload_status, "failed")

    def test_complete_snapshot_records_skills_and_marks_missing_deleted(self) -> None:
        service = self._service()
        first = service.start_snapshot(self.owner_context, UserSkillArchiveSnapshotStartRequest())
        first_data = b"first"
        first_sha = hashlib.sha256(first_data).hexdigest()
        service.prepare_files(
            self.owner_context,
            UserSkillArchiveFilesPrepareRequest.model_validate(
                {
                    "snapshot_id": first.snapshot_id,
                    "files": [
                        {
                            "relative_path": "old-skill/SKILL.md",
                            "size_bytes": len(first_data),
                            "sha256": first_sha,
                            "skill_slug": "old-skill",
                        }
                    ],
                }
            ),
        )
        service.complete_snapshot(
            self.owner_context,
            first.snapshot_id,
            UserSkillArchiveSnapshotCompleteRequest.model_validate(
                {
                    "file_count": 1,
                    "total_bytes": len(first_data),
                    "scan_complete": True,
                    "skills": [
                        {
                            "slug": "old-skill",
                            "name": "Old",
                            "description": "retired later",
                            "enabled": True,
                            "validation_status": "valid",
                            "file_count": 1,
                        }
                    ],
                }
            ),
        )

        second = service.start_snapshot(self.owner_context, UserSkillArchiveSnapshotStartRequest())
        second_data = b"second"
        second_sha = hashlib.sha256(second_data).hexdigest()
        service.prepare_files(
            self.owner_context,
            UserSkillArchiveFilesPrepareRequest.model_validate(
                {
                    "snapshot_id": second.snapshot_id,
                    "files": [
                        {
                            "relative_path": "new-skill/SKILL.md",
                            "size_bytes": len(second_data),
                            "sha256": second_sha,
                            "skill_slug": "new-skill",
                        }
                    ],
                }
            ),
        )
        completed = service.complete_snapshot(
            self.owner_context,
            second.snapshot_id,
            UserSkillArchiveSnapshotCompleteRequest.model_validate(
                {
                    "file_count": 1,
                    "total_bytes": len(second_data),
                    "scan_complete": True,
                    "skills_root_name": "skills",
                    "skills": [
                        {
                            "slug": "new-skill",
                            "name": "New",
                            "description": "kept",
                            "enabled": False,
                            "validation_status": "invalid",
                            "validation_message": "缺少 description",
                            "file_count": 1,
                        }
                    ],
                }
            ),
        )
        self.assertEqual(completed.skill_count, 1)
        self.assertEqual(completed.deleted_file_count, 1)
        self.assertEqual(completed.sync_status, "partial")

        old_file = self.session.scalar(
            select(UserSkillArchiveFile).where(UserSkillArchiveFile.relative_path == "old-skill/SKILL.md")
        )
        new_file = self.session.scalar(
            select(UserSkillArchiveFile).where(UserSkillArchiveFile.relative_path == "new-skill/SKILL.md")
        )
        old_entry = self.session.scalar(
            select(UserSkillArchiveEntry).where(UserSkillArchiveEntry.slug == "old-skill")
        )
        new_entry = self.session.scalar(
            select(UserSkillArchiveEntry).where(UserSkillArchiveEntry.slug == "new-skill")
        )
        assert old_file is not None and new_file is not None
        assert old_entry is not None and new_entry is not None
        self.assertTrue(old_file.is_deleted)
        self.assertFalse(new_file.is_deleted)
        self.assertTrue(old_entry.is_deleted)
        self.assertFalse(new_entry.is_deleted)
        self.assertFalse(new_entry.enabled)
        self.assertEqual(new_entry.validation_status, "invalid")

    def test_rejects_path_escape_and_slug_mismatch(self) -> None:
        service = self._service()
        started = service.start_snapshot(self.owner_context, UserSkillArchiveSnapshotStartRequest())
        with self.assertRaises(AppError) as path_error:
            service.prepare_files(
                self.owner_context,
                UserSkillArchiveFilesPrepareRequest.model_validate(
                    {
                        "snapshot_id": started.snapshot_id,
                        "files": [
                            {
                                "relative_path": "../secret/SKILL.md",
                                "size_bytes": 4,
                                "sha256": "a" * 64,
                            }
                        ],
                    }
                ),
            )
        self.assertEqual(path_error.exception.error_code, "user_skill_archive_invalid_path")

        with self.assertRaises(AppError) as slug_error:
            service.prepare_files(
                self.owner_context,
                UserSkillArchiveFilesPrepareRequest.model_validate(
                    {
                        "snapshot_id": started.snapshot_id,
                        "files": [
                            {
                                "relative_path": "door-schedule/SKILL.md",
                                "size_bytes": 4,
                                "sha256": "b" * 64,
                                "skill_slug": "other-skill",
                            }
                        ],
                    }
                ),
            )
        self.assertEqual(slug_error.exception.error_code, "user_skill_archive_slug_mismatch")

    def test_prepare_without_snapshot_requires_existing_archive(self) -> None:
        service = self._service()
        with self.assertRaises(AppError) as raised:
            service.prepare_files(
                self.owner_context,
                UserSkillArchiveFilesPrepareRequest.model_validate(
                    {
                        "files": [
                            {
                                "relative_path": "manifest.json",
                                "size_bytes": 2,
                                "sha256": "c" * 64,
                            }
                        ],
                    }
                ),
            )
        self.assertEqual(raised.exception.error_code, "user_skill_archive_not_found")


if __name__ == "__main__":
    unittest.main()
