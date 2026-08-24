from __future__ import annotations

from pathlib import Path

from app.core.config import get_settings
from app.core.errors import AppError


class SkillPackStorage:
    def __init__(self) -> None:
        settings = get_settings()
        self.storage_root = Path(settings.storage_root).resolve()
        self.access_key_id = (settings.alibaba_cloud_access_key_id or "").strip()
        self.access_key_secret = (settings.alibaba_cloud_access_key_secret or "").strip()
        self.bucket_name = (settings.oss_bucket or "").strip()
        self.region = (settings.oss_region or "").strip()
        self._bucket = None

    def put_bytes(self, key: str, body: bytes, *, content_type: str) -> None:
        if self._has_oss_config():
            bucket = self._get_oss_bucket()
            try:
                bucket.put_object(key, body, headers={"Content-Type": content_type})
                return
            except Exception as exc:  # noqa: BLE001
                raise AppError(
                    502,
                    f"上传 skill 包到 OSS 失败: {exc}",
                    error_code="skill_pack_oss_upload_failed",
                ) from exc

        target = self._resolve_local_key(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)

    def get_bytes(self, key: str) -> bytes:
        if self._has_oss_config():
            bucket = self._get_oss_bucket()
            try:
                return bucket.get_object(key).read()
            except Exception as exc:  # noqa: BLE001
                raise AppError(
                    502,
                    f"读取 skill 包 OSS 对象失败: {exc}",
                    error_code="skill_pack_oss_read_failed",
                ) from exc

        target = self._resolve_local_key(key)
        if not target.exists():
            raise AppError(404, "skill 包文件不存在。", error_code="skill_pack_object_not_found")
        return target.read_bytes()

    def _has_oss_config(self) -> bool:
        return bool(
            self.access_key_id
            and self.access_key_secret
            and self.bucket_name
            and self.region
        )

    def _get_oss_bucket(self):
        if self._bucket is not None:
            return self._bucket
        try:
            import oss2
        except ImportError as exc:
            raise AppError(
                500,
                "未安装 oss2 SDK，请执行: pip install oss2",
                error_code="skill_pack_oss2_missing",
            ) from exc

        endpoint = f"https://oss-{self.region}.aliyuncs.com"
        auth = oss2.Auth(self.access_key_id, self.access_key_secret)
        self._bucket = oss2.Bucket(auth, endpoint, self.bucket_name)
        return self._bucket

    def _resolve_local_key(self, key: str) -> Path:
        cleaned = key.strip().replace("\\", "/").lstrip("/")
        if not cleaned or ".." in cleaned.split("/"):
            raise AppError(400, "非法 skill 包存储 key。", error_code="skill_pack_invalid_storage_key")
        target = (self.storage_root / cleaned).resolve()
        root = self.storage_root.resolve()
        if target != root and root not in target.parents:
            raise AppError(400, "非法 skill 包存储路径。", error_code="skill_pack_invalid_storage_path")
        return target
