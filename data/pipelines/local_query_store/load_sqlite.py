from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_SRC = REPO_ROOT / "backend" / "src"
for _path in (REPO_ROOT, BACKEND_SRC):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from data.pipelines.cad_capabilities.graph_snapshots import (  # noqa: E402
    encode_graph_snapshot_gzip,
    graph_snapshot_scopes,
    snapshot_scope_key,
)
from data.pipelines.cad_capabilities.load_postgres import (
    content_sha256 as cad_content_sha256,
)
from data.pipelines.cad_capabilities.load_postgres import (
    iter_jsonl,
    load_dataset as load_cad_dataset,
)
from data.pipelines.local_query_store.schema import (
    BUSINESS_REQUIREMENTS_SCHEMA,
    CAD_CAPABILITIES_SCHEMA,
)
from data.pipelines.shenbian_client_requirements.load_postgres import (
    TABLE_SPECS,
    assert_database_counts,
)
from data.pipelines.shenbian_client_requirements.load_postgres import (
    content_sha256 as business_content_sha256,
)
from data.pipelines.shenbian_client_requirements.load_postgres import (
    load_dataset as load_business_dataset,
)

DEFAULT_BUSINESS_DIRECTORY = (
    REPO_ROOT / "data" / "datasets" / "curated" / "shenbian-client-requirements" / "v1"
)
DEFAULT_CAD_V1_DIRECTORY = REPO_ROOT / "data" / "datasets" / "curated" / "cad-capabilities" / "v1"
DEFAULT_CAD_V2_DIRECTORY = REPO_ROOT / "data" / "datasets" / "curated" / "cad-capabilities" / "v2"
DEFAULT_CAD_DIRECTORY = DEFAULT_CAD_V2_DIRECTORY
DEFAULT_BUSINESS_SQLITE = REPO_ROOT / "data" / "datasets" / "local" / "business-requirements.sqlite"
DEFAULT_CAD_SQLITE = REPO_ROOT / "data" / "datasets" / "local" / "cad-capabilities.sqlite"

