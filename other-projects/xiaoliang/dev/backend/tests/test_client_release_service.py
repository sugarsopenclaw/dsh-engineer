from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

import app.schemas  # noqa: F401
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import Base
from app.core.errors import AppError
from app.models.desktop_update import DesktopReleaseIn
from app.schemas.client_download_event import ClientDownloadEvent
from app.services.desktop_update_service import DesktopUpdateService


class ClientReleaseServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.previous_env = {
            "OSS_PUBLIC_BASE_URL": os.environ.get("OSS_PUBLIC_BASE_URL"),
            "DESKTOP_UPDATE_BASE_URL": os.environ.get("DESKTOP_UPDATE_BASE_URL"),
        }
        os.environ["OSS_PUBLIC_BASE_URL"] = "https://cdn.example.com"
        os.environ["DESKTOP_UPDATE_BASE_URL"] = "https://xl.x3yun.com/api/desktop-updates"
        get_settings.cache_clear()

        self.engine = create_engine(f"sqlite:///{Path(self.tempdir.name) / 'test.db'}", future=True)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, future=True)

    def tearDown(self) -> None:
        self.engine.dispose()
        for key, value in self.previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()
        self.tempdir.cleanup()

    def _seed_release(self, session) -> None:
        service = DesktopUpdateService(session, get_settings())
        service.create_desktop_release(
            DesktopReleaseIn.model_validate(
                {
                    "platform": "windows",
                    "arch": "x64",
                    "channel": "stable",
                    "version": "0.8.1",
                    "status": "published",
                    "notes": ["OSS 发布"],
                    "release_date": datetime(2026, 7, 31, tzinfo=UTC),
                    "artifacts": [
                        {
                            "kind": "installer",
                            "file_name": "晓量-Setup-0.8.1.exe",
                            "size_bytes": 2048,
                            "sha512": "sha512-demo",
                            "sha256": "c" * 64,
                            "object_key": "desktop-releases/windows/x64/0.8.1/晓量-Setup-0.8.1.exe",
                            "public_url": "https://cdn.example.com/晓量-Setup-0.8.1.exe",
                            "content_type": "application/octet-stream",
                        },
                        {
                            "kind": "blockmap",
                            "file_name": "晓量-Setup-0.8.1.exe.blockmap",
                            "size_bytes": 128,
                            "sha256": "d" * 64,
                            "object_key": "desktop-releases/windows/x64/0.8.1/晓量-Setup-0.8.1.exe.blockmap",
                            "public_url": "https://cdn.example.com/晓量-Setup-0.8.1.exe.blockmap",
                            "content_type": "application/octet-stream",
                        },
                    ],
                }
            )
        )

    def test_get_client_release_view_from_published_release(self) -> None:
        with self.session_factory() as session:
            self._seed_release(session)
            service = DesktopUpdateService(session, get_settings())
            view = service.get_client_release_view()
            self.assertEqual(view.version, "0.8.1")
            self.assertEqual(view.release_channel, "stable")
            self.assertEqual(view.artifacts[0].download_url, "/client-releases/download/windows-x64")
            self.assertIsNone(view.github_release_url)

    def test_redirect_latest_installer_logs_download_event(self) -> None:
        with self.session_factory() as session:
            self._seed_release(session)
            service = DesktopUpdateService(session, get_settings())
            location = service.redirect_latest_installer(
                platform_key="windows-x64",
                source="landing-page",
                request_headers={
                    "x-forwarded-for": "203.0.113.10",
                    "user-agent": "pytest-agent",
                    "referer": "https://release.example.com/",
                },
                client_host="127.0.0.1",
                record_event=True,
                http_method="GET",
            )
            self.assertIn("Setup-0.8.1.exe", location)
            self.assertTrue(location.startswith("https://cdn.example.com/"))
            events = session.scalars(select(ClientDownloadEvent)).all()
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].version, "0.8.1")
            self.assertEqual(events[0].source, "landing-page")

    def test_missing_release_raises(self) -> None:
        with self.session_factory() as session:
            service = DesktopUpdateService(session, get_settings())
            with self.assertRaises(AppError) as ctx:
                service.get_client_release_view()
            self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
