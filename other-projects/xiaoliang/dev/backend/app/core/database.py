from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _normalize_sqlite_url(raw_url: str) -> str:
    if raw_url.startswith("sqlite:///"):
        path_text = raw_url.removeprefix("sqlite:///")
        path = Path(path_text)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[2] / path
        path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{path.as_posix()}"
    return raw_url


def _build_engine() -> Engine:
    settings = get_settings()
    database_url = _normalize_sqlite_url(settings.database_url)
    is_sqlite = database_url.startswith("sqlite")
    engine_options: dict[str, object] = {
        "future": True,
        "pool_pre_ping": True,
        "connect_args": {"check_same_thread": False} if is_sqlite else {},
    }
    if not is_sqlite:
        engine_options.update(
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
            pool_recycle=settings.db_pool_recycle,
        )
    return create_engine(database_url, **engine_options)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return _build_engine()


SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, future=True)


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def get_db_session() -> Generator[Session, None, None]:
    with session_scope() as session:
        yield session


def init_database() -> list[str]:
    import app.schemas  # noqa: F401
    from app.core.schema_migrations import migrate_agent_archive_schema

    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    return migrate_agent_archive_schema(engine)
