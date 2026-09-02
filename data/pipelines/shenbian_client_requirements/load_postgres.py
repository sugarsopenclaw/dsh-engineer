from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from shenbian_api.infrastructure.database import as_async_postgres_url

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATASET_DIRECTORY = (
    REPO_ROOT / "data" / "datasets" / "curated" / "shenbian-client-requirements" / "v1"
)
SCHEMA = "ontology"


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL")


@dataclass(frozen=True)
class TableSpec:
    filename: str
    table_name: str
    manifest_count_key: str


TABLE_SPECS = (
    TableSpec("source_documents.jsonl", "source_documents", "source_documents"),
    TableSpec("source_evidence.jsonl", "source_evidence", "source_evidence"),
    TableSpec("requirement_nodes.jsonl", "requirement_nodes", "requirement_nodes"),
    TableSpec(
        "requirement_relations.jsonl",
        "requirement_relations",
        "requirement_relations",
    ),
    TableSpec(
        "requirement_source_links.jsonl",
        "requirement_source_links",
        "source_links",
    ),
    TableSpec("requirement_aliases.jsonl", "requirement_aliases", "aliases"),
    TableSpec("dedup_decisions.jsonl", "dedup_decisions", "dedup_decisions"),
    TableSpec(
        "dedup_decision_requirement_links.jsonl",
        "dedup_decision_requirement_links",
        "dedup_decision_requirement_links",
    ),
    TableSpec("scope_dimensions.jsonl", "scope_dimensions", "scope_dimensions"),
    TableSpec("scope_values.jsonl", "scope_values", "scope_values"),
    TableSpec(
        "requirement_scope_links.jsonl",
        "requirement_scope_links",
        "scope_links",
    ),
    TableSpec(
        "acceptance_criteria.jsonl",
        "acceptance_criteria",
        "acceptance_criteria",
    ),
    TableSpec("open_questions.jsonl", "open_questions", "open_questions"),
    TableSpec(
        "open_question_requirement_links.jsonl",
        "open_question_requirement_links",
        "open_question_requirement_links",
    ),
    TableSpec("graph_views.jsonl", "graph_views", "graph_views"),
    TableSpec(
        "graph_view_filters.jsonl",
        "graph_view_filters",
        "graph_view_filters",
    ),
    TableSpec(
        "graph_layout_positions.jsonl",
        "graph_layout_positions",
        "graph_layout_positions",
    ),
)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"expected JSON object: {path}")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise TypeError(f"expected JSON object: {path}:{line_number}")
            rows.append(value)
    return rows


