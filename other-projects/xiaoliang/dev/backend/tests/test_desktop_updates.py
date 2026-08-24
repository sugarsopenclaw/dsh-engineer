from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

import app.schemas  # noqa: F401
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_desktop_update_service
from app.core.config import get_settings
from app.core.database import Base, get_db_session
from app.main import create_app
from app.schemas.desktop_release import DesktopUpdateEvent
from app.services import desktop_update_service as desktop_update_module
from app.services.desktop_update_service import DesktopUpdateService
from app.services.oss_bucket import clear_oss_bucket_cache


def release_payload(
    version: str = "0.2.0",
    *,
    channel: str = "stable",
    status: str = "published",
    file_name: str | None = None,
    staging_percentage: int | None = 25,
) -> dict:
    installer_name = file_name or f"晓量-Setup-{version}.exe"
    return {
        "platform": "windows",
        "arch": "x64",
        "channel": channel,
        "version": version,
        "status": status,
        "staging_percentage": staging_percentage,
        "notes": ["自动更新测试"],
        "release_date": datetime(2026, 7, 31, 8, 0, tzinfo=UTC).isoformat(),
        "artifacts": [
            {
                "kind": "installer",
                "file_name": installer_name,
                "size_bytes": 123456,
                "sha512": "sha512-installer",
                "sha256": "a" * 64,
                "object_key": f"desktop-releases/windows/x64/{version}/{installer_name}",
                "public_url": f"https://cdn.example.com/{installer_name}",
                "content_type": "application/octet-stream",
            },
            {
                "kind": "blockmap",
                "file_name": f"{installer_name}.blockmap",
                "size_bytes": 789,
                "sha256": "b" * 64,
                "object_key": f"desktop-releases/windows/x64/{version}/{installer_name}.blockmap",
                "public_url": f"https://cdn.example.com/{installer_name}.blockmap",
                "content_type": "application/octet-stream",
            },
        ],
    }


class DesktopUpdateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.previous_env = {
            "DATABASE_URL": os.environ.get("DATABASE_URL"),
            "AUTO_CREATE_TABLES": os.environ.get("AUTO_CREATE_TABLES"),
            "RELEASE_ADMIN_TOKEN": os.environ.get("RELEASE_ADMIN_TOKEN"),
            "DESKTOP_UPDATE_BASE_URL": os.environ.get("DESKTOP_UPDATE_BASE_URL"),
            "OSS_PUBLIC_BASE_URL": os.environ.get("OSS_PUBLIC_BASE_URL"),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID"),
            "ALIBABA_CLOUD_ACCESS_KEY_SECRET": os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
            "OSS_BUCKET": os.environ.get("OSS_BUCKET"),
            "OSS_REGION": os.environ.get("OSS_REGION"),
            "OSS_RELEASE_SIGNED_URL_EXPIRES_SECONDS": os.environ.get("OSS_RELEASE_SIGNED_URL_EXPIRES_SECONDS"),
        }
        os.environ["DATABASE_URL"] = f"sqlite:///{self.db_path.as_posix()}"
        os.environ["AUTO_CREATE_TABLES"] = "true"
        os.environ["RELEASE_ADMIN_TOKEN"] = "test-admin-token"
        os.environ["DESKTOP_UPDATE_BASE_URL"] = "https://xl.x3yun.com/api/desktop-updates"
        os.environ["OSS_PUBLIC_BASE_URL"] = "https://cdn.example.com"
        get_settings.cache_clear()
        clear_oss_bucket_cache()

        self.engine = create_engine(
            f"sqlite:///{self.db_path.as_posix()}",
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, future=True)

        app = create_app()

        def override_db():
            session = self.SessionLocal()
            try:
                yield session
            finally:
                session.close()

        def override_service():
            session = self.SessionLocal()
            try:
                yield DesktopUpdateService(session, get_settings())
            finally:
                session.close()

        app.dependency_overrides[get_db_session] = override_db
        app.dependency_overrides[get_desktop_update_service] = override_service
        self.client = TestClient(app)
        self.app = app
        self.admin_headers = {"X-Release-Admin-Token": "test-admin-token"}

    def tearDown(self) -> None:
        self.client.close()
        self.app.dependency_overrides.clear()
        self.engine.dispose()
        for key, value in self.previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()
        clear_oss_bucket_cache()
        self.tempdir.cleanup()

    def test_desktop_update_feed_returns_latest_yml_with_staging(self) -> None:
        create_response = self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload(),
            headers=self.admin_headers,
        )
        self.assertEqual(create_response.status_code, 200)

        response = self.client.get("/desktop-updates/windows/x64/latest.yml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("version: '0.2.0'", response.text)
        self.assertIn("url: '晓量-Setup-0.2.0.exe'", response.text)
        self.assertIn("sha512: 'sha512-installer'", response.text)
        self.assertIn("stagingPercentage: 25", response.text)

    def test_beta_feed_is_separate_from_stable(self) -> None:
        self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload("0.2.0", channel="stable"),
            headers=self.admin_headers,
        )
        self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload("0.3.0-beta.1", channel="beta", file_name="晓量-Setup-0.3.0-beta.1.exe"),
            headers=self.admin_headers,
        )

        stable = self.client.get("/desktop-updates/windows/x64/latest.yml")
        beta = self.client.get("/desktop-updates/windows/x64/beta.yml")
        self.assertIn("version: '0.2.0'", stable.text)
        self.assertIn("version: '0.3.0-beta.1'", beta.text)

    def test_paused_or_yanked_release_is_not_served(self) -> None:
        create_response = self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload(),
            headers=self.admin_headers,
        )
        release_id = create_response.json()["id"]

        pause_response = self.client.post(
            f"/desktop-updates/admin/releases/{release_id}/pause",
            headers=self.admin_headers,
        )
        self.assertEqual(pause_response.status_code, 200)
        self.assertEqual(self.client.get("/desktop-updates/windows/x64/latest.yml").status_code, 404)

        self.client.post(
            f"/desktop-updates/admin/releases/{release_id}/yank",
            headers=self.admin_headers,
        )
        self.assertEqual(self.client.get("/desktop-updates/windows/x64/latest.yml").status_code, 404)

    def test_update_policy_marks_old_clients_for_forced_update(self) -> None:
        self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload("0.2.0"),
            headers=self.admin_headers,
        )
        policy_response = self.client.put(
            "/desktop-updates/admin/policies/windows/x64/stable",
            json={
                "minimum_supported_version": "0.2.0",
                "force_update_message": "请升级到最新版本。",
                "enabled": True,
            },
            headers=self.admin_headers,
        )
        self.assertEqual(policy_response.status_code, 200)

        response = self.client.post(
            "/desktop-updates/policy",
            json={"platform": "windows", "arch": "x64", "channel": "stable", "current_version": "0.1.0"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["latest_version"], "0.2.0")
        self.assertTrue(body["update_available"])
        self.assertTrue(body["force_update"])
        self.assertFalse(body["is_supported"])
        self.assertEqual(body["feed_url"], "https://xl.x3yun.com/api/desktop-updates/windows/x64/latest.yml")

    def test_desktop_update_download_records_get_only(self) -> None:
        self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload(),
            headers=self.admin_headers,
        )

        head_response = self.client.head(
            "/desktop-updates/windows/x64/晓量-Setup-0.2.0.exe",
            follow_redirects=False,
        )
        get_response = self.client.get(
            "/desktop-updates/windows/x64/晓量-Setup-0.2.0.exe?source=updater",
            follow_redirects=False,
        )
        self.assertEqual(head_response.status_code, 302)
        self.assertEqual(get_response.status_code, 302)
        self.assertEqual(
            get_response.headers["location"],
            "https://cdn.example.com/%E6%99%93%E9%87%8F-Setup-0.2.0.exe",
        )

        with self.SessionLocal() as session:
            events = session.scalars(
                select(DesktopUpdateEvent).where(DesktopUpdateEvent.event_type == "download")
            ).all()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].source, "updater")
        self.assertEqual(events[0].target_version, "0.2.0")

    def test_private_oss_downloads_use_fresh_method_specific_signed_urls(self) -> None:
        calls: list[tuple[str, str, int, bool]] = []

        class FakeBucket:
            def sign_url(self, method, object_key, expires, *, slash_safe):
                calls.append((method, object_key, expires, slash_safe))
                return f"https://signed.example/{method.lower()}"

        os.environ["OSS_PUBLIC_BASE_URL"] = ""
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"] = "test-access-key"
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"] = "test-secret"
        os.environ["OSS_BUCKET"] = "private-release-bucket"
        os.environ["OSS_REGION"] = "cn-beijing"
        os.environ["OSS_RELEASE_SIGNED_URL_EXPIRES_SECONDS"] = "21600"
        get_settings.cache_clear()
        clear_oss_bucket_cache()

        original = desktop_update_module.get_oss_bucket
        desktop_update_module.get_oss_bucket = lambda settings=None: FakeBucket()  # type: ignore[assignment]
        try:
            self.client.post(
                "/desktop-updates/admin/releases",
                json=release_payload(),
                headers=self.admin_headers,
            )
            head_response = self.client.head(
                "/desktop-updates/windows/x64/晓量-Setup-0.2.0.exe",
                follow_redirects=False,
            )
            get_response = self.client.get(
                "/desktop-updates/windows/x64/晓量-Setup-0.2.0.exe",
                follow_redirects=False,
            )
            latest_response = self.client.get(
                "/client-releases/download/windows-x64",
                follow_redirects=False,
            )
            self.assertEqual(head_response.headers["location"], "https://signed.example/head")
            self.assertEqual(get_response.headers["location"], "https://signed.example/get")
            self.assertEqual(latest_response.headers["location"], "https://signed.example/get")
            self.assertEqual(
                calls,
                [
                    ("HEAD", "desktop-releases/windows/x64/0.2.0/晓量-Setup-0.2.0.exe", 21600, True),
                    ("GET", "desktop-releases/windows/x64/0.2.0/晓量-Setup-0.2.0.exe", 21600, True),
                    ("GET", "desktop-releases/windows/x64/0.2.0/晓量-Setup-0.2.0.exe", 21600, True),
                ],
            )
        finally:
            desktop_update_module.get_oss_bucket = original  # type: ignore[assignment]

    def test_client_releases_latest_uses_published_desktop_release(self) -> None:
        self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload(),
            headers=self.admin_headers,
        )
        latest = self.client.get("/client-releases/latest")
        self.assertEqual(latest.status_code, 200)
        payload = latest.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["version"], "0.2.0")
        self.assertEqual(payload["data"]["artifacts"][0]["download_url"], "/client-releases/download/windows-x64")

    def test_admin_token_is_required(self) -> None:
        missing = self.client.post("/desktop-updates/admin/releases", json=release_payload())
        invalid = self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload(),
            headers={"X-Release-Admin-Token": "wrong"},
        )
        self.assertEqual(missing.status_code, 403)
        self.assertEqual(invalid.status_code, 403)

    def test_desktop_update_file_rejects_path_traversal(self) -> None:
        response = self.client.post(
            "/desktop-updates/admin/releases",
            json=release_payload(file_name="..\\secret.exe"),
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
