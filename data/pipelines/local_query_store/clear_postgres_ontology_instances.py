from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import create_async_engine

from shenbian_api.infrastructure.database import as_async_postgres_url

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA = "ontology"
TARGET_DATASET_IDS = (
    "shenbian.client_requirements.curated.v1",
    "cad.capabilities.curated.v1",
    "cad.capabilities.curated.v2",
)
TOPOLOGY_TABLES = (
    "topology_patterns",
    "topology_observations",
    "semantic_descriptions",
    "topology_semantic_links",
)


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL")


async def _table_count(connection: sa.ext.asyncio.AsyncConnection, table: str) -> int:
    return int(
        await connection.scalar(sa.text(f"SELECT count(*) FROM {SCHEMA}.{table}")) or 0
    )


async def _dataset_ids(connection: sa.ext.asyncio.AsyncConnection) -> list[str]:
    exists = await connection.scalar(
        sa.text("SELECT to_regclass(:name)"),
        {"name": f"{SCHEMA}.dataset_builds"},
    )
    if exists is None:
        return []
    rows = (
        await connection.execute(
            sa.text(f"SELECT dataset_id FROM {SCHEMA}.dataset_builds ORDER BY dataset_id")
        )
    ).all()
    return [str(row[0]) for row in rows]


async def _drop_import_tables(connection: sa.ext.asyncio.AsyncConnection) -> list[str]:
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = :schema
                  AND tablename LIKE 'cad_capability_atoms_import_%'
                ORDER BY tablename
                """
            ),
            {"schema": SCHEMA},
        )
    ).all()
    dropped = [str(row[0]) for row in rows]
    for name in dropped:
        await connection.execute(sa.text(f'DROP TABLE IF EXISTS {SCHEMA}."{name}"'))
    return dropped


async def clear_instances() -> dict[str, Any]:
    settings = DatabaseSettings()
    engine = create_async_engine(
        as_async_postgres_url(settings.database_url.get_secret_value()),
        pool_pre_ping=True,
        connect_args={"timeout": 30, "command_timeout": 1800},
    )
    try:
        async with engine.begin() as connection:
            before_datasets = await _dataset_ids(connection)
            before_topology = {
                table: await _table_count(connection, table) for table in TOPOLOGY_TABLES
            }
            for table in (
                "capability_graph_snapshots",
                "capability_atoms",
                "capability_inventories",
            ):
                exists = await connection.scalar(
                    sa.text("SELECT to_regclass(:name)"),
                    {"name": f"{SCHEMA}.{table}"},
                )
                if exists is None:
                    continue
                await connection.execute(
                    sa.text(
                        f"DELETE FROM {SCHEMA}.{table} WHERE dataset_id IN :dataset_ids"
                    ).bindparams(sa.bindparam("dataset_ids", expanding=True)),
                    {"dataset_ids": list(TARGET_DATASET_IDS)},
                )
            delete_result = await connection.execute(
                sa.text(
                    f"DELETE FROM {SCHEMA}.dataset_builds WHERE dataset_id IN :dataset_ids"
                ).bindparams(sa.bindparam("dataset_ids", expanding=True)),
                {"dataset_ids": list(TARGET_DATASET_IDS)},
            )
            dropped_import_tables = await _drop_import_tables(connection)
            after_datasets = await _dataset_ids(connection)
            after_topology = {
                table: await _table_count(connection, table) for table in TOPOLOGY_TABLES
            }
            remaining_targets = [item for item in TARGET_DATASET_IDS if item in after_datasets]
            if remaining_targets:
                raise RuntimeError(f"target datasets still present: {remaining_targets}")
            if before_topology != after_topology:
                raise RuntimeError(
                    "topology table counts changed: "
                    f"before={before_topology} after={after_topology}"
                )
    finally:
        await engine.dispose()

    return {
        "status": "cleared",
        "deleted_dataset_ids": [item for item in TARGET_DATASET_IDS if item in before_datasets],
        "deleted_rowcount": int(delete_result.rowcount or 0),
        "remaining_dataset_ids": after_datasets,
        "dropped_import_tables": dropped_import_tables,
        "topology_counts": after_topology,
    }


async def inspect_ontology() -> dict[str, Any]:
    settings = DatabaseSettings()
    engine = create_async_engine(
        as_async_postgres_url(settings.database_url.get_secret_value()),
        connect_args={"timeout": 10, "command_timeout": 30},
    )
    try:
        async with engine.connect() as connection:
            tables = (
                await connection.execute(
                    sa.text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = :schema ORDER BY tablename"
                    ),
                    {"schema": SCHEMA},
                )
            ).all()
            topology = {table: await _table_count(connection, table) for table in TOPOLOGY_TABLES}
            datasets = await _dataset_ids(connection)
    finally:
        await engine.dispose()
    return {
        "status": "inspected",
        "tables": [str(row[0]) for row in tables],
        "remaining_dataset_ids": datasets,
        "topology_counts": topology,
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--inspect",
        action="store_true",
        help="List remaining ontology tables and topology counts without deleting.",
    )
    args = parser.parse_args()
    result = asyncio.run(inspect_ontology() if args.inspect else clear_instances())
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
