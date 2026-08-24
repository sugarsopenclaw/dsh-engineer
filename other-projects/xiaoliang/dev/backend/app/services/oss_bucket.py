from __future__ import annotations

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.core.errors import AppError


def has_oss_credentials(settings: Settings | None = None) -> bool:
    cfg = settings or get_settings()
    return bool(
        (cfg.alibaba_cloud_access_key_id or "").strip()
        and (cfg.alibaba_cloud_access_key_secret or "").strip()
        and (cfg.oss_bucket or "").strip()
        and (cfg.oss_region or "").strip()
    )


@lru_cache(maxsize=1)
def _cached_bucket(
    access_key_id: str,
    access_key_secret: str,
    bucket_name: str,
    region: str,
):
    try:
        import oss2
    except ImportError as exc:
        raise AppError(
            500,
            "未安装 oss2 SDK，请执行: pip install oss2",
            error_code="oss2_missing",
        ) from exc

    endpoint = f"https://oss-{region}.aliyuncs.com"
    auth = oss2.Auth(access_key_id, access_key_secret)
    return oss2.Bucket(auth, endpoint, bucket_name)


def get_oss_bucket(settings: Settings | None = None):
    cfg = settings or get_settings()
    if not has_oss_credentials(cfg):
        raise AppError(500, "OSS 配置不完整。", error_code="oss_config_missing")
    return _cached_bucket(
        (cfg.alibaba_cloud_access_key_id or "").strip(),
        (cfg.alibaba_cloud_access_key_secret or "").strip(),
        (cfg.oss_bucket or "").strip(),
        (cfg.oss_region or "").strip(),
    )


def clear_oss_bucket_cache() -> None:
    _cached_bucket.cache_clear()
