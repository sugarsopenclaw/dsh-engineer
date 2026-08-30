from __future__ import annotations

from sqlalchemy import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def as_async_postgres_url(raw_url: str) -> URL:
    url = make_url(raw_url)
    if url.drivername in {"postgres", "postgresql"}:
        return url.set(drivername="postgresql+asyncpg")
    if url.drivername != "postgresql+asyncpg":
        raise ValueError("database_url_requires_postgresql")
    return url


def create_postgres_engine(
    raw_url: str,
    *,
    pool_size: int = 5,
    max_overflow: int = 5,
    connect_timeout_seconds: int = 20,
    command_timeout_seconds: int = 30,
) -> AsyncEngine:
    return create_async_engine(
        as_async_postgres_url(raw_url),
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_recycle=1800,
        connect_args={
            "timeout": connect_timeout_seconds,
            "command_timeout": command_timeout_seconds,
        },
    )
