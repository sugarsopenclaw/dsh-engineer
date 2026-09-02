from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from collections.abc import Iterable, Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from shenbian_api.infrastructure.database import as_async_postgres_url

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATASET_DIRECTORY = (
    REPO_ROOT / "data" / "datasets" / "curated" / "cad-capabilities" / "v1"
)
SCHEMA = "ontology"
INVENTORIES_FILE = "capability-inventories.jsonl"
ATOMS_FILE = "capability-atoms.jsonl"

INVENTORY_COLUMNS = (
    "dataset_id",
    "inventory_id",
    "schema_version",
    "surface",
    "observed_host_id",
    "captured_at",
    "extractor",
    "source_artifacts",
    "atoms_sha256",
    "counts",
    "classification_counts",
)

ATOM_COLUMNS = (
    "dataset_id",
    "atom_id",
    "inventory_id",
    "schema_version",
    "canonical_key",
    "surface",
    "atom_kind",
    "observed_host_ids",
    "source_artifact",
    "declaring_symbol",
    "declaring_symbol_full_name",
    "member",
    "member_name",
    "member_signature",
    "return_type",
    "is_static",
    "provenance",
    "surface_metadata",
    "classification_status",
    "operation_kinds",
    "domain_tags",
    "summary",
    "classification_confidence",
    "semantic_candidates",
    "evidence",
    "processor",
    "processed_at",
    "notes",
)


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL")


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"expected JSON object: {path}")
    return value


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise TypeError(f"expected JSON object: {path}:{line_number}")
            yield value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return list(iter_jsonl(path))


def count_jsonl(path: Path) -> int:
    with path.open("r", encoding="utf-8") as stream:
        return sum(1 for line in stream if line.strip())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def content_sha256(dataset_directory: Path) -> str:
    digest = hashlib.sha256()
    for filename in ("manifest.json", INVENTORIES_FILE, ATOMS_FILE):
        path = dataset_directory / filename
        digest.update(filename.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def load_dataset(
    dataset_directory: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], Path]:
    manifest = read_json(dataset_directory / "manifest.json")
    if manifest.get("build_status") != "valid":
        raise ValueError("dataset build_status must be valid before database import")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise TypeError("manifest files must be an object")

    inventories = read_jsonl(dataset_directory / INVENTORIES_FILE)
    atoms_path = dataset_directory / ATOMS_FILE
    row_counts = {
        INVENTORIES_FILE: len(inventories),
        ATOMS_FILE: count_jsonl(atoms_path),
    }
    for filename in (INVENTORIES_FILE, ATOMS_FILE):
        expected = files.get(filename)
        if not isinstance(expected, dict):
            raise TypeError(f"manifest is missing {filename}")
        if row_counts[filename] != expected.get("rows"):
            raise ValueError(f"row count mismatch for {filename}")
        if sha256_file(dataset_directory / filename) != expected.get("sha256"):
            raise ValueError(f"SHA-256 mismatch for {filename}")
    if len(inventories) != manifest["counts"]["inventories"]:
        raise ValueError("inventory count does not match manifest")
    if row_counts[ATOMS_FILE] != manifest["counts"]["atoms"]:
        raise ValueError("atom count does not match manifest")
    return manifest, inventories, atoms_path


async def reflect_tables(connection: AsyncConnection) -> dict[str, sa.Table]:
    required_names = ["dataset_builds", "capability_inventories", "capability_atoms"]
    relation = await connection.scalar(
        sa.text("select to_regclass(:name)"),
        {"name": f"{SCHEMA}.capability_atoms"},
    )
    if relation is None:
        raise RuntimeError("database schema is missing; run backend Alembic migrations")
    metadata = sa.MetaData()

    def reflect(sync_connection: sa.Connection) -> None:
        metadata.reflect(bind=sync_connection, schema=SCHEMA, only=required_names)

    await connection.run_sync(reflect)
    return {name: metadata.tables[f"{SCHEMA}.{name}"] for name in required_names}


