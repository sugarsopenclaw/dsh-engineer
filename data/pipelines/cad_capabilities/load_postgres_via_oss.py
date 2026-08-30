from __future__ import annotations

import argparse
import asyncio
import gzip
import json
import logging
import shlex
import shutil
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import alibabacloud_oss_v2 as oss
import asyncpg

if __package__:
    from .load_postgres import (
        REPO_ROOT,
        SCHEMA,
        assert_database_counts,
        content_sha256,
        inventory_copy_record,
        load_dataset,
    )
else:
    from load_postgres import (
        REPO_ROOT,
        SCHEMA,
        assert_database_counts,
        content_sha256,
        inventory_copy_record,
        load_dataset,
    )

from shenbian_api.core.config import Settings
from shenbian_api.domain.cad_capabilities import capability_graph_scope_key
from shenbian_api.infrastructure.probes import _build_oss_credentials_provider

STAGING_TABLE_PREFIX = "cad_capability_atoms_import_"
DEFAULT_FAST_DATASET_DIRECTORY = (
    REPO_ROOT / "data" / "datasets" / "curated" / "cad-capabilities" / "v2"
)
logger = logging.getLogger(__name__)


def _progress(event: str, **values: Any) -> None:
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)


def compress_jsonl(source: Path, target: Path) -> None:
    with (
        source.open("rb") as input_stream,
        target.open("wb") as output_stream,
        gzip.GzipFile(
            filename="",
            mode="wb",
            compresslevel=6,
            fileobj=output_stream,
            mtime=0,
        ) as compressed_stream,
    ):
        shutil.copyfileobj(input_stream, compressed_stream, length=1024 * 1024)


