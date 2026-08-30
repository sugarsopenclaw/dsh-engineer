from __future__ import annotations

import asyncio
import gzip
import json
import logging
from collections.abc import AsyncIterator, Mapping
from typing import Any

import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

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
from shenbian_api.infrastructure.database import create_postgres_engine

logger = logging.getLogger(__name__)

ATOM_FILTER_SQL = """
    dataset_id = :dataset_id
    AND (CAST(:surface AS text) IS NULL OR surface = CAST(:surface AS text))
    AND (
        CAST(:observed_host_id AS text) IS NULL
        OR CAST(:observed_host_id AS text) = ANY(observed_host_ids)
    )
    AND (CAST(:atom_kind AS text) IS NULL OR atom_kind = CAST(:atom_kind AS text))
    AND (
        CAST(:classification_status AS text) IS NULL
        OR classification_status = CAST(:classification_status AS text)
    )
    AND (
        CAST(:operation_kind AS text) IS NULL
        OR CAST(:operation_kind AS text) = ANY(operation_kinds)
    )
    AND (
        CAST(:domain_tag AS text) IS NULL
        OR CAST(:domain_tag AS text) = ANY(domain_tags)
    )
    AND (
        CAST(:query AS text) IS NULL
        OR member_name ILIKE '%' || CAST(:query AS text) || '%'
        OR member_signature ILIKE '%' || CAST(:query AS text) || '%'
        OR coalesce(declaring_symbol_full_name, '') ILIKE '%' || CAST(:query AS text) || '%'
        OR coalesce(summary, '') ILIKE '%' || CAST(:query AS text) || '%'
    )
"""

LIST_QUERY = sa.text(
    f"""
    SELECT
        atom_id,
        inventory_id,
        surface,
        atom_kind,
        observed_host_ids,
        declaring_symbol_full_name,
        member_name,
        member_signature,
        return_type,
        is_static,
        classification_status,
        operation_kinds,
        domain_tags,
        summary,
        classification_confidence
    FROM ontology.capability_atoms
    WHERE {ATOM_FILTER_SQL}
    ORDER BY atom_id
    LIMIT CAST(:limit AS integer)
    OFFSET CAST(:offset AS integer)
    """
)

COUNT_QUERY = sa.text(
    f"""
    SELECT count(*)::integer
    FROM ontology.capability_atoms
    WHERE {ATOM_FILTER_SQL}
    """
)

# graph-atoms 批量流的最小投影；签名、参数、证据等重字段仍走 DETAIL_QUERY。
GRAPH_ATOMS_QUERY = sa.text(
    f"""
    SELECT
        atom_id,
        surface,
        atom_kind,
        observed_host_ids,
        member_name,
        declaring_symbol_full_name,
        classification_status,
        operation_kinds,
        domain_tags
    FROM ontology.capability_atoms
    WHERE {ATOM_FILTER_SQL}
    ORDER BY atom_id
    """
)

# 快照按数据集 + 技术面 + 宿主分片；其余筛选在内存中完成。
GRAPH_ATOMS_SNAPSHOT_QUERY = sa.text(
    """
    SELECT
        atom_id,
        surface,
        atom_kind,
        observed_host_ids,
        member_name,
        declaring_symbol_full_name,
        classification_status,
        operation_kinds,
        domain_tags
    FROM ontology.capability_atoms
    WHERE dataset_id = :dataset_id
      AND (CAST(:surface AS text) IS NULL OR surface = CAST(:surface AS text))
      AND (
          CAST(:observed_host_id AS text) IS NULL
          OR CAST(:observed_host_id AS text) = ANY(observed_host_ids)
      )
    ORDER BY atom_id
    """
)

GRAPH_ATOMS_COMPRESSED_SNAPSHOT_QUERY = sa.text(
    """
    SELECT atom_count, payload_gzip
    FROM ontology.capability_graph_snapshots
    WHERE dataset_id = :dataset_id
      AND scope_key = :scope_key
      AND content_sha256 = :content_sha256
    """
)


def _matches_graph_atom_filters(
    atom: CapabilityGraphAtom,
    filters: CapabilityAtomFilters,
) -> bool:
    """内存筛选，语义与 ATOM_FILTER_SQL 逐条对齐（q 除外：q 走 SQL 直连路径）。"""
    if filters.surface is not None and atom.surface != filters.surface:
        return False
    if (
        filters.observed_host_id is not None
        and filters.observed_host_id not in atom.observed_host_ids
    ):
        return False
    if filters.atom_kind is not None and atom.atom_kind != filters.atom_kind:
        return False
    if (
        filters.classification_status is not None
        and atom.classification_status != filters.classification_status
    ):
        return False
    if (
        filters.operation_kind is not None
        and filters.operation_kind not in atom.operation_kinds
    ):
        return False
    if filters.domain_tag is not None and filters.domain_tag not in atom.domain_tags:
        return False
    return True

