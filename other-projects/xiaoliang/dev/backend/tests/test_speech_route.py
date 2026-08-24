from __future__ import annotations

import os
import unittest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user_detached, get_qwen_asr_service
from app.core.config import Settings, get_settings
from app.main import create_app
from app.models.user import CurrentUserData, OrganizationView, UserView


class _StubQwenAsrService:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, str]] = []

    def transcribe(self, body: bytes, audio_mime_type: str = "") -> dict[str, str]:
        self.calls.append((body, audio_mime_type))
        return {"text": "你好", "model": "stub-asr"}


def _current_user() -> CurrentUserData:
    return CurrentUserData(
        user=UserView(id="user-1", email="tester@example.com", display_name="Tester"),
        organization=OrganizationView(id="org-1", name="Test Org", slug="test-org"),
        role="owner",
    )


def _settings() -> Settings:
    return Settings(
        PATIENT_ASR_MAX_FILE_SIZE_MB=1,
        PATIENT_ASR_ALLOWED_EXTENSIONS=[
            ".webm",
            ".wav",
            ".mp3",
            ".m4a",
            ".ogg",
            ".opus",
            ".aac",
            ".flac",
            ".amr",
        ],
        PATIENT_ASR_ALLOWED_MIME_TYPES=[
            "audio/webm",
            "audio/wav",
            "audio/mpeg",
            "audio/mp4",
            "audio/ogg",
            "audio/opus",
            "audio/aac",
            "audio/flac",
            "audio/amr",
            "video/webm",
            "application/octet-stream",
        ],
    )


def _ogg_opus_bytes() -> bytes:
    return b"OggS" + (b"\x00" * 32) + b"OpusHead" + (b"\x00" * 32)


class SpeechRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = create_app()
        self.asr_service = _StubQwenAsrService()
        app.dependency_overrides[get_current_user_detached] = _current_user
        app.dependency_overrides[get_qwen_asr_service] = lambda: self.asr_service
        app.dependency_overrides[get_settings] = _settings
        self.client = TestClient(app)
        self.app = app

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_transcribe_accepts_octet_stream_ogg_opus(self) -> None:
        audio_body = _ogg_opus_bytes()

        response = self.client.post(
            "/speech/transcribe",
            files={"audio": ("voice", audio_body, "application/octet-stream")},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.asr_service.calls, [(audio_body, "audio/ogg")])
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["text"], "你好")
        self.assertEqual(payload["data"]["content_type"], "audio/ogg")
        self.assertEqual(payload["data"]["original_content_type"], "application/octet-stream")
        self.assertEqual(payload["data"]["detected_format"], "ogg_opus")

    def test_transcribe_rejects_unknown_octet_stream(self) -> None:
        response = self.client.post(
            "/speech/transcribe",
            files={"audio": ("voice.ogg", b"not-an-audio-file", "application/octet-stream")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.asr_service.calls, [])
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("无法识别音频格式", payload["error"])

    def test_transcribe_enforces_size_before_asr(self) -> None:
        response = self.client.post(
            "/speech/transcribe",
            files={"audio": ("voice.ogg", b"0" * (1024 * 1024 + 1), "audio/ogg")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.asr_service.calls, [])
        payload = response.json()
        self.assertIn("超过大小限制", payload["error"])


if __name__ == "__main__":
    unittest.main()
