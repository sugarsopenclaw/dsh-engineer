from __future__ import annotations

from collections.abc import Mapping

from psycopg import connect, sql
from psycopg.conninfo import make_conninfo
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

import app.schemas  # noqa: F401
from app.core.config import get_settings
from app.core.database import Base


def _string_query_values(query: Mapping[str, object]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in query.items():
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            if not value:
                continue
            normalized[str(key)] = str(value[-1])
            continue
        normalized[str(key)] = str(value)
    return normalized


def ensure_database() -> tuple[str, list[str]]:
    settings = get_settings()
    url = make_url(settings.database_url)
    if not url.drivername.startswith("postgresql"):
        raise RuntimeError("当前 DATABASE_URL 不是 PostgreSQL，无法执行 PostgreSQL 初始化脚本。")

    target_database = url.database
    if not target_database:
        raise RuntimeError("DATABASE_URL 缺少数据库名。")

    admin_conninfo = make_conninfo(
        host=url.host,
        port=url.port,
        user=url.username,
        password=url.password,
        dbname="postgres",
        **_string_query_values(url.query),
    )

    with connect(admin_conninfo, autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (target_database,),
        ).fetchone()
        if exists is None:
            connection.execute(sql.SQL("CREATE DATABASE {}") .format(sql.Identifier(target_database)))

    engine = create_engine(settings.database_url, future=True, pool_pre_ping=True)
    Base.metadata.create_all(bind=engine)

    with engine.connect() as connection:
        table_names = list(
            connection.execute(
                text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
                )
            ).scalars()
        )

    return target_database, table_names


if __name__ == "__main__":
    database_name, tables = ensure_database()
    print(f"initialized_database={database_name}")
    print(f"table_count={len(tables)}")
    for table_name in tables:
        print(table_name)