BUSINESS_JSON_COLUMNS = {
    "source_evidence": {"locator"},
    "acceptance_criteria": {"threshold"},
}
BUSINESS_BOOL_COLUMNS = {
    "requirement_nodes": {"atomic", "customer_visible", "needs_confirmation"},
    "requirement_scope_links": {"inherit_to_descendants"},
    "graph_layout_positions": {"locked"},
}
CAD_ATOM_JSON_COLUMNS = {
    "observed_host_ids",
    "source_artifact",
    "declaring_symbol",
    "member",
    "provenance",
    "surface_metadata",
    "operation_kinds",
    "domain_tags",
    "semantic_candidates",
    "evidence",
    "processor",
}
CAD_ATOM_COLUMNS = (
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


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _json_text(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _source_directory(dataset_directory: Path) -> str:
    try:
        return dataset_directory.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(dataset_directory)


def default_cad_directories() -> list[Path]:
    directories = [
        directory
        for directory in (DEFAULT_CAD_V1_DIRECTORY, DEFAULT_CAD_V2_DIRECTORY)
        if (directory / "manifest.json").is_file()
    ]
    return directories or [DEFAULT_CAD_V2_DIRECTORY]


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def _commit(connection: sqlite3.Connection) -> None:
    connection.commit()
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _delete_dataset(connection: sqlite3.Connection, tables: Iterable[str], dataset_id: str) -> None:
    for table in tables:
        connection.execute(f"DELETE FROM {table} WHERE dataset_id = ?", (dataset_id,))


def _insert_dataset_build(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    manifest: dict[str, Any],
    content_sha256: str,
    source_directory: str,
) -> None:
    connection.execute(
        """
        INSERT INTO dataset_builds (
            dataset_id, schema_version, build_status, content_sha256,
            source_directory, manifest, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            manifest["schema_version"],
            manifest["build_status"],
            content_sha256,
            source_directory,
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            _now(),
        ),
    )


def load_business_requirements(
    dataset_directory: Path,
    sqlite_path: Path,
) -> dict[str, Any]:
    manifest, rows_by_table = load_business_dataset(dataset_directory)
    dataset_id = str(manifest["dataset_id"])
    connection = _connect(sqlite_path)
    try:
        connection.executescript(BUSINESS_REQUIREMENTS_SCHEMA)
        replaced_existing = bool(
            connection.execute(
                "SELECT 1 FROM dataset_builds WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()
        )
        _delete_dataset(
            connection,
            ["dataset_builds", *(spec.table_name for spec in TABLE_SPECS)],
            dataset_id,
        )
        _insert_dataset_build(
            connection,
            dataset_id=dataset_id,
            manifest=manifest,
            content_sha256=business_content_sha256(dataset_directory),
            source_directory=_source_directory(dataset_directory),
        )
        for spec in TABLE_SPECS:
            rows = rows_by_table[spec.table_name]
            if not rows:
                continue
            json_columns = BUSINESS_JSON_COLUMNS.get(spec.table_name, set())
            bool_columns = BUSINESS_BOOL_COLUMNS.get(spec.table_name, set())
            columns = ["dataset_id", *rows[0].keys()]
            placeholders = ", ".join("?" for _ in columns)
            values = []
            for row in rows:
                record = {"dataset_id": dataset_id, **row}
                encoded = []
                for column in columns:
                    value = record[column]
                    if column in json_columns:
                        value = _json_text(value)
                    elif column in bool_columns:
                        value = int(bool(value))
                    encoded.append(value)
                values.append(tuple(encoded))
            connection.executemany(
                f"INSERT INTO {spec.table_name} ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
        counts = _business_counts(connection, dataset_id)
        assert_database_counts(manifest, counts)
        _commit(connection)
    finally:
        connection.close()
    return {
        "status": "loaded",
        "store": "sqlite",
        "dataset_id": dataset_id,
        "schema_version": manifest["schema_version"],
        "sqlite_path": str(sqlite_path),
        "replaced_existing": replaced_existing,
        "counts": counts,
    }


def _business_counts(connection: sqlite3.Connection, dataset_id: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for spec in TABLE_SPECS:
        counts[spec.table_name] = int(
            connection.execute(
                f"SELECT count(*) FROM {spec.table_name} WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()[0]
        )
    counts["atomic_requirements"] = int(
        connection.execute(
            """
            SELECT count(*) FROM requirement_nodes
            WHERE dataset_id = ? AND atomic = 1
            """,
            (dataset_id,),
        ).fetchone()[0]
    )
    counts["level_one_requirements"] = int(
        connection.execute(
            """
            SELECT count(*) FROM requirement_relations
            WHERE dataset_id = ?
              AND parent_requirement_id = 'BR-000'
              AND relation_kind = 'contains_requirement'
            """,
            (dataset_id,),
        ).fetchone()[0]
    )
    counts["assigned_layout_positions"] = int(
        connection.execute(
            """
            SELECT count(*) FROM graph_layout_positions
            WHERE dataset_id = ? AND (x IS NOT NULL OR y IS NOT NULL OR z IS NOT NULL)
            """,
            (dataset_id,),
        ).fetchone()[0]
    )
    return counts


def _encode_atom_row(dataset_id: str, row: dict[str, Any]) -> tuple[Any, ...]:
    member = row["member"]
    declaring_symbol = row["declaring_symbol"]
    values = {
        "dataset_id": dataset_id,
        "atom_id": row["atom_id"],
        "inventory_id": row["inventory_id"],
        "schema_version": row["schema_version"],
        "canonical_key": row["canonical_key"],
        "surface": row["surface"],
        "atom_kind": row["atom_kind"],
        "observed_host_ids": row["observed_host_ids"],
        "source_artifact": row["source_artifact"],
        "declaring_symbol": declaring_symbol,
        "declaring_symbol_full_name": (
            declaring_symbol["full_name"] if declaring_symbol is not None else None
        ),
        "member": member,
        "member_name": member["name"],
        "member_signature": member["signature"],
        "return_type": member["return_type"],
        "is_static": int(bool(member["is_static"])),
        "provenance": row["provenance"],
        "surface_metadata": row["surface_metadata"],
        "classification_status": row["classification_status"],
        "operation_kinds": row["operation_kinds"],
        "domain_tags": row["domain_tags"],
        "summary": row["summary"],
        "classification_confidence": row["classification_confidence"],
        "semantic_candidates": row["semantic_candidates"],
        "evidence": row["evidence"],
        "processor": row["processor"],
        "processed_at": row.get("processed_at"),
        "notes": row.get("notes"),
    }
    encoded: list[Any] = []
    for column in CAD_ATOM_COLUMNS:
        value = values[column]
        if column in CAD_ATOM_JSON_COLUMNS:
            value = _json_text(value)
        encoded.append(value)
    return tuple(encoded)


def _cad_counts(connection: sqlite3.Connection, dataset_id: str) -> dict[str, Any]:
    inventory_count = int(
        connection.execute(
            "SELECT count(*) FROM capability_inventories WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchone()[0]
    )
    atom_count = int(
        connection.execute(
            "SELECT count(*) FROM capability_atoms WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchone()[0]
    )
    surface_rows = connection.execute(
        """
        SELECT surface, count(*) AS count
        FROM capability_atoms
        WHERE dataset_id = ?
        GROUP BY surface
        ORDER BY surface
        """,
        (dataset_id,),
    ).fetchall()
    return {
        "inventories": inventory_count,
        "atoms": atom_count,
        "by_surface": {row["surface"]: int(row["count"]) for row in surface_rows},
    }


def _assert_cad_counts(manifest: dict[str, Any], counts: dict[str, Any]) -> None:
    expected = manifest["counts"]
    for key in ("inventories", "atoms", "by_surface"):
        if counts[key] != expected[key]:
            raise RuntimeError(
                f"sqlite count mismatch for {key}: expected {expected[key]}, got {counts[key]}"
            )


def _build_cad_snapshots(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    content_sha256: str,
    manifest: dict[str, Any],
    inventories: list[dict[str, Any]],
) -> dict[str, int]:
    rows = connection.execute(
        """
        SELECT atom_id, surface, atom_kind, observed_host_ids, member_name,
               declaring_symbol_full_name, classification_status, operation_kinds, domain_tags
        FROM capability_atoms
        WHERE dataset_id = ?
        ORDER BY atom_id
        """,
        (dataset_id,),
    ).fetchall()
    atoms = [
        {
            "atom_id": row["atom_id"],
            "surface": row["surface"],
            "atom_kind": row["atom_kind"],
            "observed_host_ids": json.loads(row["observed_host_ids"]),
            "member_name": row["member_name"],
            "declaring_symbol_full_name": row["declaring_symbol_full_name"],
            "classification_status": row["classification_status"],
            "operation_kinds": json.loads(row["operation_kinds"]),
            "domain_tags": json.loads(row["domain_tags"]),
        }
        for row in rows
    ]
    snapshots = 0
    payload_bytes = 0
    generated_at = _now()
    for surface, observed_host_id in graph_snapshot_scopes(manifest, inventories):
        matched = [
            atom
            for atom in atoms
            if (surface is None or atom["surface"] == surface)
            and (observed_host_id is None or observed_host_id in atom["observed_host_ids"])
        ]
        if not matched:
            continue
        payload = encode_graph_snapshot_gzip(matched)
        connection.execute(
            """
            INSERT INTO capability_graph_snapshots (
                dataset_id, scope_key, surface, observed_host_id,
                content_sha256, atom_count, payload_gzip, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                snapshot_scope_key(surface, observed_host_id),
                surface,
                observed_host_id,
                content_sha256,
                len(matched),
                payload,
                generated_at,
            ),
        )
        snapshots += 1
        payload_bytes += len(payload)
    return {"snapshots": snapshots, "payload_bytes": payload_bytes}


def load_cad_capabilities(dataset_directory: Path, sqlite_path: Path) -> dict[str, Any]:
    manifest, inventories, atoms_path = load_cad_dataset(dataset_directory)
    dataset_id = str(manifest["dataset_id"])
    dataset_hash = cad_content_sha256(dataset_directory)
    connection = _connect(sqlite_path)
    try:
        connection.executescript(CAD_CAPABILITIES_SCHEMA)
        replaced_existing = bool(
            connection.execute(
                "SELECT 1 FROM dataset_builds WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()
        )
        _delete_dataset(
            connection,
            [
                "capability_graph_snapshots",
                "capability_atoms",
                "capability_inventories",
                "dataset_builds",
            ],
            dataset_id,
        )
        _insert_dataset_build(
            connection,
            dataset_id=dataset_id,
            manifest=manifest,
            content_sha256=dataset_hash,
            source_directory=_source_directory(dataset_directory),
        )
        connection.executemany(
            """
            INSERT INTO capability_inventories (
                dataset_id, inventory_id, schema_version, surface, observed_host_id,
                captured_at, extractor, source_artifacts, atoms_sha256, counts,
                classification_counts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    dataset_id,
                    row["inventory_id"],
                    row["schema_version"],
                    row["surface"],
                    row["observed_host_id"],
                    row["captured_at"],
                    _json_text(row["extractor"]),
                    _json_text(row["source_artifacts"]),
                    row["atoms_sha256"],
                    _json_text(row["counts"]),
                    _json_text(row["classification_counts"]),
                )
                for row in inventories
            ],
        )
        atom_placeholders = ", ".join("?" for _ in CAD_ATOM_COLUMNS)
        connection.executemany(
            f"INSERT INTO capability_atoms ({', '.join(CAD_ATOM_COLUMNS)}) "
            f"VALUES ({atom_placeholders})",
            (_encode_atom_row(dataset_id, row) for row in iter_jsonl(atoms_path)),
        )
        counts = _cad_counts(connection, dataset_id)
        _assert_cad_counts(manifest, counts)
        snapshots = _build_cad_snapshots(
            connection,
            dataset_id=dataset_id,
            content_sha256=dataset_hash,
            manifest=manifest,
            inventories=inventories,
        )
        _commit(connection)
    finally:
        connection.close()
    return {
        "status": "loaded",
        "store": "sqlite",
        "dataset_id": dataset_id,
        "schema_version": manifest["schema_version"],
        "sqlite_path": str(sqlite_path),
        "replaced_existing": replaced_existing,
        "counts": counts,
        "snapshots": snapshots,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--kind",
        choices=("business-requirements", "cad-capabilities", "all"),
        default="all",
    )
    parser.add_argument("--business-dataset-dir", type=Path, default=DEFAULT_BUSINESS_DIRECTORY)
    parser.add_argument(
        "--cad-dataset-dir",
        type=Path,
        action="append",
        default=None,
        help="CAD curated directory. Repeat to load multiple dataset_id values. "
        "Default: v1 then v2 when both manifests exist.",
    )
    parser.add_argument("--business-sqlite", type=Path, default=DEFAULT_BUSINESS_SQLITE)
    parser.add_argument("--cad-sqlite", type=Path, default=DEFAULT_CAD_SQLITE)
    args = parser.parse_args()
    results: list[dict[str, Any]] = []
    if args.kind in {"business-requirements", "all"}:
        results.append(
            load_business_requirements(
                args.business_dataset_dir.resolve(),
                args.business_sqlite.resolve(),
            )
        )
    if args.kind in {"cad-capabilities", "all"}:
        cad_directories = args.cad_dataset_dir or default_cad_directories()
        results.extend(
            load_cad_capabilities(directory.resolve(), args.cad_sqlite.resolve())
            for directory in cad_directories
        )
    print(json.dumps(results if len(results) > 1 else results[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
