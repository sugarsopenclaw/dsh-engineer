from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.api.dependencies import get_desktop_update_service
from app.main import create_app
from app.models.client_release import ClientReleaseView


class _StubDesktopUpdateService:
    def __init__(self) -> None:
        self.last_download_request: dict[str, str | None] | None = None

    def get_client_release_view(self) -> ClientReleaseView:
        return ClientReleaseView(
            product_name="晓量",
            tagline="AI 工程造价算量桌面端",
            summary="release landing page",
            release_channel="stable",
            version="0.8.1",
            published_at="2026-07-31T00:40:00+08:00",
            release_notes_title="0.8.1 最新版本",
            release_notes=["OSS 发布"],
            highlights=["后端 302 到 OSS"],
            installation_steps=["下载安装包"],
            support_text="support",
            github_release_url=None,
            artifacts=[
                {
                    "platform": "windows-x64",
                    "label": "Windows 64 位安装包",
                    "file_name": "晓量-Setup-0.8.1.exe",
                    "download_url": "/client-releases/download/windows-x64",
                    "backup_url": None,
                    "notes": ["stub"],
                }
            ],
        )

    def redirect_latest_installer(
        self,
        *,
        platform_key: str,
        source: str | None,
        request_headers: dict[str, str],
        client_host: str | None,
        record_event: bool,
        http_method: str,
    ) -> str:
        self.last_download_request = {
            "platform": platform_key,
            "source": source,
            "client_ip": (request_headers.get("x-forwarded-for") or "").split(",", 1)[0].strip() or client_host,
            "user_agent": request_headers.get("user-agent"),
            "referer": request_headers.get("referer"),
            "http_method": http_method,
            "record_event": "1" if record_event else "0",
        }
        return "https://cdn.example.com/%E6%99%93%E9%87%8F-Setup-0.8.1.exe"


class ClientReleaseRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = create_app()
        self.stub = _StubDesktopUpdateService()
        app.dependency_overrides[get_desktop_update_service] = lambda: self.stub
        self.client = TestClient(app)
        self.app = app

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_get_latest_release(self) -> None:
        response = self.client.get("/client-releases/latest")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["version"], "0.8.1")
        self.assertEqual(payload["data"]["artifacts"][0]["platform"], "windows-x64")
        self.assertEqual(payload["data"]["artifacts"][0]["download_url"], "/client-releases/download/windows-x64")

    def test_download_redirects_and_passes_request_metadata(self) -> None:
        response = self.client.get(
            "/client-releases/download/windows-x64",
            params={"source": "landing-page"},
            headers={
                "x-forwarded-for": "203.0.113.10, 10.0.0.1",
                "user-agent": "pytest-agent",
                "referer": "https://release.example.com/",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            response.headers["location"],
            "https://cdn.example.com/%E6%99%93%E9%87%8F-Setup-0.8.1.exe",
        )
        self.assertEqual(
            self.stub.last_download_request,
            {
                "platform": "windows-x64",
                "source": "landing-page",
                "client_ip": "203.0.113.10",
                "user_agent": "pytest-agent",
                "referer": "https://release.example.com/",
                "http_method": "GET",
                "record_event": "1",
            },
        )


if __name__ == "__main__":
    unittest.main()
