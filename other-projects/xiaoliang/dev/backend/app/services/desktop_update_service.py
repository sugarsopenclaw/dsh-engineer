from __future__ import annotations

import hashlib
import json
import logging

from packaging.version import InvalidVersion, Version
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.models.client_release import (
    ClientReleaseArtifactView,
    ClientReleaseView,
)
from app.models.desktop_update import (
    DesktopReleaseIn,
    DesktopReleaseOut,
    DesktopReleasePatchIn,
    DesktopUpdatePolicyCheckIn,
    DesktopUpdatePolicyCheckOut,
    DesktopUpdatePolicyIn,
    DesktopUpdatePolicyOut,
    ensure_safe_file_name,
)
from app.schemas.base import utcnow
from app.schemas.desktop_release import (
    DesktopRelease,
    DesktopReleaseArtifact,
    DesktopUpdateEvent,
    DesktopUpdatePolicy,
)
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials

logger = logging.getLogger(__name__)

PUBLISHED_STATUS = "published"
PAUSED_STATUS = "paused"
YANKED_STATUS = "yanked"
DOWNLOAD_SOURCE_MAX_LENGTH = 120


def json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]


def parse_version(value: str) -> Version | None:
    try:
        return Version(value)
    except InvalidVersion:
        return None


def feed_name_for_channel(channel: str) -> str:
    return "latest.yml" if channel == "stable" else f"{channel}.yml"


def request_ip_hash(request_headers: dict[str, str], client_host: str | None) -> str | None:
    forwarded = request_headers.get("x-forwarded-for", "")
    candidate = forwarded.split(",", 1)[0].strip() or (client_host or "").strip()
    if not candidate:
        return None
    return hashlib.sha256(candidate.encode("utf-8")).hexdigest()


def release_sort_key(release: DesktopRelease) -> tuple:
    parsed = parse_version(release.version) or release.version
    timestamp = release.release_date or release.created_at
    return parsed, timestamp, release.id


def artifact_sort_key(artifact: DesktopReleaseArtifact) -> tuple[int, int]:
    priority = 0 if artifact.kind == "installer" else 1
    return priority, artifact.id


