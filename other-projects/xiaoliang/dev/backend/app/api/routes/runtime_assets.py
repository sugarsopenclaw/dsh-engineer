from __future__ import annotations

import re

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.errors import AppError
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials

router = APIRouter(prefix="/runtime-assets", tags=["runtime-assets"])

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class RuntimeAssetOut(BaseModel):
    name: str
    version: str
    file_name: str
    size_bytes: int | None
    sha256: str
    download_url: str


@router.get("/git-bash", response_model=RuntimeAssetOut)
def get_git_bash_asset() -> RuntimeAssetOut:
    """桌面端 bash 运行时（MinGit）分发清单。

    匿名接口（与 desktop-updates 下载一致）：资产本身是公开软件的转发，
    signed URL 短期有效。未配置或缺少 OSS 凭证时 404，桌面端回退国内镜像。
    """
    settings = get_settings()
    object_key = settings.runtime_asset_git_bash_object_key.strip()
    sha256 = settings.runtime_asset_git_bash_sha256.strip().lower()
    if not object_key or not _SHA256_PATTERN.match(sha256) or not has_oss_credentials(settings):
        raise AppError(404, "git-bash 运行时资产未配置。", error_code="runtime_asset_not_configured")

    try:
        download_url = get_oss_bucket(settings).sign_url(
            "GET",
            object_key,
            settings.oss_release_signed_url_expires_seconds,
            slash_safe=True,
        )
    except AppError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            502,
            "无法生成运行时资产下载地址。",
            error_code="runtime_asset_url_failed",
        ) from exc

    return RuntimeAssetOut(
        name="git-bash",
        version=settings.runtime_asset_git_bash_version.strip() or "unknown",
        file_name=object_key.rsplit("/", 1)[-1],
        size_bytes=settings.runtime_asset_git_bash_size_bytes or None,
        sha256=sha256,
        download_url=download_url,
    )