def _parse_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _jsonb(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def inventory_copy_record(dataset_id: str, row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        dataset_id,
        row["inventory_id"],
        row["schema_version"],
        row["surface"],
        row["observed_host_id"],
        _parse_datetime(row["captured_at"]),
        _jsonb(row["extractor"]),
        _jsonb(row["source_artifacts"]),
        row["atoms_sha256"],
        _jsonb(row["counts"]),
        _jsonb(row["classification_counts"]),
    )


def atom_copy_record(dataset_id: str, row: dict[str, Any]) -> tuple[Any, ...]:
    member = row["member"]
    declaring_symbol = row["declaring_symbol"]
    return (
        dataset_id,
        row["atom_id"],
        row["inventory_id"],
        row["schema_version"],
        row["canonical_key"],
        row["surface"],
        row["atom_kind"],
        row["observed_host_ids"],
        _jsonb(row["source_artifact"]),
        _jsonb(declaring_symbol),
        (
            declaring_symbol["full_name"] if declaring_symbol is not None else None
        ),
        _jsonb(member),
        member["name"],
        member["signature"],
        member["return_type"],
        member["is_static"],
        _jsonb(row["provenance"]),
        _jsonb(row["surface_metadata"]),
        row["classification_status"],
        row["operation_kinds"],
        row["domain_tags"],
        row["summary"],
        row["classification_confidence"],
        _jsonb(row["semantic_candidates"]),
        _jsonb(row["evidence"]),
        _jsonb(row["processor"]),
        _parse_datetime(row["processed_at"]),
        row["notes"],
    )


async def _copy_records(
    connection: AsyncConnection,
    table_name: str,
    columns: tuple[str, ...],
    records: Iterable[tuple[Any, ...]],
) -> None:
    raw_connection = await connection.get_raw_connection()
    driver_connection = raw_connection.driver_connection
    await driver_connection.copy_records_to_table(
        table_name,
        records=records,
        columns=columns,
        schema_name=SCHEMA,
        timeout=1800,
    )


async def database_counts(
    connection: AsyncConnection,
    tables: dict[str, sa.Table],
    dataset_id: str,
) -> dict[str, Any]:
    inventories = tables["capability_inventories"]
    atoms = tables["capability_atoms"]
    inventory_count = int(
        await connection.scalar(
            sa.select(sa.func.count())
            .select_from(inventories)
            .where(inventories.c.dataset_id == dataset_id)
        )
        or 0
    )
    atom_count = int(
        await connection.scalar(
            sa.select(sa.func.count())
            .select_from(atoms)
            .where(atoms.c.dataset_id == dataset_id)
        )
        or 0
    )
    surface_rows = (
        await connection.execute(
            sa.select(atoms.c.surface, sa.func.count())
            .where(atoms.c.dataset_id == dataset_id)
            .group_by(atoms.c.surface)
            .order_by(atoms.c.surface)
        )
    ).all()
    return {
        "inventories": inventory_count,
        "atoms": atom_count,
        "by_surface": {surface: int(count) for surface, count in surface_rows},
    }


def assert_database_counts(manifest: dict[str, Any], counts: dict[str, Any]) -> None:
    expected = manifest["counts"]
    for key in ("inventories", "atoms", "by_surface"):
        if counts[key] != expected[key]:
            raise RuntimeError(
                f"database count mismatch for {key}: expected {expected[key]}, got {counts[key]}"
            )


async def import_dataset(dataset_directory: Path) -> dict[str, Any]:
    raise RuntimeError(
        "PostgreSQL import for business requirements and CAD capabilities is retired. "
        "Use data/pipelines/local_query_store/load_sqlite.py. "
        "Do not write these datasets to DATABASE_URL."
    )
    manifest, inventories, atoms_path = load_dataset(dataset_directory)
    dataset_id = str(manifest["dataset_id"])
    settings = DatabaseSettings()
    engine = create_async_engine(
        as_async_postgres_url(settings.database_url.get_secret_value()),
        pool_pre_ping=True,
        connect_args={"timeout": 10, "command_timeout": 1800},
    )
    replaced_existing = False
    committed_counts: dict[str, Any] = {}
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
            await connection.execute(sa.delete(builds).where(builds.c.dataset_id == dataset_id))
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
            await _copy_records(
                connection,
                "capability_inventories",
                INVENTORY_COLUMNS,
                [inventory_copy_record(dataset_id, row) for row in inventories],
            )
            await _copy_records(
                connection,
                "capability_atoms",
                ATOM_COLUMNS,
                (
                    atom_copy_record(dataset_id, row)
                    for row in iter_jsonl(atoms_path)
                ),
            )
            counts = await database_counts(connection, tables, dataset_id)
            assert_database_counts(manifest, counts)

        async with engine.connect() as connection:
            tables = await reflect_tables(connection)
            committed_counts = await database_counts(connection, tables, dataset_id)
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
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    args = parser.parse_args()
    result = asyncio.run(import_dataset(args.dataset_dir.resolve()))
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
