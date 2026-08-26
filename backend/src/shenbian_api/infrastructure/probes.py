from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import alibabacloud_oss_v2 as oss
from redis.asyncio import Redis
from sqlalchemy import URL, make_url, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from shenbian_api.application.ports import DependencyProbe
from shenbian_api.core.config import Settings


def _as_async_postgres_url(raw_url: str) -> URL:
    url = make_url(raw_url)
    if url.drivername in {"postgres", "postgresql"}:
        return url.set(drivername="postgresql+asyncpg")
    if url.drivername != "postgresql+asyncpg":
        raise ValueError("database_url_requires_postgresql")
    return url


class PostgresProbe(DependencyProbe):
    name = "postgresql"

    def __init__(self, settings: Settings) -> None:
        url = _as_async_postgres_url(settings.database_url.get_secret_value())
        self._engine: AsyncEngine = create_async_engine(
            url,
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=0,
            connect_args={"timeout": 3, "command_timeout": 3},
        )

    async def check(self) -> None:
        async with self._engine.connect() as connection:
            await connection.execute(text("SELECT 1"))

    async def close(self) -> None:
        await self._engine.dispose()


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
    return [PostgresProbe(settings), RedisProbe(settings), OssProbe(settings)]
