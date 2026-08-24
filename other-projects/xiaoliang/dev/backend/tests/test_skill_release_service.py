from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.database import Base
from app.schemas.skill_release import SkillRelease
from app.services.skill_pack_builder import (
    build_pack_manifest,
    build_skill_pack_from_directory,
    canonical_json_bytes,
)
from app.services.skill_pack_storage import SkillPackStorage
from app.services.skill_service import SkillService


class SkillReleaseServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.previous_storage_root = os.environ.get("STORAGE_ROOT")
        self.previous_oss_env = {
            "ALIBABA_CLOUD_ACCESS_KEY_ID": os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID"),
            "ALIBABA_CLOUD_ACCESS_KEY_SECRET": os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
            "OSS_BUCKET": os.environ.get("OSS_BUCKET"),
            "OSS_REGION": os.environ.get("OSS_REGION"),
        }
        os.environ["STORAGE_ROOT"] = self.tempdir.name
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"] = ""
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"] = ""
        os.environ["OSS_BUCKET"] = ""
        os.environ["OSS_REGION"] = ""
        get_settings.cache_clear()
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, future=True)

    def tearDown(self) -> None:
        self.engine.dispose()
        if self.previous_storage_root is None:
            os.environ.pop("STORAGE_ROOT", None)
        else:
            os.environ["STORAGE_ROOT"] = self.previous_storage_root
        for key, value in self.previous_oss_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()
        self.tempdir.cleanup()

    def test_compare_versions(self) -> None:
        self.assertEqual(SkillService.compare_versions("0.5.0", "0.5.0"), 0)
        self.assertLess(SkillService.compare_versions("0.5.0", "0.5.1"), 0)
        self.assertGreater(SkillService.compare_versions("1.0.0", "0.9.9"), 0)
        self.assertEqual(SkillService.compare_versions("0.5", "0.5.0"), 0)
        self.assertLess(SkillService.compare_versions(None, "0.5.0"), 0)
        self.assertGreater(SkillService.compare_versions("0.5.0", None), 0)

    def test_check_skill_release_up_to_date(self) -> None:
        with self.session_factory() as session:
            self._create_release(
                session,
                version="1.2.3",
                checksum="abc123",
                skill_count=1,
            )
            service = SkillService(session)
            view = service.check_skill_release(
                release_channel="stable",
                electron_version="0.5.0",
                current_skill_pack_version="1.2.3",
                current_skill_pack_checksum="abc123",
            )
            self.assertEqual(view.status, "up_to_date")
            self.assertEqual(view.latest_skill_pack_version, "1.2.3")
            self.assertEqual(view.latest_skill_pack_checksum, "abc123")
            self.assertEqual(view.skill_count, 1)

    def test_check_skill_release_update_available(self) -> None:
        with self.session_factory() as session:
            self._create_release(
                session,
                version="1.2.3",
                checksum="abc123",
                skill_count=2,
            )
            service = SkillService(session)
            view = service.check_skill_release(
                release_channel="stable",
                electron_version="0.5.0",
                current_skill_pack_version="1.2.2",
                current_skill_pack_checksum="xyz999",
            )
            self.assertEqual(view.status, "update_available")
            self.assertEqual(view.latest_skill_pack_version, "1.2.3")
            self.assertEqual(view.latest_skill_pack_checksum, "abc123")
            self.assertEqual(view.skill_count, 2)

    def test_check_skill_release_unsupported_client(self) -> None:
        with self.session_factory() as session:
            self._create_release(
                session,
                version="1.2.3",
                checksum="abc123",
                min_electron_version="0.6.0",
                skill_count=3,
            )
            service = SkillService(session)
            view = service.check_skill_release(
                release_channel="stable",
                electron_version="0.5.0",
                current_skill_pack_version="1.2.3",
                current_skill_pack_checksum="abc123",
            )
            self.assertEqual(view.status, "unsupported_client")
            self.assertEqual(view.required_electron_version, "0.6.0")
            self.assertEqual(view.latest_skill_pack_checksum, "abc123")
            self.assertEqual(view.skill_count, 3)

    def test_get_skill_pack_returns_latest_pack(self) -> None:
        with self.session_factory() as session:
            pack = self._create_pack_release(session, version="1.2.3")
            service = SkillService(session)
            view = service.get_skill_pack(
                release_channel="stable",
                skill_pack_version=None,
            )
            self.assertEqual(view.skill_pack_version, "1.2.3")
            self.assertEqual(view.skill_pack_checksum, pack["skill_pack_checksum"])
            self.assertEqual(len(view.skills), 1)
            self.assertEqual(view.skills[0].slug, "frustum-box-foundation")
            self.assertIn("SKILL.md", [item.path for item in view.skills[0].files])

    def test_get_skill_pack_checksum_mismatch_raises(self) -> None:
        with self.session_factory() as session:
            self._create_pack_release(session, version="1.2.3", checksum_override="broken-checksum")
            service = SkillService(session)
            with self.assertRaises(AppError) as context:
                service.get_skill_pack(
                    release_channel="stable",
                    skill_pack_version="1.2.3",
                )
            self.assertEqual(context.exception.status_code, 500)
            self.assertEqual(context.exception.error_code, "skill_pack_checksum_mismatch")

    def _create_release(
        self,
        session: Session,
        *,
        version: str,
        checksum: str,
        min_electron_version: str | None = None,
        skill_count: int = 0,
        pack_storage_key: str | None = None,
        pack_manifest_json: dict | None = None,
        pack_format_version: int = 1,
    ) -> None:
        session.add(
            SkillRelease(
                release_channel="stable",
                skill_pack_version=version,
                skill_pack_checksum=checksum,
                pack_format_version=pack_format_version,
                pack_storage_key=pack_storage_key,
                pack_manifest_json=pack_manifest_json,
                skill_count=skill_count,
                min_electron_version=min_electron_version,
                release_notes="test",
                released_at=datetime.now(timezone.utc),
                status="published",
            )
        )
        session.commit()

    def _create_pack_release(
        self,
        session: Session,
        *,
        version: str,
        checksum_override: str | None = None,
    ) -> dict:
        source_dir = Path(self.tempdir.name) / "skills" / "cad" / "frustum-box-foundation"
        references_dir = source_dir / "references"
        references_dir.mkdir(parents=True, exist_ok=True)
        (source_dir / "SKILL.md").write_text(
            "\n".join(
                [
                    "---",
                    "name: frustum-box-foundation",
                    "description: 计算锥形独立基础截头体体积",
                    "---",
                    "",
                    "# 锥形独立基础截头体",
                    "",
                    "按照截图提取 h1、h2、顶部尺寸和底部尺寸。",
                ]
            ),
            encoding="utf-8",
        )
        (references_dir / "protocol.md").write_text(
            "# protocol\n\n- read screenshot first",
            encoding="utf-8",
        )
        released_at = datetime(2026, 4, 23, 2, 0, 0, tzinfo=timezone.utc)
        pack = build_skill_pack_from_directory(
            source_dir=source_dir,
            release_channel="stable",
            skill_pack_version=version,
            domain="cad",
            built_at=released_at,
        )
        storage_key = f"skills/releases/stable/{version}/skill-pack.json"
        SkillPackStorage().put_bytes(
            storage_key,
            canonical_json_bytes(pack),
            content_type="application/json; charset=utf-8",
        )
        self._create_release(
            session,
            version=version,
            checksum=checksum_override or pack["skill_pack_checksum"],
            skill_count=len(pack["skills"]),
            pack_storage_key=storage_key,
            pack_manifest_json=build_pack_manifest(pack),
            pack_format_version=pack["pack_format_version"],
        )
        return pack


if __name__ == "__main__":
    unittest.main()
