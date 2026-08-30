from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from shenbian_api.application.business_requirement_errors import (
    BusinessRequirementsQueryError,
    BusinessRequirementsUnavailableError,
    DatasetNotFoundError,
    GraphViewNotFoundError,
    RequirementNotFoundError,
)
from shenbian_api.core.config import Settings
from shenbian_api.domain.business_requirements import (
    AcceptanceCriterion,
    BusinessRequirementDetailData,
    BusinessRequirementGraphEdge,
    BusinessRequirementsGraphSnapshot,
    DatasetRecord,
    GraphViewRecord,
    OpenQuestion,
    RequirementAlias,
    RequirementEvidence,
    RequirementNodeRecord,
    RequirementNodeSummary,
    RequirementRelations,
    RequirementScope,
    ScopeDimensionSummary,
    ScopeValueSummary,
    SourceDocumentSummary,
    StoredGraphPosition,
)
from shenbian_api.infrastructure.database import create_postgres_engine

logger = logging.getLogger(__name__)

NODE_QUERY = sa.text(
    """
    WITH evidence_counts AS (
        SELECT dataset_id, requirement_id, count(*)::integer AS item_count
        FROM ontology.requirement_source_links
        WHERE dataset_id = :dataset_id
        GROUP BY dataset_id, requirement_id
    ),
    criterion_counts AS (
        SELECT dataset_id, requirement_id, count(*)::integer AS item_count
        FROM ontology.acceptance_criteria
        WHERE dataset_id = :dataset_id
        GROUP BY dataset_id, requirement_id
    ),
    question_counts AS (
        SELECT dataset_id, requirement_id, count(*)::integer AS item_count
        FROM ontology.open_question_requirement_links
        WHERE dataset_id = :dataset_id
        GROUP BY dataset_id, requirement_id
    ),
    scope_assignments AS (
        SELECT
            dataset_id,
            requirement_id,
            array_agg(scope_value_id ORDER BY scope_value_id) AS scope_value_ids
        FROM ontology.requirement_scope_links
        WHERE dataset_id = :dataset_id
        GROUP BY dataset_id, requirement_id
    )
    SELECT
        n.requirement_id,
        n.name,
        n.description,
        n.requirement_kind,
        n.origin_kind,
        n.atomic,
        n.verification_method,
        n.priority_order,
        n.source_emphasis,
        n.customer_visible,
        n.needs_confirmation,
        n.lifecycle_status,
        n.derived_min_depth,
        coalesce(e.item_count, 0)::integer AS direct_evidence_count,
        coalesce(c.item_count, 0)::integer AS acceptance_criterion_count,
        coalesce(q.item_count, 0)::integer AS open_question_count,
        coalesce(s.scope_value_ids, ARRAY[]::text[]) AS scope_value_ids,
        p.x,
        p.y,
        p.z,
        coalesce(p.position_source, 'unassigned') AS position_source,
        coalesce(p.locked, false) AS position_locked
    FROM ontology.requirement_nodes n
    LEFT JOIN evidence_counts e
      ON e.dataset_id = n.dataset_id AND e.requirement_id = n.requirement_id
    LEFT JOIN criterion_counts c
      ON c.dataset_id = n.dataset_id AND c.requirement_id = n.requirement_id
    LEFT JOIN question_counts q
      ON q.dataset_id = n.dataset_id AND q.requirement_id = n.requirement_id
    LEFT JOIN scope_assignments s
      ON s.dataset_id = n.dataset_id AND s.requirement_id = n.requirement_id
    LEFT JOIN LATERAL (
        SELECT position.x, position.y, position.z, position.position_source, position.locked
        FROM ontology.graph_layout_positions position
        WHERE position.dataset_id = n.dataset_id
          AND position.graph_view_id = :view_id
          AND position.node_kind = 'business_requirement'
          AND position.node_id = n.requirement_id
        ORDER BY position.locked DESC, position.graph_layout_position_id
        LIMIT 1
    ) p ON true
    WHERE n.dataset_id = :dataset_id
      AND (
        CAST(:requirement_id AS text) IS NULL
        OR n.requirement_id = CAST(:requirement_id AS text)
      )
    ORDER BY n.requirement_id
    """
)

