from __future__ import annotations

import unittest
from typing import Annotated

from fastapi import Header
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_skill_service
from app.core.errors import AppError
from app.main import create_app
from app.models.skill_release import SkillPackView, SkillReleaseCheckView


class _StubSkillService:
    def check_skill_release(
        self,
        *,
        release_channel: str,
        electron_version: str | None,
        current_skill_pack_version: str | None,
        current_skill_pack_checksum: str | None,
    ) -> SkillReleaseCheckView:
        if electron_version == "0.1.0":
            return SkillReleaseCheckView(
                status="unsupported_client",
                latest_skill_pack_version="1.2.0",
                latest_skill_pack_checksum="sha-120",
                skill_count=1,
                release_notes="need upgrade",
                required_electron_version="0.2.0",
            )
        if current_skill_pack_version == "1.2.0":
            return SkillReleaseCheckView(
                status="up_to_date",
                latest_skill_pack_version="1.2.0",
                latest_skill_pack_checksum="sha-120",
                skill_count=1,
                release_notes="latest",
            )
        return SkillReleaseCheckView(
            status="update_available",
            latest_skill_pack_version="1.2.0",
            latest_skill_pack_checksum="sha-120",
            skill_count=1,
            release_notes="new release",
        )

    def get_skill_pack(
        self,
        *,
        release_channel: str,
        skill_pack_version: str | None,
    ) -> SkillPackView:
        version = skill_pack_version or "1.2.0"
        return SkillPackView(
            pack_format_version=1,
            release_channel=release_channel,
            skill_pack_version=version,
            skill_pack_checksum="sha-120",
            built_at="2026-04-23T02:00:00+00:00",
            skills=[
                {
                    "slug": "frustum-box-foundation",
                    "domain": "cad",
                    "name": "锥形独立基础截头体",
                    "description": "计算锥形独立基础截头体体积",
                    "version": version,
                    "checksum": "skill-sha",
                    "updated_at": "2026-04-23T02:00:00+00:00",
                    "files": [
                        {
                            "path": "SKILL.md",
                            "content": "# skill",
                            "checksum": "file-sha",
                        }
                    ],
                }
            ],
            metadata={"source": "stub"},
        )


def _require_test_user(
    authorization: Annotated[str | None, Header()] = None,
) -> object:
    if authorization != "Bearer test-access-token":
        raise AppError(401, "缺少访问令牌。", error_code="missing_token")
    return object()


class SkillReleaseRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = create_app()
        app.dependency_overrides[get_skill_service] = lambda: _StubSkillService()
        app.dependency_overrides[get_current_user] = _require_test_user
        self.client = TestClient(app)
        self.app = app
        self.auth_headers = {"Authorization": "Bearer test-access-token"}

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_check_release_update_available(self) -> None:
        response = self.client.get(
            "/skills/releases/check",
            headers=self.auth_headers,
            params={
                "release_channel": "stable",
                "electron_version": "0.5.0",
                "current_skill_pack_version": "1.1.0",
                "current_skill_pack_checksum": "old",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["status"], "update_available")
        self.assertEqual(payload["data"]["latest_skill_pack_version"], "1.2.0")
        self.assertEqual(payload["data"]["latest_skill_pack_checksum"], "sha-120")
        self.assertEqual(payload["data"]["skill_count"], 1)

    def test_check_release_unsupported_client(self) -> None:
        response = self.client.get(
            "/skills/releases/check",
            headers=self.auth_headers,
            params={
                "release_channel": "stable",
                "electron_version": "0.1.0",
                "current_skill_pack_version": "1.2.0",
                "current_skill_pack_checksum": "any",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data"]["status"], "unsupported_client")
        self.assertEqual(payload["data"]["required_electron_version"], "0.2.0")

    def test_get_release_pack(self) -> None:
        response = self.client.get(
            "/skills/releases/pack",
            headers=self.auth_headers,
            params={
                "release_channel": "stable",
                "skill_pack_version": "1.2.0",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["skill_pack_version"], "1.2.0")
        self.assertEqual(payload["data"]["skill_pack_checksum"], "sha-120")
        self.assertEqual(payload["data"]["skills"][0]["slug"], "frustum-box-foundation")
        self.assertEqual(payload["data"]["skills"][0]["files"][0]["path"], "SKILL.md")

    def test_skill_release_routes_reject_anonymous_requests(self) -> None:
        check = self.client.get("/skills/releases/check")
        pack = self.client.get("/skills/releases/pack")
        self.assertEqual(check.status_code, 401)
        self.assertEqual(pack.status_code, 401)
        self.assertEqual(check.json()["code"], "missing_token")
        self.assertEqual(pack.json()["code"], "missing_token")

    def test_submission_and_community_skill_routes_are_retired(self) -> None:
        self.assertEqual(self.client.get("/submissions").status_code, 404)
        self.assertEqual(self.client.get("/skills").status_code, 404)
        self.assertEqual(self.client.get("/skills/legacy-skill-id").status_code, 404)


if __name__ == "__main__":
    unittest.main()
