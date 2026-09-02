from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from shenbian_api.application.cad_capability_errors import (
    CadCapabilitiesQueryError,
    CadCapabilitiesUnavailableError,
    CapabilityAtomNotFoundError,
    CapabilityDatasetNotFoundError,
)
from shenbian_api.core.config import Settings
from shenbian_api.domain.cad_capabilities import (
    CapabilityAtomDetail,
    CapabilityAtomDetailData,
    CapabilityAtomFilters,
    CapabilityAtomListItem,
    CapabilityAtomPageData,
    CapabilityDatasetMetadata,
    CapabilityFacetsData,
    CapabilityFacetValue,
    CapabilityGraphAtom,
    CapabilityGraphAtomStreamData,
    capability_graph_scope_key,
)
from shenbian_api.infrastructure.postgres_cad_capabilities import (
    _decode_graph_snapshot,
    _GraphAtomSnapshot,
    _iterate_list,
    _matches_graph_atom_filters,
)
from shenbian_api.infrastructure.sqlite_paths import resolve_sqlite_path

logger = logging.getLogger(__name__)

ATOM_FILTER_SQL = """
    dataset_id = :dataset_id
    AND (:surface IS NULL OR surface = :surface)
    AND (
        :observed_host_id IS NULL
        OR EXISTS (
            SELECT 1 FROM json_each(observed_host_ids)
            WHERE json_each.value = :observed_host_id
        )
    )
    AND (:atom_kind IS NULL OR atom_kind = :atom_kind)
    AND (
        :classification_status IS NULL
        OR classification_status = :classification_status
    )
    AND (
        :operation_kind IS NULL
        OR EXISTS (
            SELECT 1 FROM json_each(operation_kinds)
            WHERE json_each.value = :operation_kind
        )
    )
    AND (
        :domain_tag IS NULL
        OR EXISTS (
            SELECT 1 FROM json_each(domain_tags)
            WHERE json_each.value = :domain_tag
        )
    )
    AND (
        :query IS NULL
        OR member_name LIKE '%' || :query || '%' COLLATE NOCASE
        OR member_signature LIKE '%' || :query || '%' COLLATE NOCASE
        OR coalesce(declaring_symbol_full_name, '') LIKE '%' || :query || '%' COLLATE NOCASE
        OR coalesce(summary, '') LIKE '%' || :query || '%' COLLATE NOCASE
    )
"""


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _loads(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _list_item(row: Mapping[str, Any] | sqlite3.Row) -> CapabilityAtomListItem:
    mapping = dict(row)
    mapping["observed_host_ids"] = _loads(mapping["observed_host_ids"], [])
    mapping["operation_kinds"] = _loads(mapping["operation_kinds"], [])
    mapping["domain_tags"] = _loads(mapping["domain_tags"], [])
    mapping["is_static"] = bool(mapping["is_static"])
    return CapabilityAtomListItem.model_validate(mapping)


def _detail(row: sqlite3.Row) -> CapabilityAtomDetail:
    mapping = _row(row)
    mapping["observed_host_ids"] = _loads(mapping["observed_host_ids"], [])
    mapping["operation_kinds"] = _loads(mapping["operation_kinds"], [])
    mapping["domain_tags"] = _loads(mapping["domain_tags"], [])
    mapping["is_static"] = bool(mapping["is_static"])
    mapping["source_artifact"] = _loads(mapping["source_artifact"], {})
    mapping["declaring_symbol"] = _loads(mapping["declaring_symbol"], None)
    mapping["member"] = _loads(mapping["member"], {})
    mapping["provenance"] = _loads(mapping["provenance"], {})
    mapping["surface_metadata"] = _loads(mapping["surface_metadata"], {})
    mapping["semantic_candidates"] = _loads(mapping["semantic_candidates"], [])
    mapping["evidence"] = _loads(mapping["evidence"], [])
    mapping["processor"] = _loads(mapping["processor"], None)
    if mapping["processed_at"] is not None:
        mapping["processed_at"] = _as_datetime(mapping["processed_at"])
    return CapabilityAtomDetail.model_validate(mapping)


def _filter_params(dataset_id: str, filters: CapabilityAtomFilters) -> dict[str, Any]:
    return {"dataset_id": dataset_id, **filters.model_dump()}


class SqliteCadCapabilitiesReader:
    def __init__(self, settings: Settings) -> None:
        self._path = resolve_sqlite_path(settings.cad_capabilities_sqlite)
        self._graph_atom_snapshots: dict[
            tuple[str, str | None, str | None], _GraphAtomSnapshot
        ] = {}
        self._graph_atom_snapshot_lock = asyncio.Lock()

    def _require_file(self) -> Path:
        if not self._path.is_file():
            raise CadCapabilitiesUnavailableError()
        return self._path

    def _dataset(
        self, connection: sqlite3.Connection, dataset_id: str
    ) -> CapabilityDatasetMetadata:
        row = connection.execute(
            """
            SELECT dataset_id, schema_version, imported_at, content_sha256
            FROM dataset_builds
            WHERE dataset_id = ?
            """,
            (dataset_id,),
        ).fetchone()
        if row is None:
            raise CapabilityDatasetNotFoundError(
                f"Capability dataset {dataset_id} was not found."
            )
        return CapabilityDatasetMetadata(
            dataset_id=row["dataset_id"],
            schema_version=row["schema_version"],
            imported_at=_as_datetime(row["imported_at"]),
            content_sha256=row["content_sha256"],
        )

    def _read_list(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomPageData:
        connection = _connect(self._require_file())
        try:
            dataset = self._dataset(connection, dataset_id)
            parameters = {**_filter_params(dataset_id, filters), "limit": limit, "offset": offset}
            total = int(
                connection.execute(
                    f"SELECT count(*) FROM capability_atoms WHERE {ATOM_FILTER_SQL}",
                    parameters,
                ).fetchone()[0]
            )
            rows = connection.execute(
                f"""
                SELECT
                    atom_id, inventory_id, surface, atom_kind, observed_host_ids,
                    declaring_symbol_full_name, member_name, member_signature, return_type,
                    is_static, classification_status, operation_kinds, domain_tags,
                    summary, classification_confidence
                FROM capability_atoms
                WHERE {ATOM_FILTER_SQL}
                ORDER BY atom_id
                LIMIT :limit OFFSET :offset
                """,
                parameters,
            ).fetchall()
            return CapabilityAtomPageData(
                dataset=dataset,
                total=total,
                items=[_list_item(row) for row in rows],
            )
        finally:
            connection.close()

    def _read_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData:
        connection = _connect(self._require_file())
        try:
            self._dataset(connection, dataset_id)
            row = connection.execute(
                """
                SELECT
                    atom_id, inventory_id, schema_version, canonical_key, surface, atom_kind,
                    observed_host_ids, source_artifact, declaring_symbol,
                    declaring_symbol_full_name, member, member_name, member_signature,
                    return_type, is_static, provenance, surface_metadata,
                    classification_status, operation_kinds, domain_tags, summary,
                    classification_confidence, semantic_candidates, evidence, processor,
                    processed_at, notes
                FROM capability_atoms
                WHERE dataset_id = ? AND atom_id = ?
                """,
                (dataset_id, atom_id),
            ).fetchone()
            if row is None:
                raise CapabilityAtomNotFoundError(
                    f"Capability atom {atom_id} was not found in the selected dataset."
                )
            return CapabilityAtomDetailData(dataset_id=dataset_id, atom=_detail(row))
        finally:
            connection.close()

    def _read_facets(self, dataset_id: str) -> CapabilityFacetsData:
        connection = _connect(self._require_file())
        try:
            self._dataset(connection, dataset_id)
            total = int(
                connection.execute(
                    "SELECT count(*) FROM capability_atoms WHERE dataset_id = ?",
                    (dataset_id,),
                ).fetchone()[0]
            )
            return CapabilityFacetsData(
                dataset_id=dataset_id,
                total_atoms=total,
                surfaces=_scalar_facets(connection, dataset_id, "surface"),
                observed_host_ids=_json_facets(connection, dataset_id, "observed_host_ids"),
                atom_kinds=_scalar_facets(connection, dataset_id, "atom_kind"),
                classification_statuses=_scalar_facets(
                    connection, dataset_id, "classification_status"
                ),
                operation_kinds=_json_facets(connection, dataset_id, "operation_kinds"),
                domain_tags=_json_facets(connection, dataset_id, "domain_tags"),
            )
        finally:
            connection.close()

    def _read_graph_snapshot(
        self,
        dataset_id: str,
        dataset: CapabilityDatasetMetadata,
        filters: CapabilityAtomFilters,
    ) -> list[CapabilityGraphAtom]:
        connection = _connect(self._require_file())
        try:
            snapshot_row = connection.execute(
                """
                SELECT atom_count, payload_gzip
                FROM capability_graph_snapshots
                WHERE dataset_id = ? AND scope_key = ? AND content_sha256 = ?
                """,
                (
                    dataset_id,
                    capability_graph_scope_key(filters.surface, filters.observed_host_id),
                    dataset.content_sha256,
                ),
            ).fetchone()
            if snapshot_row is not None:
                return _decode_graph_snapshot(
                    bytes(snapshot_row["payload_gzip"]),
                    int(snapshot_row["atom_count"]),
                )
            rows = connection.execute(
                """
                SELECT
                    atom_id, surface, atom_kind, observed_host_ids, member_name,
                    declaring_symbol_full_name, classification_status, operation_kinds,
                    domain_tags
                FROM capability_atoms
                WHERE dataset_id = ?
                  AND (? IS NULL OR surface = ?)
                  AND (
                    ? IS NULL
                    OR EXISTS (
                        SELECT 1 FROM json_each(observed_host_ids)
                        WHERE json_each.value = ?
                    )
                  )
                ORDER BY atom_id
                """,
                (
                    dataset_id,
                    filters.surface,
                    filters.surface,
                    filters.observed_host_id,
                    filters.observed_host_id,
                ),
            ).fetchall()
            return [
                CapabilityGraphAtom.model_validate(
                    {
                        **_row(row),
                        "observed_host_ids": _loads(row["observed_host_ids"], []),
                        "operation_kinds": _loads(row["operation_kinds"], []),
                        "domain_tags": _loads(row["domain_tags"], []),
                    }
                )
                for row in rows
            ]
        finally:
            connection.close()

    def _read_query_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> tuple[CapabilityDatasetMetadata, int, list[CapabilityGraphAtom]]:
        connection = _connect(self._require_file())
        try:
            dataset = self._dataset(connection, dataset_id)
            parameters = _filter_params(dataset_id, filters)
            total = int(
                connection.execute(
                    f"SELECT count(*) FROM capability_atoms WHERE {ATOM_FILTER_SQL}",
                    parameters,
                ).fetchone()[0]
            )
            rows = connection.execute(
                f"""
                SELECT
                    atom_id, surface, atom_kind, observed_host_ids, member_name,
                    declaring_symbol_full_name, classification_status, operation_kinds,
                    domain_tags
                FROM capability_atoms
                WHERE {ATOM_FILTER_SQL}
                ORDER BY atom_id
                """,
                parameters,
            ).fetchall()
            atoms = [
                CapabilityGraphAtom.model_validate(
                    {
                        **_row(row),
                        "observed_host_ids": _loads(row["observed_host_ids"], []),
                        "operation_kinds": _loads(row["operation_kinds"], []),
                        "domain_tags": _loads(row["domain_tags"], []),
                    }
                )
                for row in rows
            ]
            return dataset, total, atoms
        finally:
            connection.close()

    async def list_atoms(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomPageData:
        try:
            return await asyncio.to_thread(self._read_list, dataset_id, filters, limit, offset)
        except CadCapabilitiesQueryError:
            raise
        except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
            logger.error("CAD capabilities list query failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None

    async def get_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData:
        try:
            return await asyncio.to_thread(self._read_atom, dataset_id, atom_id)
        except CadCapabilitiesQueryError:
            raise
        except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
            logger.error("CAD capability detail query failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None

    async def get_facets(self, dataset_id: str) -> CapabilityFacetsData:
        try:
            return await asyncio.to_thread(self._read_facets, dataset_id)
        except CadCapabilitiesQueryError:
            raise
        except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
            logger.error("CAD capability facets query failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None

    async def prepare_graph_atom_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> CapabilityGraphAtomStreamData:
        try:
            if filters.query is None:
                connection = _connect(self._require_file())
                try:
                    dataset = self._dataset(connection, dataset_id)
                finally:
                    connection.close()
                scope = (dataset_id, filters.surface, filters.observed_host_id)
                cached = self._graph_atom_snapshots.get(scope)
                if cached is None or cached.content_sha256 != dataset.content_sha256:
                    async with self._graph_atom_snapshot_lock:
                        cached = self._graph_atom_snapshots.get(scope)
                        if cached is None or cached.content_sha256 != dataset.content_sha256:
                            atoms = await asyncio.to_thread(
                                self._read_graph_snapshot, dataset_id, dataset, filters
                            )
                            cached = _GraphAtomSnapshot(dataset.content_sha256, atoms)
                            self._graph_atom_snapshots[scope] = cached
                matched = [
                    atom
                    for atom in cached.atoms
                    if _matches_graph_atom_filters(atom, filters)
                ]
                return CapabilityGraphAtomStreamData(
                    dataset=dataset,
                    total=len(matched),
                    stream=_iterate_list(matched),
                )
            dataset, total, atoms = await asyncio.to_thread(
                self._read_query_stream, dataset_id, filters
            )
            return CapabilityGraphAtomStreamData(
                dataset=dataset,
                total=total,
                stream=_iterate_list(atoms),
            )
        except CadCapabilitiesQueryError:
            raise
        except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
            logger.error("CAD capabilities graph-atoms prepare failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None

    async def close(self) -> None:
        return None


def _scalar_facets(
    connection: sqlite3.Connection,
    dataset_id: str,
    column: str,
) -> list[CapabilityFacetValue]:
    rows = connection.execute(
        f"""
        SELECT {column} AS value, count(*) AS count
        FROM capability_atoms
        WHERE dataset_id = ?
        GROUP BY {column}
        ORDER BY count DESC, value
        """,
        (dataset_id,),
    ).fetchall()
    return [CapabilityFacetValue(value=row["value"], count=int(row["count"])) for row in rows]


def _json_facets(
    connection: sqlite3.Connection,
    dataset_id: str,
    column: str,
) -> list[CapabilityFacetValue]:
    rows = connection.execute(
        f"""
        SELECT json_each.value AS value, count(*) AS count
        FROM capability_atoms, json_each({column})
        WHERE dataset_id = ?
        GROUP BY json_each.value
        ORDER BY count DESC, value
        """,
        (dataset_id,),
    ).fetchall()
    return [CapabilityFacetValue(value=row["value"], count=int(row["count"])) for row in rows]