EDGE_QUERY = sa.text(
    """
    SELECT
        requirement_relation_id,
        parent_requirement_id,
        child_requirement_id,
        relation_kind,
        display_order,
        rationale,
        origin_kind
    FROM ontology.requirement_relations
    WHERE dataset_id = :dataset_id
      AND (
        CAST(:requirement_id AS text) IS NULL
        OR parent_requirement_id = CAST(:requirement_id AS text)
        OR child_requirement_id = CAST(:requirement_id AS text)
      )
    ORDER BY requirement_relation_id
    """
)


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise TypeError("expected_json_object")
    return value


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _node_from_row(row: Mapping[str, Any]) -> RequirementNodeRecord:
    return RequirementNodeRecord(
        requirement_id=row["requirement_id"],
        name=row["name"],
        description=row["description"],
        requirement_kind=row["requirement_kind"],
        origin_kind=row["origin_kind"],
        atomic=row["atomic"],
        verification_method=row["verification_method"],
        priority_order=row["priority_order"],
        source_emphasis=row["source_emphasis"],
        customer_visible=row["customer_visible"],
        needs_confirmation=row["needs_confirmation"],
        lifecycle_status=row["lifecycle_status"],
        derived_min_depth=row["derived_min_depth"],
        summary=RequirementNodeSummary(
            direct_evidence_count=row["direct_evidence_count"],
            acceptance_criterion_count=row["acceptance_criterion_count"],
            open_question_count=row["open_question_count"],
            scope_value_ids=list(row["scope_value_ids"]),
        ),
        stored_position=StoredGraphPosition(
            x=row["x"],
            y=row["y"],
            z=row["z"],
            position_source=row["position_source"],
            locked=row["position_locked"],
        ),
    )


def _edge_from_row(row: Mapping[str, Any]) -> BusinessRequirementGraphEdge:
    return BusinessRequirementGraphEdge(
        id=row["requirement_relation_id"],
        source_node_id=row["parent_requirement_id"],
        target_node_id=row["child_requirement_id"],
        relation_kind=row["relation_kind"],
        display_order=row["display_order"],
        rationale=row["rationale"],
        origin_kind=row["origin_kind"],
    )


class _GraphSnapshotCacheEntry:
    """单个 (dataset, view) 的图快照；dataset content_sha256 变化即整体重建。

    数据库是远程链路（实测 RTT 数百毫秒且波动），冷查询要多次往返并搬运
    全量节点/边数据，可能超过连接超时导致 503。快照把这笔成本摊到
    “每个数据集版本一次”，之后每次请求只跑一条毫秒级元数据校验查询。
    """

    __slots__ = ("content_sha256", "snapshot")

    def __init__(
        self, content_sha256: str, snapshot: BusinessRequirementsGraphSnapshot
    ) -> None:
        self.content_sha256 = content_sha256
        self.snapshot = snapshot


