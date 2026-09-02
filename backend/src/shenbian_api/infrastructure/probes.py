from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import alibabacloud_oss_v2 as oss
from redis.asyncio import Redis

from shenbian_api.application.ports import DependencyProbe
from shenbian_api.core.config import Settings
from shenbian_api.infrastructure.sqlite_paths import resolve_sqlite_path


class SqliteProbe(DependencyProbe):
    name = "sqlite"

    def __init__(self, path: Path) -> None:
        self._path = path

    def _check(self) -> None:
        connection = sqlite3.connect(f"file:{self._path.as_posix()}?mode=ro", uri=True)
        try:
            connection.execute("SELECT 1").fetchone()
        finally:
            connection.close()

    async def check(self) -> None:
        await asyncio.to_thread(self._check)

    async def close(self) -> None:
        return None


class RedisProbe(DependencyProbe):
    name = "redis"

    def __init__(self, settings: Settings) -> None:
        self._client = Redis.from_url(
            settings.redis_url.get_secret_value(),
            socket_connect_timeout=3,
            socket_timeout=3,
            decode_responses=True,
        )

    async def check(self) -> None:
        if not await self._client.ping():
            raise RuntimeError("redis_ping_failed")

    async def close(self) -> None:
        await self._client.aclose()


class OssProbe(DependencyProbe):
    name = "oss"

    def __init__(self, settings: Settings) -> None:
        provider = _build_oss_credentials_provider(
            settings.alibaba_cloud_access_key_id.get_secret_value(),
            settings.alibaba_cloud_access_key_secret.get_secret_value(),
        )
        config = oss.config.load_default()
        config.credentials_provider = provider
        config.region = settings.oss_region
        self._client = oss.Client(config)
        self._bucket = settings.oss_bucket

    async def check(self) -> None:
        await asyncio.to_thread(
            self._client.get_bucket_info,
            oss.GetBucketInfoRequest(bucket=self._bucket),
        )

    async def close(self) -> None:
        return None


def _build_oss_credentials_provider(access_key_id: str, access_key_secret: str) -> Any:
    candidates: tuple[tuple[str, str], ...] = (
        ("StaticCredentialsProvider", "credentials"),
        ("CredentialsProvider", "credentials"),
    )
    for class_name, module_name in candidates:
        module = getattr(oss, module_name, None)
        provider_factory: Callable[..., Any] | None = getattr(module, class_name, None)
        if provider_factory is not None:
            return provider_factory(access_key_id, access_key_secret)
    raise RuntimeError("oss_static_credentials_provider_unavailable")


def build_dependency_probes(settings: Settings) -> list[DependencyProbe]:
    return [
        SqliteProbe(resolve_sqlite_path(settings.topology_semantics_sqlite)),
        RedisProbe(settings),
        OssProbe(settings),
    ]
