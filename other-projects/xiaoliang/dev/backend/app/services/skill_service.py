from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.skill_release import SkillPackView, SkillReleaseCheckView
from app.repositories.skill_release_repository import SkillReleaseRepository
from app.schemas.skill_release import SkillRelease
from app.services.skill_pack_storage import SkillPackStorage


class SkillService:
    """Serve signed-off marketplace packs.

    Legacy authoring and database-published community skills were retired.
    The backend now owns only the curated marketplace release channel.
    """

    def __init__(self, session: Session) -> None:
        self.releases = SkillReleaseRepository(session)

    def check_skill_release(
        self,
        *,
        release_channel: str,
        electron_version: str | None,
        current_skill_pack_version: str | None,
        current_skill_pack_checksum: str | None,
    ) -> SkillReleaseCheckView:
        channel = (release_channel or "").strip().lower() or "stable"
        latest = self.releases.get_latest_published(channel)
        if latest is None:
            return SkillReleaseCheckView(status="up_to_date")

        required_electron_version = self._clean_optional_string(latest.min_electron_version)
        if required_electron_version and self.compare_versions(
            electron_version,
            required_electron_version,
        ) < 0:
            return SkillReleaseCheckView(
                status="unsupported_client",
                latest_skill_pack_version=latest.skill_pack_version,
                latest_skill_pack_checksum=latest.skill_pack_checksum,
                skill_count=latest.skill_count or 0,
                release_notes=latest.release_notes,
                required_electron_version=required_electron_version,
            )

        status = (
            "up_to_date"
            if self._is_current_up_to_date(
                latest,
                current_skill_pack_version=current_skill_pack_version,
                current_skill_pack_checksum=current_skill_pack_checksum,
            )
            else "update_available"
        )
        return SkillReleaseCheckView(
            status=status,
            latest_skill_pack_version=latest.skill_pack_version,
            latest_skill_pack_checksum=latest.skill_pack_checksum,
            skill_count=latest.skill_count or 0,
            release_notes=latest.release_notes,
            required_electron_version=required_electron_version,
        )

    def get_skill_pack(
        self,
        *,
        release_channel: str,
        skill_pack_version: str | None,
    ) -> SkillPackView:
        channel = (release_channel or "").strip().lower() or "stable"
        requested_version = self._clean_optional_string(skill_pack_version)
        release = (
            self.releases.get_published_by_version(
                release_channel=channel,
                skill_pack_version=requested_version,
            )
            if requested_version
            else self.releases.get_latest_published(channel)
        )
        if release is None:
            raise AppError(404, "未找到已发布的 skill 包。", error_code="skill_pack_release_not_found")

        storage_key = self._clean_optional_string(release.pack_storage_key)
        if not storage_key:
            raise AppError(404, "该 skill 版本没有可下载包。", error_code="skill_pack_storage_missing")

        raw = SkillPackStorage().get_bytes(storage_key)
        try:
            payload = self._load_pack_payload(raw)
        except ValueError as exc:
            raise AppError(500, "skill 包内容格式错误。", error_code="skill_pack_invalid_payload") from exc

        if payload.get("skill_pack_checksum") != release.skill_pack_checksum:
            raise AppError(500, "skill 包 checksum 与发布记录不一致。", error_code="skill_pack_checksum_mismatch")

        return SkillPackView.model_validate(payload)

    def _is_current_up_to_date(
        self,
        latest: SkillRelease,
        *,
        current_skill_pack_version: str | None,
        current_skill_pack_checksum: str | None,
    ) -> bool:
        current_version = self._clean_optional_string(current_skill_pack_version)
        current_checksum = self._clean_optional_string(current_skill_pack_checksum)
        latest_checksum = latest.skill_pack_checksum.strip().lower()
        version_match = current_version == latest.skill_pack_version
        checksum_match = bool(current_checksum) and current_checksum.lower() == latest_checksum
        if version_match and (not current_checksum or checksum_match):
            return True
        return bool(checksum_match and not current_version)

    @staticmethod
    def _clean_optional_string(value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned if cleaned else None

    @staticmethod
    def _parse_version(value: str | None) -> tuple[int, ...] | None:
        cleaned = (value or "").strip()
        if not cleaned:
            return None
        parts = re.findall(r"\d+", cleaned)
        if not parts:
            return None
        return tuple(int(item) for item in parts)

    @classmethod
    def compare_versions(cls, left: str | None, right: str | None) -> int:
        left_parts = cls._parse_version(left)
        right_parts = cls._parse_version(right)
        if left_parts is None and right_parts is None:
            return 0
        if left_parts is None:
            return -1
        if right_parts is None:
            return 1
        max_len = max(len(left_parts), len(right_parts))
        padded_left = left_parts + (0,) * (max_len - len(left_parts))
        padded_right = right_parts + (0,) * (max_len - len(right_parts))
        return (padded_left > padded_right) - (padded_left < padded_right)

    @staticmethod
    def _load_pack_payload(raw: bytes) -> dict[str, Any]:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise ValueError("invalid json") from exc
        if not isinstance(payload, dict):
            raise ValueError("payload is not object")
        return payload