def format_file_size(size_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(size_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{size_bytes} B"


class DesktopUpdateService:
    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()

    def artifact_download_url(self, artifact: DesktopReleaseArtifact, *, http_method: str) -> str:
        has_private_oss_source = bool(
            artifact.object_key
            and not (self.settings.oss_public_base_url or "").strip()
            and has_oss_credentials(self.settings)
        )
        if not has_private_oss_source:
            return artifact.public_url

        method = "HEAD" if http_method.upper() == "HEAD" else "GET"
        try:
            return get_oss_bucket(self.settings).sign_url(
                method,
                artifact.object_key,
                self.settings.oss_release_signed_url_expires_seconds,
                slash_safe=True,
            )
        except AppError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AppError(
                502,
                "无法生成桌面安装包下载地址。",
                error_code="desktop_release_url_failed",
            ) from exc

    def latest_feed(self, *, platform: str, arch: str, channel: str) -> str:
        release = self.latest_published_release(platform=platform, arch=arch, channel=channel)
        if release is None:
            raise AppError(404, "未找到桌面发布版本。", error_code="desktop_release_not_found")
        installer = self.find_installer_artifact(release)
        release_date = (release.release_date or release.created_at).isoformat()
        lines = [
            f"version: '{release.version}'",
            "files:",
            f"  - url: '{installer.file_name}'",
            f"    sha512: '{installer.sha512 or ''}'",
            f"    size: {installer.size_bytes}",
            f"path: '{installer.file_name}'",
            f"url: '{installer.file_name}'",
            f"sha512: '{installer.sha512 or ''}'",
            f"releaseDate: '{release_date}'",
        ]
        if release.staging_percentage is not None:
            lines.append(f"stagingPercentage: {release.staging_percentage}")
        return "\n".join(lines) + "\n"

    def redirect_desktop_artifact(
        self,
        *,
        platform: str,
        arch: str,
        file_name: str,
        source: str | None,
        request_headers: dict[str, str],
        client_host: str | None,
        record_event: bool,
        http_method: str,
    ) -> str:
        try:
            safe_file_name = ensure_safe_file_name(file_name)
        except ValueError as exc:
            raise AppError(400, "安装包文件名不合法。", error_code="desktop_release_file_invalid") from exc

        artifact, release = self.find_published_artifact(
            platform=platform,
            arch=arch,
            file_name=safe_file_name,
        )
        if artifact is None or release is None:
            raise AppError(404, "未找到对应安装包。", error_code="desktop_release_artifact_not_found")

        if record_event:
            self.session.add(
                DesktopUpdateEvent(
                    event_type="download",
                    platform=platform,
                    arch=arch,
                    channel=release.channel,
                    target_version=release.version,
                    file_name=artifact.file_name,
                    release_id=release.id,
                    artifact_id=artifact.id,
                    source=self.normalize_source(source),
                    ip_hash=request_ip_hash(request_headers, client_host),
                    user_agent=(request_headers.get("user-agent") or "")[:500] or None,
                    referer=request_headers.get("referer"),
                )
            )
            self.session.commit()

        return self.artifact_download_url(artifact, http_method=http_method)

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
        platform, arch = self.parse_platform_key(platform_key)
        release = self.latest_published_release(platform=platform, arch=arch, channel="stable")
        if release is None:
            raise AppError(404, "未找到桌面发布版本。", error_code="desktop_release_not_found")
        installer = self.find_installer_artifact(release)

        if record_event:
            from app.repositories.client_download_event_repository import ClientDownloadEventRepository

            try:
                ClientDownloadEventRepository(self.session).create(
                    version=release.version,
                    release_channel=release.channel,
                    platform=platform_key,
                    source=self.normalize_source(source),
                    ip_address=self._extract_client_ip(request_headers, client_host),
                    user_agent=(request_headers.get("user-agent") or "")[:500] or None,
                    referer=request_headers.get("referer"),
                    redirect_url=installer.public_url,
                )
                self.session.commit()
            except Exception as exc:  # noqa: BLE001
                self.session.rollback()
                logger.warning("记录客户端下载事件失败: %s", exc)

        return self.artifact_download_url(installer, http_method=http_method)

    def get_client_release_view(self) -> ClientReleaseView:
        release = self.latest_published_release(platform="windows", arch="x64", channel="stable")
        if release is None:
            raise AppError(503, "客户端发布配置不存在。", error_code="client_release_manifest_missing")
        installer = self.find_installer_artifact(release)
        notes = json_list(release.notes_json)
        published_at = (release.release_date or release.created_at).isoformat()
        return ClientReleaseView(
            product_name="晓量",
            tagline="AI 工程造价算量桌面端",
            summary="面向工程造价场景的桌面工作台，结合本地 CAD 流程、知识问答与结构化算量能力。",
            release_channel=release.channel,
            version=release.version,
            published_at=published_at,
            release_notes_title=f"{release.version} 最新版本",
            release_notes=notes,
            highlights=notes[:3],
            installation_steps=[
                "点击下方 Windows 安装包按钮开始下载。",
                "下载完成后运行安装程序，并按提示完成安装。",
                "如果应用内自动更新失败，可重新打开本页面手动下载安装最新版。",
            ],
            support_text="下载页经后端统计后跳转到 OSS 安装包地址。",
            github_release_url=None,
            artifacts=[
                ClientReleaseArtifactView(
                    platform="windows-x64",
                    label="Windows 64 位安装包",
                    file_name=installer.file_name,
                    download_url="/client-releases/download/windows-x64",
                    backup_url=None,
                    file_size=format_file_size(installer.size_bytes),
                    checksum_sha512=installer.sha512,
                    notes=[],
                )
            ],
        )

    def create_desktop_release(self, payload: DesktopReleaseIn) -> DesktopReleaseOut:
        if not any(artifact.kind == "installer" for artifact in payload.artifacts):
            raise AppError(422, "必须提供 installer 产物。", error_code="desktop_release_installer_required")

        release = DesktopRelease(
            platform=payload.platform,
            arch=payload.arch,
            channel=payload.channel,
            version=payload.version,
            status=payload.status,
            staging_percentage=payload.staging_percentage,
            notes_json=json.dumps(payload.notes, ensure_ascii=False),
            release_date=payload.release_date,
        )
        release.artifacts = [
            DesktopReleaseArtifact(
                kind=artifact.kind,
                file_name=artifact.file_name,
                size_bytes=artifact.size_bytes,
                sha512=artifact.sha512,
                sha256=artifact.sha256,
                object_key=artifact.object_key,
                public_url=str(artifact.public_url),
                content_type=artifact.content_type,
            )
            for artifact in payload.artifacts
        ]
        self.session.add(release)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise AppError(409, "该版本发布记录已存在。", error_code="desktop_release_conflict") from exc
        self.session.refresh(release)
        return self.desktop_release_out(release)

    def update_desktop_release(self, release_id: int, payload: DesktopReleasePatchIn) -> DesktopReleaseOut:
        release = self.get_desktop_release(release_id)
        fields = getattr(payload, "model_fields_set", set())
        if "status" in fields and payload.status is not None:
            release.status = payload.status
        if "staging_percentage" in fields:
            release.staging_percentage = payload.staging_percentage
        if "notes" in fields and payload.notes is not None:
            release.notes_json = json.dumps(payload.notes, ensure_ascii=False)
        if "release_date" in fields:
            release.release_date = payload.release_date
        release.updated_at = utcnow()
        self.session.commit()
        self.session.refresh(release)
        return self.desktop_release_out(release)

    def set_release_status(self, release_id: int, status: str) -> DesktopReleaseOut:
        release = self.get_desktop_release(release_id)
        release.status = status
        release.updated_at = utcnow()
        self.session.commit()
        self.session.refresh(release)
        return self.desktop_release_out(release)

    def upsert_policy(
        self,
        *,
        platform: str,
        arch: str,
        channel: str,
        payload: DesktopUpdatePolicyIn,
    ) -> DesktopUpdatePolicyOut:
        policy = self.session.execute(
            select(DesktopUpdatePolicy).where(
                DesktopUpdatePolicy.platform == platform,
                DesktopUpdatePolicy.arch == arch,
                DesktopUpdatePolicy.channel == channel,
            )
        ).scalar_one_or_none()
        now = utcnow()
        if policy is None:
            policy = DesktopUpdatePolicy(
                platform=platform,
                arch=arch,
                channel=channel,
                minimum_supported_version=payload.minimum_supported_version,
                force_update_message=payload.force_update_message,
                enabled=payload.enabled,
                created_at=now,
                updated_at=now,
            )
            self.session.add(policy)
        else:
            policy.minimum_supported_version = payload.minimum_supported_version
            policy.force_update_message = payload.force_update_message
            policy.enabled = payload.enabled
            policy.updated_at = now
        self.session.commit()
        self.session.refresh(policy)
        return self.policy_out(policy)

    def evaluate_policy(self, payload: DesktopUpdatePolicyCheckIn) -> DesktopUpdatePolicyCheckOut:
        release = self.latest_published_release(
            platform=payload.platform,
            arch=payload.arch,
            channel=payload.channel,
        )
        policy = self.session.execute(
            select(DesktopUpdatePolicy).where(
                DesktopUpdatePolicy.platform == payload.platform,
                DesktopUpdatePolicy.arch == payload.arch,
                DesktopUpdatePolicy.channel == payload.channel,
            )
        ).scalar_one_or_none()

        latest_version = release.version if release is not None else None
        latest_parsed = parse_version(latest_version) if latest_version else None
        current_parsed = parse_version(payload.current_version)
        update_available = bool(latest_parsed and current_parsed and current_parsed < latest_parsed)
        if latest_parsed and current_parsed is None:
            update_available = True

        minimum_supported_version = None
        force_update_message = None
        is_supported = True
        force_update = False
        if policy is not None and policy.enabled and policy.minimum_supported_version:
            minimum_supported_version = policy.minimum_supported_version
            force_update_message = policy.force_update_message
            minimum_parsed = parse_version(policy.minimum_supported_version)
            if minimum_parsed is not None:
                if current_parsed is None or current_parsed < minimum_parsed:
                    is_supported = False
                    force_update = True

        self.session.add(
            DesktopUpdateEvent(
                event_type="policy_check",
                platform=payload.platform,
                arch=payload.arch,
                channel=payload.channel,
                current_version=payload.current_version,
                target_version=latest_version,
            )
        )
        self.session.commit()

        return DesktopUpdatePolicyCheckOut(
            latest_version=latest_version,
            update_available=update_available,
            force_update=force_update,
            is_supported=is_supported,
            feed_url=self.feed_url(payload.platform, payload.arch, payload.channel) if release is not None else None,
            notes=json_list(release.notes_json) if release is not None else [],
            minimum_supported_version=minimum_supported_version,
            force_update_message=force_update_message,
        )

    def latest_published_release(
        self,
        *,
        platform: str,
        arch: str,
        channel: str,
    ) -> DesktopRelease | None:
        releases = (
            self.session.execute(
                select(DesktopRelease)
                .options(selectinload(DesktopRelease.artifacts))
                .where(
                    DesktopRelease.platform == platform,
                    DesktopRelease.arch == arch,
                    DesktopRelease.channel == channel,
                    DesktopRelease.status == PUBLISHED_STATUS,
                )
            )
            .scalars()
            .all()
        )
        if not releases:
            return None
        releases.sort(key=release_sort_key, reverse=True)
        return releases[0]

    def find_published_artifact(
        self,
        *,
        platform: str,
        arch: str,
        file_name: str,
    ) -> tuple[DesktopReleaseArtifact | None, DesktopRelease | None]:
        releases = (
            self.session.execute(
                select(DesktopRelease)
                .options(selectinload(DesktopRelease.artifacts))
                .where(
                    DesktopRelease.platform == platform,
                    DesktopRelease.arch == arch,
                    DesktopRelease.status == PUBLISHED_STATUS,
                )
            )
            .scalars()
            .all()
        )
        releases.sort(key=release_sort_key, reverse=True)
        for release in releases:
            for artifact in sorted(release.artifacts, key=artifact_sort_key):
                if artifact.file_name == file_name:
                    return artifact, release
        return None, None

    def get_desktop_release(self, release_id: int) -> DesktopRelease:
        release = self.session.execute(
            select(DesktopRelease)
            .options(selectinload(DesktopRelease.artifacts))
            .where(DesktopRelease.id == release_id)
        ).scalar_one_or_none()
        if release is None:
            raise AppError(404, "未找到桌面发布版本。", error_code="desktop_release_not_found")
        return release

    def desktop_release_out(self, release: DesktopRelease) -> DesktopReleaseOut:
        return DesktopReleaseOut(
            id=release.id,
            platform=release.platform,
            arch=release.arch,
            channel=release.channel,
            version=release.version,
            status=release.status,
            staging_percentage=release.staging_percentage,
            notes=json_list(release.notes_json),
            release_date=release.release_date,
            created_at=release.created_at,
            updated_at=release.updated_at,
            artifacts=[
                {
                    "id": artifact.id,
                    "kind": artifact.kind,
                    "file_name": artifact.file_name,
                    "size_bytes": artifact.size_bytes,
                    "sha512": artifact.sha512,
                    "sha256": artifact.sha256,
                    "object_key": artifact.object_key,
                    "public_url": artifact.public_url,
                    "content_type": artifact.content_type,
                }
                for artifact in sorted(release.artifacts, key=artifact_sort_key)
            ],
        )

    def policy_out(self, policy: DesktopUpdatePolicy) -> DesktopUpdatePolicyOut:
        return DesktopUpdatePolicyOut(
            id=policy.id,
            platform=policy.platform,
            arch=policy.arch,
            channel=policy.channel,
            minimum_supported_version=policy.minimum_supported_version,
            force_update_message=policy.force_update_message,
            enabled=policy.enabled,
            created_at=policy.created_at,
            updated_at=policy.updated_at,
        )

    def find_installer_artifact(self, release: DesktopRelease) -> DesktopReleaseArtifact:
        for artifact in sorted(release.artifacts, key=artifact_sort_key):
            if artifact.kind == "installer":
                return artifact
        raise AppError(500, "发布记录缺少 installer 产物。", error_code="desktop_release_installer_not_found")

    def feed_url(self, platform: str, arch: str, channel: str) -> str:
        base = self.settings.desktop_update_base_url.rstrip("/")
        return f"{base}/{platform}/{arch}/{feed_name_for_channel(channel)}"

    def normalize_source(self, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            return None
        return text[:DOWNLOAD_SOURCE_MAX_LENGTH]

    @staticmethod
    def parse_platform_key(platform_key: str) -> tuple[str, str]:
        normalized = platform_key.strip().lower()
        if normalized in {"windows-x64", "windows_x64", "win-x64", "windows"}:
            return "windows", "x64"
        raise AppError(404, "未找到对应平台的安装包。", error_code="client_release_asset_not_found")

    @staticmethod
    def _extract_client_ip(request_headers: dict[str, str], client_host: str | None) -> str | None:
        forwarded = (request_headers.get("x-forwarded-for") or "").strip()
        if forwarded:
            return forwarded.split(",", 1)[0].strip() or None
        real_ip = (request_headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip
        return (client_host or "").strip() or None
