"""Read-only OSS helpers. Stream to disk; retry transient failures."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any

from flywheel.prod import bootstrap_admin

_RETRY_STATUSES = {429, 500, 502, 503, 504}


class OssError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _bucket():
    bootstrap_admin()
    import oss2  # noqa: WPS433
    from app.config import get_settings  # noqa: WPS433

    settings = get_settings()
    if not settings.oss_configured:
        raise OssError("OSS 未配置：请在 dev/admin/.env 填写凭证")
    region = settings.oss_region.strip() or "cn-beijing"
    auth = oss2.Auth(
        settings.alibaba_cloud_access_key_id.strip(),
        settings.alibaba_cloud_access_key_secret.strip(),
    )
    return oss2.Bucket(auth, f"https://oss-{region}.aliyuncs.com", settings.oss_bucket.strip())


def head_object(storage_key: str) -> dict[str, Any]:
    head = _bucket().head_object(storage_key)
    headers = dict(getattr(head, "headers", {}) or {})
    headers["Content-Length"] = str(getattr(head, "content_length", headers.get("Content-Length") or 0))
    return headers


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_object_to_path(storage_key: str, dest: Path, *, retries: int = 3) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            _bucket().get_object_to_file(storage_key, str(tmp))
            size = tmp.stat().st_size
            tmp.replace(dest)
            return size
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            status = getattr(exc, "status", None)
            if status not in _RETRY_STATUSES and attempt == 0 and status not in {None, 0}:
                # 404 / 403 are not worth retrying many times, but try once more for flaky network.
                if status in {404, 403}:
                    raise OssError(f"OSS GET failed for object ({status})", status=status) from exc
            time.sleep(1.5 * (attempt + 1))
    raise OssError(f"OSS GET failed after {retries} attempts: {last_error}") from last_error
