from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.core.errors import AppError
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials


class PromptTemplateStorage:
    """Stores private user template snapshots in OSS, with a local dev fallback."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.storage_root = Path(settings.storage_root).resolve()

    def put_json(self, key: str, payload: dict[str, Any]) -> None:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if has_oss_credentials(self.settings):
            try:
                get_oss_bucket(self.settings).put_object(
                    key,
                    body,
                    headers={
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store",
                        "x-oss-object-acl": "private",
                    },
                )
                return
            except AppError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise AppError(
                    502,
                    "提示词模板同步到 OSS 失败。",
                    error_code="prompt_template_oss_write_failed",
                ) from exc

        target = self._resolve_local_key(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_bytes(body)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def delete(self, key: str) -> None:
        if has_oss_credentials(self.settings):
            try:
                get_oss_bucket(self.settings).delete_object(key)
                return
            except AppError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise AppError(
                    502,
                    "提示词模板从 OSS 删除失败。",
                    error_code="prompt_template_oss_delete_failed",
                ) from exc

        self._resolve_local_key(key).unlink(missing_ok=True)

    def _resolve_local_key(self, key: str) -> Path:
        cleaned = key.strip().replace("\\", "/").lstrip("/")
        if not cleaned or ".." in cleaned.split("/"):
            raise AppError(
                400,
                "提示词模板存储路径无效。",
                error_code="prompt_template_invalid_storage_key",
            )
        target = (self.storage_root / cleaned).resolve()
        if target != self.storage_root and self.storage_root not in target.parents:
            raise AppError(
                400,
                "提示词模板存储路径无效。",
                error_code="prompt_template_invalid_storage_path",
            )
        return target
