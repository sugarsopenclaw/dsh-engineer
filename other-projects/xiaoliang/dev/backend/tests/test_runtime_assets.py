from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app.schemas  # noqa: F401
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app
from app.services.oss_bucket import clear_oss_bucket_cache

MINGIT_SHA256 = "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05"

RUNTIME_ASSET_ENV_KEYS = (
    "RUNTIME_ASSET_GIT_BASH_OBJECT_KEY",
    "RUNTIME_ASSET_GIT_BASH_SHA256",
    "RUNTIME_ASSET_GIT_BASH_VERSION",
    "RUNTIME_ASSET_GIT_BASH_SIZE_BYTES",
    "ALIBABA_CLOUD_ACCESS_KEY_ID",
    "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    "OSS_BUCKET",
    "OSS_REGION",
    "DATABASE_URL",
    "AUTO_CREATE_TABLES",
)


class RuntimeAssetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        db_path = Path(self.tempdir.name) / "test.db"
        self.previous_env = {key: os.environ.get(key) for key in RUNTIME_ASSET_ENV_KEYS}
        os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
        os.environ["AUTO_CREATE_TABLES"] = "true"
        # Empty process-level values intentionally override a developer's
        # configured .env; otherwise this test changes meaning by machine.
        for key in RUNTIME_ASSET_ENV_KEYS[:8]:
            os.environ[key] = "0" if key == "RUNTIME_ASSET_GIT_BASH_SIZE_BYTES" else ""
        get_settings.cache_clear()
        clear_oss_bucket_cache()
        self.client = TestClient(create_app())

    def tearDown(self) -> None:
        self.client.close()
        for key, value in self.previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()
        clear_oss_bucket_cache()
        self.tempdir.cleanup()

    def configure_asset(self, *, sha256: str = MINGIT_SHA256) -> None:
        os.environ["RUNTIME_ASSET_GIT_BASH_OBJECT_KEY"] = (
            "runtime-assets/git-bash/MinGit-2.55.0.3-64-bit.zip"
        )
        os.environ["RUNTIME_ASSET_GIT_BASH_SHA256"] = sha256
        os.environ["RUNTIME_ASSET_GIT_BASH_VERSION"] = "2.55.0.windows.3"
        os.environ["RUNTIME_ASSET_GIT_BASH_SIZE_BYTES"] = "38791206"
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"] = "test-key"
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"] = "test-secret"
        os.environ["OSS_BUCKET"] = "test-bucket"
        os.environ["OSS_REGION"] = "cn-beijing"
        get_settings.cache_clear()
        clear_oss_bucket_cache()

    def test_unconfigured_asset_returns_404(self) -> None:
        response = self.client.get("/runtime-assets/git-bash")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "runtime_asset_not_configured")

    def test_invalid_sha256_is_treated_as_unconfigured(self) -> None:
        self.configure_asset(sha256="not-a-sha")
        response = self.client.get("/runtime-assets/git-bash")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "runtime_asset_not_configured")

    def test_configured_asset_returns_signed_manifest(self) -> None:
        self.configure_asset()

        class FakeBucket:
            def sign_url(self, method: str, key: str, expires: int, *, slash_safe: bool) -> str:
                assert method == "GET"
                assert slash_safe is True
                return f"https://oss.example.com/{key}?signature=test&expires={expires}"

        with patch("app.api.routes.runtime_assets.get_oss_bucket", return_value=FakeBucket()):
            response = self.client.get("/runtime-assets/git-bash")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "git-bash")
        self.assertEqual(payload["version"], "2.55.0.windows.3")
        self.assertEqual(payload["file_name"], "MinGit-2.55.0.3-64-bit.zip")
        self.assertEqual(payload["size_bytes"], 38791206)
        self.assertEqual(payload["sha256"], MINGIT_SHA256)
        self.assertIn(
            "https://oss.example.com/runtime-assets/git-bash/MinGit-2.55.0.3-64-bit.zip",
            payload["download_url"],
        )


if __name__ == "__main__":
    unittest.main()