def content_sha256(dataset_directory: Path) -> str:
    digest = hashlib.sha256()
    paths = [dataset_directory / "manifest.json"] + [
        dataset_directory / spec.filename for spec in TABLE_SPECS
    ]
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def load_dataset(
    dataset_directory: Path,
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    manifest = read_json(dataset_directory / "manifest.json")
    if manifest.get("build_status") != "valid":
        raise ValueError("dataset build_status must be valid before database import")
    if not manifest.get("dataset_id") or not manifest.get("schema_version"):
        raise ValueError("manifest requires dataset_id and schema_version")

    manifest_counts = manifest.get("counts")
    if not isinstance(manifest_counts, dict):
        raise TypeError("manifest counts must be an object")

    rows_by_table: dict[str, list[dict[str, Any]]] = {}
    for spec in TABLE_SPECS:
        rows = read_jsonl(dataset_directory / spec.filename)
        expected = manifest_counts.get(spec.manifest_count_key)
        if len(rows) != expected:
            raise ValueError(
                f"{spec.filename} row count {len(rows)} does not match manifest {expected}"
            )
        rows_by_table[spec.table_name] = rows
    return manifest, rows_by_table


async def reflect_tables(connection: AsyncConnection) -> dict[str, sa.Table]:
    required_names = ["dataset_builds", *(spec.table_name for spec in TABLE_SPECS)]
    relation = await connection.scalar(
        sa.text("select to_regclass(:name)"), {"name": f"{SCHEMA}.dataset_builds"}
    )
    if relation is None:
        raise RuntimeError(
            "database schema is missing; run `uv run alembic upgrade head` in backend"
        )

    metadata = sa.MetaData()

    def reflect(sync_connection: sa.Connection) -> None:
        metadata.reflect(
            bind=sync_connection,
            schema=SCHEMA,
            only=required_names,
        )

    await connection.run_sync(reflect)
    return {name: metadata.tables[f"{SCHEMA}.{name}"] for name in required_names}


async def database_counts(
    connection: AsyncConnection,
    tables: dict[str, sa.Table],
    dataset_id: str,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for spec in TABLE_SPECS:
        table = tables[spec.table_name]
        counts[spec.table_name] = int(
            await connection.scalar(
                sa.select(sa.func.count())
                .select_from(table)
                .where(table.c.dataset_id == dataset_id)
            )
            or 0
        )

    requirements = tables["requirement_nodes"]
    relations = tables["requirement_relations"]
    positions = tables["graph_layout_positions"]
    counts["atomic_requirements"] = int(
        await connection.scalar(
            sa.select(sa.func.count())
            .select_from(requirements)
            .where(
                requirements.c.dataset_id == dataset_id, requirements.c.atomic.is_(True)
            )
        )
        or 0
    )
    counts["level_one_requirements"] = int(
        await connection.scalar(
            sa.select(sa.func.count())
            .select_from(relations)
            .where(
                relations.c.dataset_id == dataset_id,
                relations.c.parent_requirement_id == "BR-000",
                relations.c.relation_kind == "contains_requirement",
            )
        )
        or 0
    )
    counts["assigned_layout_positions"] = int(
        await connection.scalar(
            sa.select(sa.func.count())
            .select_from(positions)
            .where(
                positions.c.dataset_id == dataset_id,
                sa.or_(
                    positions.c.x.is_not(None),
                    positions.c.y.is_not(None),
                    positions.c.z.is_not(None),
                ),
            )
        )
        or 0
    )
    return counts


def assert_database_counts(manifest: dict[str, Any], counts: dict[str, int]) -> None:
    manifest_counts = manifest["counts"]
    for spec in TABLE_SPECS:
        expected = manifest_counts[spec.manifest_count_key]
        actual = counts[spec.table_name]
        if actual != expected:
            raise RuntimeError(
                f"database count mismatch for {spec.table_name}: expected {expected}, got {actual}"
            )
    for key in ("atomic_requirements", "level_one_requirements"):
        if counts[key] != manifest_counts[key]:
            raise RuntimeError(
                f"database count mismatch for {key}: "
                f"expected {manifest_counts[key]}, got {counts[key]}"
            )
    if counts["assigned_layout_positions"] != 0:
        raise RuntimeError(
            "graph layout coordinates must remain unassigned in this dataset build"
        )


async def import_dataset(dataset_directory: Path) -> dict[str, Any]:
    raise RuntimeError(
        "PostgreSQL import for business requirements and CAD capabilities is retired. "
        "Use data/pipelines/local_query_store/load_sqlite.py. "
        "Do not write these datasets to DATABASE_URL."
    )
    manifest, rows_by_table = load_dataset(dataset_directory)
    dataset_id = str(manifest["dataset_id"])
    settings = DatabaseSettings()
    engine = create_async_engine(
        as_async_postgres_url(settings.database_url.get_secret_value()),
        pool_pre_ping=True,
        connect_args={"timeout": 10, "command_timeout": 60},
    )

    try:
        async with engine.begin() as connection:
            await connection.execute(
                sa.text("select pg_advisory_xact_lock(hashtext(:dataset_id))"),
                {"dataset_id": dataset_id},
            )
            tables = await reflect_tables(connection)
            builds = tables["dataset_builds"]
            replaced_existing = bool(
                await connection.scalar(
                    sa.select(sa.func.count())
                    .select_from(builds)
                    .where(builds.c.dataset_id == dataset_id)
                )
            )
            await connection.execute(
                sa.delete(builds).where(builds.c.dataset_id == dataset_id)
            )

            try:
                source_directory = dataset_directory.relative_to(REPO_ROOT).as_posix()
            except ValueError:
                source_directory = str(dataset_directory)
            await connection.execute(
                sa.insert(builds),
                {
                    "dataset_id": dataset_id,
                    "schema_version": manifest["schema_version"],
                    "build_status": manifest["build_status"],
                    "content_sha256": content_sha256(dataset_directory),
                    "source_directory": source_directory,
                    "manifest": manifest,
                },
            )

            for spec in TABLE_SPECS:
                rows = [
                    {"dataset_id": dataset_id, **row}
                    for row in rows_by_table[spec.table_name]
                ]
                if rows:
                    await connection.execute(sa.insert(tables[spec.table_name]), rows)

            counts = await database_counts(connection, tables, dataset_id)
            assert_database_counts(manifest, counts)

        async with engine.connect() as connection:
            committed_tables = await reflect_tables(connection)
            committed_counts = await database_counts(
                connection, committed_tables, dataset_id
            )
            assert_database_counts(manifest, committed_counts)
    finally:
        await engine.dispose()

    return {
        "status": "loaded",
        "dataset_id": dataset_id,
        "schema_version": manifest["schema_version"],
        "replaced_existing": replaced_existing,
        "counts": committed_counts,
    }


def main() -> None:
    raise SystemExit(
        "PostgreSQL import for business requirements and CAD capabilities is retired. "
        "Use data/pipelines/local_query_store/load_sqlite.py. "
        "Do not write these datasets to DATABASE_URL."
    )
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=DEFAULT_DATASET_DIRECTORY,
    )
    args = parser.parse_args()
    result = asyncio.run(import_dataset(args.dataset_dir.resolve()))
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