DETAIL_QUERY = sa.text(
    """
    SELECT
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
    FROM ontology.capability_atoms
    WHERE dataset_id = :dataset_id AND atom_id = :atom_id
    """
)

DATASET_QUERY = sa.text(
    """
    SELECT dataset_id, schema_version, imported_at, content_sha256
    FROM ontology.dataset_builds
    WHERE dataset_id = :dataset_id
    """
)


def _row_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: row[key] for key in row}


async def _iterate_list(
    atoms: list[CapabilityGraphAtom],
) -> AsyncIterator[CapabilityGraphAtom]:
    for atom in atoms:
        yield atom


class _GraphAtomSnapshot:
    """单个数据集筛选分片的最小投影快照；内容哈希变化即重建。"""

    __slots__ = ("content_sha256", "atoms")

    def __init__(self, content_sha256: str, atoms: list[CapabilityGraphAtom]) -> None:
        self.content_sha256 = content_sha256
        self.atoms = atoms


def _graph_snapshot_scope(
    dataset_id: str,
    filters: CapabilityAtomFilters,
) -> tuple[str, str | None, str | None]:
    return dataset_id, filters.surface, filters.observed_host_id


def _decode_graph_snapshot(
    payload_gzip: bytes,
    expected_atoms: int,
) -> list[CapabilityGraphAtom]:
    payload = gzip.decompress(payload_gzip)
    atoms = [
        CapabilityGraphAtom.model_validate(json.loads(line))
        for line in payload.splitlines()
        if line.strip()
    ]
    if len(atoms) != expected_atoms:
        raise ValueError(
            f"compressed graph snapshot count mismatch: "
            f"expected {expected_atoms}, got {len(atoms)}"
        )
    return atoms