class PostgresBusinessRequirementsReader:
    def __init__(self, settings: Settings) -> None:
        self._engine: AsyncEngine = create_postgres_engine(settings.database_url.get_secret_value())
        self._graph_snapshots: dict[tuple[str, str], _GraphSnapshotCacheEntry] = {}

    async def _read_connection(self) -> AsyncConnection:
        connection = await self._engine.connect()
        try:
            transaction = await connection.begin()
            await connection.execute(
                sa.text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            )
            connection.info["business_requirements_transaction"] = transaction
        except Exception:
            await connection.close()
            raise
        return connection

    @staticmethod
    async def _close_read_connection(connection: AsyncConnection) -> None:
        try:
            transaction = connection.info.pop("business_requirements_transaction", None)
        except SQLAlchemyError:
            transaction = None
        if transaction is not None and transaction.is_active:
            try:
                await transaction.rollback()
            except (SQLAlchemyError, TimeoutError, OSError) as exc:
                logger.error("business requirements rollback failed: %s", type(exc).__name__)
        try:
            await connection.close()
        except (SQLAlchemyError, TimeoutError, OSError) as exc:
            logger.error("business requirements connection close failed: %s", type(exc).__name__)

    async def get_graph(
        self,
        dataset_id: str,
        view_id: str,
    ) -> BusinessRequirementsGraphSnapshot:
        connection: AsyncConnection | None = None
        try:
            connection = await self._read_connection()
            metadata_row = (
                (
                    await connection.execute(
                        sa.text(
                            """
                        SELECT
                            builds.dataset_id,
                            builds.schema_version,
                            builds.imported_at,
                            builds.content_sha256,
                            views.graph_view_id,
                            views.name AS view_name,
                            views.description AS view_description,
                            views.layout_algorithm,
                            views.layout_version
                        FROM ontology.dataset_builds builds
                        LEFT JOIN ontology.graph_views views
                          ON views.dataset_id = builds.dataset_id
                         AND views.graph_view_id = :view_id
                        WHERE builds.dataset_id = :dataset_id
                        """
                        ),
                        {"dataset_id": dataset_id, "view_id": view_id},
                    )
                )
                .mappings()
                .one_or_none()
            )
            if metadata_row is None:
                raise DatasetNotFoundError(f"Dataset {dataset_id} was not found.")
            if metadata_row["graph_view_id"] is None:
                raise GraphViewNotFoundError(f"Graph view {view_id} was not found.")

            cache_key = (metadata_row["dataset_id"], metadata_row["graph_view_id"])
            cached = self._graph_snapshots.get(cache_key)
            if cached is not None and cached.content_sha256 == metadata_row["content_sha256"]:
                return cached.snapshot

            parameters = {
                "dataset_id": dataset_id,
                "view_id": view_id,
                "requirement_id": None,
            }
            node_rows = (await connection.execute(NODE_QUERY, parameters)).mappings().all()
            edge_rows = (await connection.execute(EDGE_QUERY, parameters)).mappings().all()
            snapshot = BusinessRequirementsGraphSnapshot(
                dataset=DatasetRecord(
                    dataset_id=metadata_row["dataset_id"],
                    schema_version=metadata_row["schema_version"],
                    imported_at=metadata_row["imported_at"],
                    content_sha256=metadata_row["content_sha256"],
                ),
                view=GraphViewRecord(
                    graph_view_id=metadata_row["graph_view_id"],
                    name=metadata_row["view_name"],
                    description=metadata_row["view_description"],
                    layout_algorithm=metadata_row["layout_algorithm"],
                    layout_version=metadata_row["layout_version"],
                ),
                nodes=[_node_from_row(row) for row in node_rows],
                edges=[_edge_from_row(row) for row in edge_rows],
            )
            self._graph_snapshots[cache_key] = _GraphSnapshotCacheEntry(
                content_sha256=metadata_row["content_sha256"],
                snapshot=snapshot,
            )
            logger.info(
                "business requirements graph snapshot rebuilt: dataset=%s view=%s rows=%d",
                metadata_row["dataset_id"],
                metadata_row["graph_view_id"],
                len(snapshot.nodes),
            )
            return snapshot
        except BusinessRequirementsQueryError:
            raise
        except (SQLAlchemyError, TimeoutError, ValidationError, TypeError, ValueError) as exc:
            logger.error("business requirements graph query failed: %s", type(exc).__name__)
            raise BusinessRequirementsUnavailableError() from None
        finally:
            if connection is not None:
                await self._close_read_connection(connection)

    async def get_detail(
        self,
        dataset_id: str,
        requirement_id: str,
    ) -> BusinessRequirementDetailData:
        connection: AsyncConnection | None = None
        try:
            connection = await self._read_connection()
            parameters = {
                "dataset_id": dataset_id,
                "view_id": "GV-BUSINESS-DEFAULT",
                "requirement_id": requirement_id,
            }
            node_row = (await connection.execute(NODE_QUERY, parameters)).mappings().one_or_none()
            if node_row is None:
                dataset_exists = await connection.scalar(
                    sa.text("SELECT 1 FROM ontology.dataset_builds WHERE dataset_id = :dataset_id"),
                    {"dataset_id": dataset_id},
                )
                if dataset_exists is None:
                    raise DatasetNotFoundError(f"Dataset {dataset_id} was not found.")
                raise RequirementNotFoundError(
                    f"Requirement {requirement_id} was not found in the selected dataset."
                )

            edge_rows = (await connection.execute(EDGE_QUERY, parameters)).mappings().all()
            edges = [_edge_from_row(row) for row in edge_rows]
            aliases = await self._aliases(connection, dataset_id, requirement_id)
            evidence = await self._evidence(connection, dataset_id, requirement_id)
            scopes = await self._scopes(connection, dataset_id, requirement_id)
            criteria = await self._criteria(connection, dataset_id, requirement_id)
            questions = await self._questions(connection, dataset_id, requirement_id)
            return BusinessRequirementDetailData(
                dataset_id=dataset_id,
                requirement=_node_from_row(node_row),
                relations=RequirementRelations(
                    parents=[edge for edge in edges if edge.target_node_id == requirement_id],
                    children=[edge for edge in edges if edge.source_node_id == requirement_id],
                ),
                aliases=aliases,
                evidence=evidence,
                scopes=scopes,
                acceptance_criteria=criteria,
                open_questions=questions,
            )
        except BusinessRequirementsQueryError:
            raise
        except (SQLAlchemyError, TimeoutError, ValidationError, TypeError, ValueError) as exc:
            logger.error("business requirement detail query failed: %s", type(exc).__name__)
            raise BusinessRequirementsUnavailableError() from None
        finally:
            if connection is not None:
                await self._close_read_connection(connection)

    @staticmethod
    async def _aliases(
        connection: AsyncConnection,
        dataset_id: str,
        requirement_id: str,
    ) -> list[RequirementAlias]:
        rows = (
            (
                await connection.execute(
                    sa.text(
                        """
                    SELECT requirement_alias_id, alternate_name, alias_kind, note
                    FROM ontology.requirement_aliases
                    WHERE dataset_id = :dataset_id AND requirement_id = :requirement_id
                    ORDER BY requirement_alias_id
                    """
                    ),
                    {"dataset_id": dataset_id, "requirement_id": requirement_id},
                )
            )
            .mappings()
            .all()
        )
        return [RequirementAlias.model_validate(row) for row in rows]

    @staticmethod
    async def _evidence(
        connection: AsyncConnection,
        dataset_id: str,
        requirement_id: str,
    ) -> list[RequirementEvidence]:
        rows = (
            (
                await connection.execute(
                    sa.text(
                        """
                    SELECT
                        links.requirement_source_link_id,
                        links.link_kind,
                        evidence.source_evidence_id,
                        evidence.evidence_kind,
                        evidence.locator,
                        evidence.verbatim_text,
                        documents.source_document_id,
                        documents.name AS document_name,
                        documents.source_kind,
                        documents.authority_rank
                    FROM ontology.requirement_source_links links
                    JOIN ontology.source_evidence evidence
                      ON evidence.dataset_id = links.dataset_id
                     AND evidence.source_evidence_id = links.source_evidence_id
                    JOIN ontology.source_documents documents
                      ON documents.dataset_id = evidence.dataset_id
                     AND documents.source_document_id = evidence.source_document_id
                    WHERE links.dataset_id = :dataset_id
                      AND links.requirement_id = :requirement_id
                    ORDER BY documents.authority_rank, evidence.source_evidence_id,
                             links.requirement_source_link_id
                    """
                    ),
                    {"dataset_id": dataset_id, "requirement_id": requirement_id},
                )
            )
            .mappings()
            .all()
        )
        return [
            RequirementEvidence(
                requirement_source_link_id=row["requirement_source_link_id"],
                link_kind=row["link_kind"],
                source_evidence_id=row["source_evidence_id"],
                evidence_kind=row["evidence_kind"],
                locator=_json_object(row["locator"]),
                verbatim_text=row["verbatim_text"],
                source_document=SourceDocumentSummary(
                    source_document_id=row["source_document_id"],
                    name=row["document_name"],
                    source_kind=row["source_kind"],
                    authority_rank=row["authority_rank"],
                ),
            )
            for row in rows
        ]

    @staticmethod
    async def _scopes(
        connection: AsyncConnection,
        dataset_id: str,
        requirement_id: str,
    ) -> list[RequirementScope]:
        rows = (
            (
                await connection.execute(
                    sa.text(
                        """
                    SELECT
                        links.requirement_scope_link_id,
                        links.applicability,
                        links.inherit_to_descendants,
                        dimensions.scope_dimension_id,
                        dimensions.name AS dimension_name,
                        values.scope_value_id,
                        values.name AS value_name,
                        values.status AS value_status
                    FROM ontology.requirement_scope_links links
                    JOIN ontology.scope_values values
                      ON values.dataset_id = links.dataset_id
                     AND values.scope_value_id = links.scope_value_id
                    JOIN ontology.scope_dimensions dimensions
                      ON dimensions.dataset_id = values.dataset_id
                     AND dimensions.scope_dimension_id = values.scope_dimension_id
                    WHERE links.dataset_id = :dataset_id
                      AND links.requirement_id = :requirement_id
                    ORDER BY dimensions.scope_dimension_id, values.scope_value_id
                    """
                    ),
                    {"dataset_id": dataset_id, "requirement_id": requirement_id},
                )
            )
            .mappings()
            .all()
        )
        return [
            RequirementScope(
                requirement_scope_link_id=row["requirement_scope_link_id"],
                applicability=row["applicability"],
                inherit_to_descendants=row["inherit_to_descendants"],
                dimension=ScopeDimensionSummary(
                    scope_dimension_id=row["scope_dimension_id"],
                    name=row["dimension_name"],
                ),
                value=ScopeValueSummary(
                    scope_value_id=row["scope_value_id"],
                    name=row["value_name"],
                    status=row["value_status"],
                ),
            )
            for row in rows
        ]

    @staticmethod
    async def _criteria(
        connection: AsyncConnection,
        dataset_id: str,
        requirement_id: str,
    ) -> list[AcceptanceCriterion]:
        rows = (
            (
                await connection.execute(
                    sa.text(
                        """
                    SELECT
                        acceptance_criterion_id,
                        criterion_statement,
                        criterion_status,
                        threshold,
                        measurement_method,
                        origin_kind
                    FROM ontology.acceptance_criteria
                    WHERE dataset_id = :dataset_id AND requirement_id = :requirement_id
                    ORDER BY acceptance_criterion_id
                    """
                    ),
                    {"dataset_id": dataset_id, "requirement_id": requirement_id},
                )
            )
            .mappings()
            .all()
        )
        return [
            AcceptanceCriterion(
                acceptance_criterion_id=row["acceptance_criterion_id"],
                criterion_statement=row["criterion_statement"],
                criterion_status=row["criterion_status"],
                threshold=_json_value(row["threshold"]),
                measurement_method=row["measurement_method"],
                origin_kind=row["origin_kind"],
            )
            for row in rows
        ]

    @staticmethod
    async def _questions(
        connection: AsyncConnection,
        dataset_id: str,
        requirement_id: str,
    ) -> list[OpenQuestion]:
        rows = (
            (
                await connection.execute(
                    sa.text(
                        """
                    SELECT
                        questions.open_question_id,
                        questions.question,
                        questions.blocking_kind,
                        questions.status
                    FROM ontology.open_question_requirement_links links
                    JOIN ontology.open_questions questions
                      ON questions.dataset_id = links.dataset_id
                     AND questions.open_question_id = links.open_question_id
                    WHERE links.dataset_id = :dataset_id
                      AND links.requirement_id = :requirement_id
                    ORDER BY questions.open_question_id
                    """
                    ),
                    {"dataset_id": dataset_id, "requirement_id": requirement_id},
                )
            )
            .mappings()
            .all()
        )
        return [OpenQuestion.model_validate(row) for row in rows]

    async def close(self) -> None:
        await self._engine.dispose()