def server_pull_program(signed_url: str) -> str:
    parsed = urlsplit(signed_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("OSS pre-signed URL must be HTTPS with a hostname")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("OSS pre-signed URL contains unsupported components")
    port = parsed.port or 443
    target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    request = (
        f"GET {target} HTTP/1.1\\r\\n"
        f"Host: {parsed.hostname}\\r\\n"
        "Connection: close\\r\\n\\r\\n"
    )
    return (
        f"printf %b {shlex.quote(request)}"
        f" | openssl s_client -quiet -connect "
        f"{shlex.quote(f'{parsed.hostname}:{port}')}"
        f" -servername {shlex.quote(parsed.hostname)} 2>/dev/null"
        " | sed '1,/^\\r$/d' | gzip -dc"
    )


def build_oss_client(settings: Settings) -> oss.Client:
    provider = _build_oss_credentials_provider(
        settings.alibaba_cloud_access_key_id.get_secret_value(),
        settings.alibaba_cloud_access_key_secret.get_secret_value(),
    )
    config = oss.config.load_default()
    config.credentials_provider = provider
    config.region = settings.oss_region
    return oss.Client(config)


async def create_staging_table(
    connection: asyncpg.Connection[Any],
    table_name: str,
) -> None:
    await connection.execute(
        f"CREATE UNLOGGED TABLE {SCHEMA}.{table_name} (payload jsonb NOT NULL)"
    )


async def load_staging_table_from_oss(
    connection: asyncpg.Connection[Any],
    table_name: str,
    signed_url: str,
) -> int:
    program = server_pull_program(signed_url).replace("'", "''")
    await connection.execute(
        f"COPY {SCHEMA}.{table_name} (payload) "
        f"FROM PROGRAM '{program}' "
        "WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')"
    )
    return int(
        await connection.fetchval(f"SELECT count(*) FROM {SCHEMA}.{table_name}")
        or 0
    )


def atom_insert_sql(table_name: str) -> str:
    return f"""
        INSERT INTO {SCHEMA}.capability_atoms (
            dataset_id,
            atom_id,
            inventory_id,
            schema_version,
            canonical_key,
            surface,
            atom_kind,
            observed_host_ids,
            source_artifact,
            declaring_symbol,
            declaring_symbol_full_name,
            member,
            member_name,
            member_signature,
            return_type,
            is_static,
            provenance,
            surface_metadata,
            classification_status,
            operation_kinds,
            domain_tags,
            summary,
            classification_confidence,
            semantic_candidates,
            evidence,
            processor,
            processed_at,
            notes
        )
        SELECT
            $1::text,
            payload->>'atom_id',
            payload->>'inventory_id',
            payload->>'schema_version',
            payload->>'canonical_key',
            payload->>'surface',
            payload->>'atom_kind',
            ARRAY(SELECT jsonb_array_elements_text(payload->'observed_host_ids')),
            payload->'source_artifact',
            CASE
                WHEN payload->'declaring_symbol' = 'null'::jsonb THEN NULL
                ELSE payload->'declaring_symbol'
            END,
            payload#>>'{{declaring_symbol,full_name}}',
            payload->'member',
            payload#>>'{{member,name}}',
            payload#>>'{{member,signature}}',
            payload#>>'{{member,return_type}}',
            (payload#>>'{{member,is_static}}')::boolean,
            payload->'provenance',
            payload->'surface_metadata',
            payload->>'classification_status',
            ARRAY(SELECT jsonb_array_elements_text(payload->'operation_kinds')),
            ARRAY(SELECT jsonb_array_elements_text(payload->'domain_tags')),
            payload->>'summary',
            (payload->>'classification_confidence')::double precision,
            payload->'semantic_candidates',
            payload->'evidence',
            CASE
                WHEN payload->'processor' = 'null'::jsonb THEN NULL
                ELSE payload->'processor'
            END,
            (payload->>'processed_at')::timestamptz,
            payload->>'notes'
        FROM {SCHEMA}.{table_name}
        ORDER BY payload->>'atom_id'
    """


def graph_snapshot_scopes(
    manifest: dict[str, Any],
    inventories: list[dict[str, Any]],
) -> list[tuple[str | None, str | None]]:
    surfaces = sorted(manifest["counts"]["by_surface"])
    hosts = sorted({inventory["observed_host_id"] for inventory in inventories})
    return [
        (None, None),
        *((surface, None) for surface in surfaces),
        *((None, host) for host in hosts),
        *((surface, host) for host in hosts for surface in surfaces),
    ]


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def graph_snapshot_copy_sql(
    *,
    dataset_id: str,
    surface: str | None,
    observed_host_id: str | None,
    output_path: str,
) -> str:
    predicates = [f"dataset_id = {_sql_literal(dataset_id)}"]
    if surface is not None:
        predicates.append(f"surface = {_sql_literal(surface)}")
    if observed_host_id is not None:
        predicates.append(
            f"{_sql_literal(observed_host_id)} = ANY(observed_host_ids)"
        )
    command = f"gzip -n -c > {shlex.quote(output_path)}".replace("'", "''")
    return f"""
        COPY (
            SELECT jsonb_build_object(
                'atom_id', atom_id,
                'surface', surface,
                'atom_kind', atom_kind,
                'observed_host_ids', to_jsonb(observed_host_ids),
                'member_name', member_name,
                'declaring_symbol_full_name', declaring_symbol_full_name,
                'classification_status', classification_status,
                'operation_kinds', to_jsonb(operation_kinds),
                'domain_tags', to_jsonb(domain_tags)
            )::text
            FROM {SCHEMA}.capability_atoms
            WHERE {" AND ".join(predicates)}
            ORDER BY atom_id
        ) TO PROGRAM '{command}'
        WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')
    """


async def _remove_server_file(
    connection: asyncpg.Connection[Any],
    output_path: str,
) -> None:
    command = f"rm -f -- {shlex.quote(output_path)}".replace("'", "''")
    await connection.execute(
        f"COPY (SELECT NULL::text WHERE false) TO PROGRAM '{command}'"
    )


async def build_graph_snapshots(
    connection: asyncpg.Connection[Any],
    *,
    dataset_id: str,
    content_sha256: str,
    manifest: dict[str, Any],
    inventories: list[dict[str, Any]],
) -> dict[str, int]:
    snapshots = 0
    payload_bytes = 0
    for surface, observed_host_id in graph_snapshot_scopes(manifest, inventories):
        conditions = ["dataset_id = $1"]
        values: list[str] = [dataset_id]
        if surface is not None:
            values.append(surface)
            conditions.append(f"surface = ${len(values)}")
        if observed_host_id is not None:
            values.append(observed_host_id)
            conditions.append(f"${len(values)} = ANY(observed_host_ids)")
        atom_count = int(
            await connection.fetchval(
                f"SELECT count(*) FROM {SCHEMA}.capability_atoms "
                f"WHERE {' AND '.join(conditions)}",
                *values,
            )
            or 0
        )
        if atom_count == 0:
            continue

        output_path = (
            f"/tmp/cad-capability-graph-{uuid.uuid4().hex}.jsonl.gz"
        )
        try:
            copy_result = await connection.execute(
                graph_snapshot_copy_sql(
                    dataset_id=dataset_id,
                    surface=surface,
                    observed_host_id=observed_host_id,
                    output_path=output_path,
                )
            )
            if copy_result != f"COPY {atom_count}":
                raise RuntimeError(
                    f"graph snapshot COPY mismatch: expected {atom_count}, "
                    f"got {copy_result}"
                )
            payload_size = int(
                await connection.fetchval(
                    f"""
                    INSERT INTO {SCHEMA}.capability_graph_snapshots (
                        dataset_id,
                        scope_key,
                        surface,
                        observed_host_id,
                        content_sha256,
                        atom_count,
                        payload_gzip
                    ) VALUES ($1, $2, $3, $4, $5, $6, pg_read_binary_file($7))
                    RETURNING octet_length(payload_gzip)
                    """,
                    dataset_id,
                    capability_graph_scope_key(surface, observed_host_id),
                    surface,
                    observed_host_id,
                    content_sha256,
                    atom_count,
                    output_path,
                )
                or 0
            )
            snapshots += 1
            payload_bytes += payload_size
        finally:
            await _remove_server_file(connection, output_path)
    return {"snapshots": snapshots, "payload_bytes": payload_bytes}


async def database_counts(
    connection: asyncpg.Connection[Any],
    dataset_id: str,
) -> dict[str, Any]:
    inventory_count = int(
        await connection.fetchval(
            f"SELECT count(*) FROM {SCHEMA}.capability_inventories "
            "WHERE dataset_id = $1",
            dataset_id,
        )
        or 0
    )
    atom_count = int(
        await connection.fetchval(
            f"SELECT count(*) FROM {SCHEMA}.capability_atoms WHERE dataset_id = $1",
            dataset_id,
        )
        or 0
    )
    surface_rows = await connection.fetch(
        f"SELECT surface, count(*) AS count FROM {SCHEMA}.capability_atoms "
        "WHERE dataset_id = $1 GROUP BY surface ORDER BY surface",
        dataset_id,
    )
    return {
        "inventories": inventory_count,
        "atoms": atom_count,
        "by_surface": {row["surface"]: int(row["count"]) for row in surface_rows},
    }


async def materialize_dataset(
    connection: asyncpg.Connection[Any],
    *,
    dataset_directory: Path,
    manifest: dict[str, Any],
    inventories: list[dict[str, Any]],
    table_name: str,
) -> tuple[bool, dict[str, Any], dict[str, int]]:
    dataset_id = str(manifest["dataset_id"])
    dataset_hash = content_sha256(dataset_directory)
    try:
        source_directory = dataset_directory.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        source_directory = str(dataset_directory)

    replaced_existing = bool(
        await connection.fetchval(
            f"SELECT count(*) FROM {SCHEMA}.dataset_builds WHERE dataset_id = $1",
            dataset_id,
        )
    )
    snapshot_counts: dict[str, int] = {}
    async with connection.transaction():
        await connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))", dataset_id
        )
        await connection.execute(
            f"DELETE FROM {SCHEMA}.dataset_builds WHERE dataset_id = $1",
            dataset_id,
        )
        await connection.execute(
            f"""
            INSERT INTO {SCHEMA}.dataset_builds (
                dataset_id,
                schema_version,
                build_status,
                content_sha256,
                source_directory,
                manifest
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            """,
            dataset_id,
            manifest["schema_version"],
            manifest["build_status"],
            dataset_hash,
            source_directory,
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        )
        await connection.copy_records_to_table(
            "capability_inventories",
            schema_name=SCHEMA,
            columns=(
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
            ),
            records=[inventory_copy_record(dataset_id, row) for row in inventories],
            timeout=7200,
        )
        inserted = await connection.execute(atom_insert_sql(table_name), dataset_id)
        if inserted != f"INSERT 0 {manifest['counts']['atoms']}":
            raise RuntimeError(
                f"atom insert count mismatch: expected {manifest['counts']['atoms']}, "
                f"got {inserted}"
            )
        counts = await database_counts(connection, dataset_id)
        assert_database_counts(manifest, counts)
        snapshot_counts = await build_graph_snapshots(
            connection,
            dataset_id=dataset_id,
            content_sha256=dataset_hash,
            manifest=manifest,
            inventories=inventories,
        )

    committed_counts = await database_counts(connection, dataset_id)
    assert_database_counts(manifest, committed_counts)
    return replaced_existing, committed_counts, snapshot_counts