class PostgresCadCapabilitiesReader:
    def __init__(self, settings: Settings) -> None:
        database_url = settings.database_url.get_secret_value()
        self._engine: AsyncEngine = create_postgres_engine(database_url)
        # Native 等大分片首次读取可能超过默认 30s 命令超时；快照建好后
        # 相同数据集/技术面/宿主范围内的筛选只在内存执行。
        self._graph_engine: AsyncEngine = create_postgres_engine(
            database_url,
            pool_size=2,
            max_overflow=1,
            command_timeout_seconds=1200,
        )
        self._graph_atom_snapshots: dict[
            tuple[str, str | None, str | None], _GraphAtomSnapshot
        ] = {}
        # 慢链路上重建要几分钟，并发请求不得重复拉全量。
        self._graph_atom_snapshot_lock = asyncio.Lock()

    async def _read_connection(self, engine: AsyncEngine | None = None) -> AsyncConnection:
        connection = await (engine or self._engine).connect()
        try:
            transaction = await connection.begin()
            await connection.execute(
                sa.text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            )
            connection.info["cad_capabilities_transaction"] = transaction
        except Exception:
            await connection.close()
            raise
        return connection

    @staticmethod
    async def _close_read_connection(connection: AsyncConnection) -> None:
        # 失败路径上连接可能已失效（如命令超时中断事务），此时连 info 都会抛
        # PendingRollbackError；清理永远不许掩盖原始错误。
        try:
            transaction = connection.info.pop("cad_capabilities_transaction", None)
        except SQLAlchemyError:
            transaction = None
        if transaction is not None and transaction.is_active:
            try:
                await transaction.rollback()
            except (SQLAlchemyError, TimeoutError, OSError) as exc:
                logger.error("CAD capabilities rollback failed: %s", type(exc).__name__)
        try:
            await connection.close()
        except (SQLAlchemyError, TimeoutError, OSError) as exc:
            logger.error("CAD capabilities connection close failed: %s", type(exc).__name__)

    @staticmethod
    async def _dataset(
        connection: AsyncConnection,
        dataset_id: str,
    ) -> CapabilityDatasetMetadata:
        row = (
            (await connection.execute(DATASET_QUERY, {"dataset_id": dataset_id}))
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise CapabilityDatasetNotFoundError(
                f"Capability dataset {dataset_id} was not found."
            )
        return CapabilityDatasetMetadata.model_validate(row)

    async def list_atoms(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomPageData:
        connection: AsyncConnection | None = None
        try:
            connection = await self._read_connection()
            dataset = await self._dataset(connection, dataset_id)
            parameters = {
                "dataset_id": dataset_id,
                **filters.model_dump(),
                "limit": limit,
                "offset": offset,
            }
            total = int(await connection.scalar(COUNT_QUERY, parameters) or 0)
            rows = (await connection.execute(LIST_QUERY, parameters)).mappings().all()
            return CapabilityAtomPageData(
                dataset=dataset,
                total=total,
                items=[CapabilityAtomListItem.model_validate(row) for row in rows],
            )
        except CadCapabilitiesQueryError:
            raise
        except (SQLAlchemyError, TimeoutError, ValidationError, TypeError, ValueError) as exc:
            logger.error("CAD capabilities list query failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None
        finally:
            if connection is not None:
                await self._close_read_connection(connection)

    async def _graph_atom_snapshot(
        self,
        connection: AsyncConnection,
        dataset_id: str,
        dataset: CapabilityDatasetMetadata,
        filters: CapabilityAtomFilters,
    ) -> list[CapabilityGraphAtom]:
        scope = _graph_snapshot_scope(dataset_id, filters)
        cached = self._graph_atom_snapshots.get(scope)
        if cached is not None and cached.content_sha256 == dataset.content_sha256:
            return cached.atoms
        async with self._graph_atom_snapshot_lock:
            # 拿到锁后再查一次，慢链路下并发请求只会有一个真正重建。
            cached = self._graph_atom_snapshots.get(scope)
            if cached is not None and cached.content_sha256 == dataset.content_sha256:
                return cached.atoms
            snapshot_row = (
                (
                    await connection.execute(
                        GRAPH_ATOMS_COMPRESSED_SNAPSHOT_QUERY,
                        {
                            "dataset_id": dataset_id,
                            "scope_key": capability_graph_scope_key(
                                filters.surface, filters.observed_host_id
                            ),
                            "content_sha256": dataset.content_sha256,
                        },
                    )
                )
                .mappings()
                .one_or_none()
            )
            if snapshot_row is not None:
                atoms = _decode_graph_snapshot(
                    bytes(snapshot_row["payload_gzip"]),
                    int(snapshot_row["atom_count"]),
                )
            else:
                # 旧数据集可能没有预生成投影；保留逐行读取兼容路径。
                result = await connection.stream(
                    GRAPH_ATOMS_SNAPSHOT_QUERY,
                    {
                        "dataset_id": dataset_id,
                        "surface": filters.surface,
                        "observed_host_id": filters.observed_host_id,
                    },
                )
                atoms = [
                    CapabilityGraphAtom.model_validate(row)
                    async for row in result.mappings()
                ]
            self._graph_atom_snapshots[scope] = _GraphAtomSnapshot(
                content_sha256=dataset.content_sha256,
                atoms=atoms,
            )
        logger.info(
            "CAD capabilities graph-atoms snapshot rebuilt: "
            "dataset=%s surface=%s host=%s atoms=%d",
            dataset_id,
            filters.surface,
            filters.observed_host_id,
            len(atoms),
        )
        return atoms

    async def prepare_graph_atom_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> CapabilityGraphAtomStreamData:
        """
        返回元数据 + 行流。
        - 无 q：走数据集快照（首次全量读库，之后内存筛选），连接在返回前归还；
        - 有 q：q 要匹配签名与摘要（投影外字段），走 SQL 直连流，
          连接在整个流式迭代期间保持打开，结束或断开时归还。
        """
        connection: AsyncConnection | None = None
        try:
            connection = await self._read_connection(self._graph_engine)
            dataset = await self._dataset(connection, dataset_id)
            if filters.query is None:
                atoms = await self._graph_atom_snapshot(
                    connection, dataset_id, dataset, filters
                )
                matched = [a for a in atoms if _matches_graph_atom_filters(a, filters)]
                # 快照已在内存，连接立即归还。
                await self._close_read_connection(connection)
                connection = None
                return CapabilityGraphAtomStreamData(
                    dataset=dataset,
                    total=len(matched),
                    stream=_iterate_list(matched),
                )
            parameters = {"dataset_id": dataset_id, **filters.model_dump()}
            total = int(await connection.scalar(COUNT_QUERY, parameters) or 0)
            result = await connection.stream(GRAPH_ATOMS_QUERY, parameters)
        except CadCapabilitiesQueryError:
            if connection is not None:
                await self._close_read_connection(connection)
            raise
        except (
            SQLAlchemyError,
            TimeoutError,
            ValidationError,
            TypeError,
            ValueError,
            OSError,
        ) as exc:
            logger.error("CAD capabilities graph-atoms prepare failed: %s", type(exc).__name__)
            if connection is not None:
                await self._close_read_connection(connection)
            raise CadCapabilitiesUnavailableError() from None

        # 以下只剩 q 直连路径：连接在整个流式迭代期间保持打开，结束或断开时归还。
        async def _iterate() -> AsyncIterator[CapabilityGraphAtom]:
            nonlocal connection
            try:
                async for row in result.mappings():
                    yield CapabilityGraphAtom.model_validate(row)
            except SQLAlchemyError as exc:
                # 响应头已发出，无法在流中途改状态码；记录后结束流。
                logger.error(
                    "CAD capabilities graph-atoms stream failed: %s", type(exc).__name__
                )
            finally:
                if connection is not None:
                    await self._close_read_connection(connection)
                    connection = None

        return CapabilityGraphAtomStreamData(dataset=dataset, total=total, stream=_iterate())

    async def get_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData:
        connection: AsyncConnection | None = None
        try:
            connection = await self._read_connection()
            await self._dataset(connection, dataset_id)
            row = (
                (
                    await connection.execute(
                        DETAIL_QUERY,
                        {"dataset_id": dataset_id, "atom_id": atom_id},
                    )
                )
                .mappings()
                .one_or_none()
            )
            if row is None:
                raise CapabilityAtomNotFoundError(
                    f"Capability atom {atom_id} was not found in the selected dataset."
                )
            return CapabilityAtomDetailData(
                dataset_id=dataset_id,
                atom=CapabilityAtomDetail.model_validate(_row_dict(row)),
            )
        except CadCapabilitiesQueryError:
            raise
        except (SQLAlchemyError, TimeoutError, ValidationError, TypeError, ValueError) as exc:
            logger.error("CAD capability detail query failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None
        finally:
            if connection is not None:
                await self._close_read_connection(connection)

    @staticmethod
    async def _scalar_facets(
        connection: AsyncConnection,
        dataset_id: str,
        column: str,
    ) -> list[CapabilityFacetValue]:
        query = sa.text(
            f"""
            SELECT {column} AS value, count(*)::integer AS count
            FROM ontology.capability_atoms
            WHERE dataset_id = :dataset_id
            GROUP BY {column}
            ORDER BY count DESC, value
            """
        )
        rows = (await connection.execute(query, {"dataset_id": dataset_id})).mappings().all()
        return [CapabilityFacetValue.model_validate(row) for row in rows]

    @staticmethod
    async def _array_facets(
        connection: AsyncConnection,
        dataset_id: str,
        column: str,
    ) -> list[CapabilityFacetValue]:
        query = sa.text(
            f"""
            SELECT value, count(*)::integer AS count
            FROM ontology.capability_atoms
            CROSS JOIN LATERAL unnest({column}) AS value
            WHERE dataset_id = :dataset_id
            GROUP BY value
            ORDER BY count DESC, value
            """
        )
        rows = (await connection.execute(query, {"dataset_id": dataset_id})).mappings().all()
        return [CapabilityFacetValue.model_validate(row) for row in rows]

    async def get_facets(self, dataset_id: str) -> CapabilityFacetsData:
        connection: AsyncConnection | None = None
        try:
            connection = await self._read_connection()
            await self._dataset(connection, dataset_id)
            total_atoms = int(
                await connection.scalar(
                    sa.text(
                        "SELECT count(*)::integer FROM ontology.capability_atoms "
                        "WHERE dataset_id = :dataset_id"
                    ),
                    {"dataset_id": dataset_id},
                )
                or 0
            )
            return CapabilityFacetsData(
                dataset_id=dataset_id,
                total_atoms=total_atoms,
                surfaces=await self._scalar_facets(connection, dataset_id, "surface"),
                observed_host_ids=await self._array_facets(
                    connection, dataset_id, "observed_host_ids"
                ),
                atom_kinds=await self._scalar_facets(connection, dataset_id, "atom_kind"),
                classification_statuses=await self._scalar_facets(
                    connection, dataset_id, "classification_status"
                ),
                operation_kinds=await self._array_facets(
                    connection, dataset_id, "operation_kinds"
                ),
                domain_tags=await self._array_facets(connection, dataset_id, "domain_tags"),
            )
        except CadCapabilitiesQueryError:
            raise
        except (SQLAlchemyError, TimeoutError, ValidationError, TypeError, ValueError) as exc:
            logger.error("CAD capability facets query failed: %s", type(exc).__name__)
            raise CadCapabilitiesUnavailableError() from None
        finally:
            if connection is not None:
                await self._close_read_connection(connection)

    async def close(self) -> None:
        await self._engine.dispose()
        await self._graph_engine.dispose()