async def cad_dataset_counts(
    connection: asyncpg.Connection[Any],
) -> dict[str, int]:
    rows = await connection.fetch(
        f"""
        SELECT b.dataset_id, count(a.atom_id) AS atoms
        FROM {SCHEMA}.dataset_builds AS b
        LEFT JOIN {SCHEMA}.capability_atoms AS a USING (dataset_id)
        WHERE b.dataset_id LIKE 'cad.capabilities.curated.%'
        GROUP BY b.dataset_id
        ORDER BY b.dataset_id
        """
    )
    return {row["dataset_id"]: int(row["atoms"]) for row in rows}


async def import_dataset_via_oss(dataset_directory: Path) -> dict[str, Any]:
    manifest, inventories, atoms_path = load_dataset(dataset_directory)
    settings = Settings()
    client = build_oss_client(settings)
    table_name = f"{STAGING_TABLE_PREFIX}{uuid.uuid4().hex[:12]}"
    object_key = (
        "temporary/cad-capability-import/"
        f"{manifest['dataset_id']}-{uuid.uuid4().hex}.jsonl.gz"
    )
    database_url = settings.database_url.get_secret_value().replace(
        "postgresql+asyncpg://", "postgresql://"
    )

    with tempfile.TemporaryDirectory(prefix="cad-capability-import-") as temporary_root:
        compressed_path = Path(temporary_root) / "capability-atoms.jsonl.gz"
        _progress("compress_start", source_bytes=atoms_path.stat().st_size)
        await asyncio.to_thread(compress_jsonl, atoms_path, compressed_path)
        _progress("compress_complete", compressed_bytes=compressed_path.stat().st_size)

        connection: asyncpg.Connection[Any] | None = None
        uploaded = False
        staging_created = False
        try:
            _progress("oss_upload_start")
            await asyncio.to_thread(
                client.put_object_from_file,
                oss.PutObjectRequest(
                    bucket=settings.oss_bucket,
                    key=object_key,
                    content_type="application/gzip",
                    forbid_overwrite=True,
                ),
                str(compressed_path),
            )
            uploaded = True
            _progress("oss_upload_complete")
            signed = client.presign(
                oss.GetObjectRequest(bucket=settings.oss_bucket, key=object_key),
                expires=timedelta(hours=2),
            )
            if not signed.url:
                raise RuntimeError("OSS did not return a pre-signed URL")

            connection = await asyncpg.connect(
                database_url,
                timeout=10,
                command_timeout=7200,
            )
            await create_staging_table(connection, table_name)
            staging_created = True
            _progress("server_pull_start")
            staged_rows = await load_staging_table_from_oss(
                connection, table_name, signed.url
            )
            if staged_rows != manifest["counts"]["atoms"]:
                raise RuntimeError(
                    f"staging row count mismatch: expected {manifest['counts']['atoms']}, "
                    f"got {staged_rows}"
                )
            _progress("server_pull_complete", staged_rows=staged_rows)

            _progress("materialize_start")
            replaced_existing, counts, graph_snapshots = await materialize_dataset(
                connection,
                dataset_directory=dataset_directory,
                manifest=manifest,
                inventories=inventories,
                table_name=table_name,
            )
            all_cad_datasets = await cad_dataset_counts(connection)
            _progress("materialize_complete", atoms=counts["atoms"])
            return {
                "status": "loaded",
                "transport": "oss_server_pull",
                "dataset_id": manifest["dataset_id"],
                "schema_version": manifest["schema_version"],
                "replaced_existing": replaced_existing,
                "counts": counts,
                "graph_snapshots": graph_snapshots,
                "cad_dataset_atom_counts": all_cad_datasets,
            }
        finally:
            if connection is not None:
                if staging_created:
                    try:
                        await connection.execute(
                            f"DROP TABLE IF EXISTS {SCHEMA}.{table_name}"
                        )
                    except Exception as error:  # noqa: BLE001
                        logger.warning(
                            "Failed to remove CAD import staging table: %s",
                            type(error).__name__,
                        )
                await connection.close()
            if uploaded:
                try:
                    await asyncio.to_thread(
                        client.delete_object,
                        oss.DeleteObjectRequest(
                            bucket=settings.oss_bucket,
                            key=object_key,
                        ),
                    )
                except Exception as error:  # noqa: BLE001
                    logger.warning(
                        "Failed to remove temporary CAD import object: %s",
                        type(error).__name__,
                    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-dir", type=Path, default=DEFAULT_FAST_DATASET_DIRECTORY
    )
    args = parser.parse_args()
    result = asyncio.run(import_dataset_via_oss(args.dataset_dir.resolve()))
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
