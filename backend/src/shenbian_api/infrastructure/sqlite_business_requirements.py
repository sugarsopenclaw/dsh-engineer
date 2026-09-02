from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

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
    BusinessRequirementsGraphSnapshot,
    DatasetRecord,
    GraphViewRecord,
    OpenQuestion,
    RequirementAlias,
    RequirementEvidence,
    RequirementRelations,
    RequirementScope,
    ScopeDimensionSummary,
    ScopeValueSummary,
    SourceDocumentSummary,
)
from shenbian_api.infrastructure.postgres_business_requirements import (
    _edge_from_row,
    _GraphSnapshotCacheEntry,
    _json_object,
    _json_value,
    _node_from_row,
)
from shenbian_api.infrastructure.sqlite_paths import resolve_sqlite_path

logger = logging.getLogger(__name__)


def _as_bool(value: Any) -> bool:
    return bool(value)


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


class SqliteBusinessRequirementsReader:
    def __init__(self, settings: Settings) -> None:
        self._path = resolve_sqlite_path(settings.business_requirements_sqlite)
        self._graph_snapshots: dict[tuple[str, str], _GraphSnapshotCacheEntry] = {}

    def _require_file(self) -> Path:
        if not self._path.is_file():
            raise BusinessRequirementsUnavailableError()
        return self._path

    def _read_graph(
        self,
        dataset_id: str,
        view_id: str,
    ) -> BusinessRequirementsGraphSnapshot:
        connection = _connect(self._require_file())
        try:
            metadata = connection.execute(
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
                FROM dataset_builds builds
                LEFT JOIN graph_views views
                  ON views.dataset_id = builds.dataset_id
                 AND views.graph_view_id = ?
                WHERE builds.dataset_id = ?
                """,
                (view_id, dataset_id),
            ).fetchone()
            if metadata is None:
                raise DatasetNotFoundError(f"Dataset {dataset_id} was not found.")
            if metadata["graph_view_id"] is None:
                raise GraphViewNotFoundError(f"Graph view {view_id} was not found.")

            cache_key = (metadata["dataset_id"], metadata["graph_view_id"])
            cached = self._graph_snapshots.get(cache_key)
            if cached is not None and cached.content_sha256 == metadata["content_sha256"]:
                return cached.snapshot

            node_rows = connection.execute(
                """
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
                    coalesce(e.item_count, 0) AS direct_evidence_count,
                    coalesce(c.item_count, 0) AS acceptance_criterion_count,
                    coalesce(q.item_count, 0) AS open_question_count,
                    coalesce(s.scope_value_ids, '[]') AS scope_value_ids,
                    p.x,
                    p.y,
                    p.z,
                    coalesce(p.position_source, 'unassigned') AS position_source,
                    coalesce(p.locked, 0) AS position_locked
                FROM requirement_nodes n
                LEFT JOIN (
                    SELECT dataset_id, requirement_id, count(*) AS item_count
                    FROM requirement_source_links
                    WHERE dataset_id = ?
                    GROUP BY dataset_id, requirement_id
                ) e ON e.dataset_id = n.dataset_id AND e.requirement_id = n.requirement_id
                LEFT JOIN (
                    SELECT dataset_id, requirement_id, count(*) AS item_count
                    FROM acceptance_criteria
                    WHERE dataset_id = ?
                    GROUP BY dataset_id, requirement_id
                ) c ON c.dataset_id = n.dataset_id AND c.requirement_id = n.requirement_id
                LEFT JOIN (
                    SELECT dataset_id, requirement_id, count(*) AS item_count
                    FROM open_question_requirement_links
                    WHERE dataset_id = ?
                    GROUP BY dataset_id, requirement_id
                ) q ON q.dataset_id = n.dataset_id AND q.requirement_id = n.requirement_id
                LEFT JOIN (
                    SELECT
                        dataset_id,
                        requirement_id,
                        json_group_array(scope_value_id) AS scope_value_ids
                    FROM requirement_scope_links
                    WHERE dataset_id = ?
                    GROUP BY dataset_id, requirement_id
                ) s ON s.dataset_id = n.dataset_id AND s.requirement_id = n.requirement_id
                LEFT JOIN graph_layout_positions p
                  ON p.dataset_id = n.dataset_id
                 AND p.graph_view_id = ?
                 AND p.node_kind = 'business_requirement'
                 AND p.node_id = n.requirement_id
                WHERE n.dataset_id = ?
                ORDER BY n.requirement_id
                """,
                (dataset_id, dataset_id, dataset_id, dataset_id, view_id, dataset_id),
            ).fetchall()
            edge_rows = connection.execute(
                """
                SELECT
                    requirement_relation_id,
                    parent_requirement_id,
                    child_requirement_id,
                    relation_kind,
                    display_order,
                    rationale,
                    origin_kind
                FROM requirement_relations
                WHERE dataset_id = ?
                ORDER BY requirement_relation_id
                """,
                (dataset_id,),
            ).fetchall()
            snapshot = BusinessRequirementsGraphSnapshot(
                dataset=DatasetRecord(
                    dataset_id=metadata["dataset_id"],
                    schema_version=metadata["schema_version"],
                    imported_at=_as_datetime(metadata["imported_at"]),
                    content_sha256=metadata["content_sha256"],
                ),
                view=GraphViewRecord(
                    graph_view_id=metadata["graph_view_id"],
                    name=metadata["view_name"],
                    description=metadata["view_description"],
                    layout_algorithm=metadata["layout_algorithm"],
                    layout_version=metadata["layout_version"],
                ),
                nodes=[_node_from_row(_node_mapping(row)) for row in node_rows],
                edges=[_edge_from_row(_row(row)) for row in edge_rows],
            )
            self._graph_snapshots[cache_key] = _GraphSnapshotCacheEntry(
                content_sha256=metadata["content_sha256"],
                snapshot=snapshot,
            )
            return snapshot
        finally:
            connection.close()

    def _read_detail(self, dataset_id: str, requirement_id: str) -> BusinessRequirementDetailData:
        connection = _connect(self._require_file())
        try:
            if connection.execute(
                "SELECT 1 FROM dataset_builds WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone() is None:
                raise DatasetNotFoundError(f"Dataset {dataset_id} was not found.")
            node_row = connection.execute(
                """
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
                    coalesce(e.item_count, 0) AS direct_evidence_count,
                    coalesce(c.item_count, 0) AS acceptance_criterion_count,
                    coalesce(q.item_count, 0) AS open_question_count,
                    coalesce(s.scope_value_ids, '[]') AS scope_value_ids,
                    p.x,
                    p.y,
                    p.z,
                    coalesce(p.position_source, 'unassigned') AS position_source,
                    coalesce(p.locked, 0) AS position_locked
                FROM requirement_nodes n
                LEFT JOIN (
                    SELECT dataset_id, requirement_id, count(*) AS item_count
                    FROM requirement_source_links
                    WHERE dataset_id = ? AND requirement_id = ?
                    GROUP BY dataset_id, requirement_id
                ) e ON e.dataset_id = n.dataset_id AND e.requirement_id = n.requirement_id
                LEFT JOIN (
                    SELECT dataset_id, requirement_id, count(*) AS item_count
                    FROM acceptance_criteria
                    WHERE dataset_id = ? AND requirement_id = ?
                    GROUP BY dataset_id, requirement_id
                ) c ON c.dataset_id = n.dataset_id AND c.requirement_id = n.requirement_id
                LEFT JOIN (
                    SELECT dataset_id, requirement_id, count(*) AS item_count
                    FROM open_question_requirement_links
                    WHERE dataset_id = ? AND requirement_id = ?
                    GROUP BY dataset_id, requirement_id
                ) q ON q.dataset_id = n.dataset_id AND q.requirement_id = n.requirement_id
                LEFT JOIN (
                    SELECT
                        dataset_id,
                        requirement_id,
                        json_group_array(scope_value_id) AS scope_value_ids
                    FROM requirement_scope_links
                    WHERE dataset_id = ? AND requirement_id = ?
                    GROUP BY dataset_id, requirement_id
                ) s ON s.dataset_id = n.dataset_id AND s.requirement_id = n.requirement_id
                LEFT JOIN graph_layout_positions p
                  ON p.dataset_id = n.dataset_id
                 AND p.graph_view_id = 'GV-BUSINESS-DEFAULT'
                 AND p.node_kind = 'business_requirement'
                 AND p.node_id = n.requirement_id
                WHERE n.dataset_id = ? AND n.requirement_id = ?
                """,
                (
                    dataset_id,
                    requirement_id,
                    dataset_id,
                    requirement_id,
                    dataset_id,
                    requirement_id,
                    dataset_id,
                    requirement_id,
                    dataset_id,
                    requirement_id,
                ),
            ).fetchone()
            if node_row is None:
                raise RequirementNotFoundError(
                    f"Requirement {requirement_id} was not found in the selected dataset."
                )
            edge_rows = connection.execute(
                """
                SELECT
                    requirement_relation_id,
                    parent_requirement_id,
                    child_requirement_id,
                    relation_kind,
                    display_order,
                    rationale,
                    origin_kind
                FROM requirement_relations
                WHERE dataset_id = ?
                  AND (parent_requirement_id = ? OR child_requirement_id = ?)
                ORDER BY requirement_relation_id
                """,
                (dataset_id, requirement_id, requirement_id),
            ).fetchall()
            edges = [_edge_from_row(_row(row)) for row in edge_rows]
            return BusinessRequirementDetailData(
                dataset_id=dataset_id,
                requirement=_node_from_row(_node_mapping(node_row)),
                relations=RequirementRelations(
                    parents=[edge for edge in edges if edge.target_node_id == requirement_id],
                    children=[edge for edge in edges if edge.source_node_id == requirement_id],
                ),
                aliases=_aliases(connection, dataset_id, requirement_id),
                evidence=_evidence(connection, dataset_id, requirement_id),
                scopes=_scopes(connection, dataset_id, requirement_id),
                acceptance_criteria=_criteria(connection, dataset_id, requirement_id),
                open_questions=_questions(connection, dataset_id, requirement_id),
            )
        finally:
            connection.close()

    async def get_graph(
        self,
        dataset_id: str,
        view_id: str,
    ) -> BusinessRequirementsGraphSnapshot:
        try:
            return await asyncio.to_thread(self._read_graph, dataset_id, view_id)
        except BusinessRequirementsQueryError:
            raise
        except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
            logger.error("business requirements graph query failed: %s", type(exc).__name__)
            raise BusinessRequirementsUnavailableError() from None

    async def get_detail(
        self,
        dataset_id: str,
        requirement_id: str,
    ) -> BusinessRequirementDetailData:
        try:
            return await asyncio.to_thread(self._read_detail, dataset_id, requirement_id)
        except BusinessRequirementsQueryError:
            raise
        except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
            logger.error("business requirement detail query failed: %s", type(exc).__name__)
            raise BusinessRequirementsUnavailableError() from None

    async def close(self) -> None:
        return None


def _node_mapping(row: sqlite3.Row) -> dict[str, Any]:
    mapping = _row(row)
    mapping["atomic"] = _as_bool(mapping["atomic"])
    mapping["customer_visible"] = _as_bool(mapping["customer_visible"])
    mapping["needs_confirmation"] = _as_bool(mapping["needs_confirmation"])
    mapping["position_locked"] = _as_bool(mapping["position_locked"])
    scope_value_ids = mapping["scope_value_ids"]
    if isinstance(scope_value_ids, str):
        mapping["scope_value_ids"] = json.loads(scope_value_ids)
    return mapping


def _aliases(
    connection: sqlite3.Connection,
    dataset_id: str,
    requirement_id: str,
) -> list[RequirementAlias]:
    rows = connection.execute(
        """
        SELECT requirement_alias_id, alternate_name, alias_kind, note
        FROM requirement_aliases
        WHERE dataset_id = ? AND requirement_id = ?
        ORDER BY requirement_alias_id
        """,
        (dataset_id, requirement_id),
    ).fetchall()
    return [RequirementAlias.model_validate(_row(row)) for row in rows]


def _evidence(
    connection: sqlite3.Connection,
    dataset_id: str,
    requirement_id: str,
) -> list[RequirementEvidence]:
    rows = connection.execute(
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
        FROM requirement_source_links links
        JOIN source_evidence evidence
          ON evidence.dataset_id = links.dataset_id
         AND evidence.source_evidence_id = links.source_evidence_id
        JOIN source_documents documents
          ON documents.dataset_id = evidence.dataset_id
         AND documents.source_document_id = evidence.source_document_id
        WHERE links.dataset_id = ? AND links.requirement_id = ?
        ORDER BY documents.authority_rank, evidence.source_evidence_id,
                 links.requirement_source_link_id
        """,
        (dataset_id, requirement_id),
    ).fetchall()
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


def _scopes(
    connection: sqlite3.Connection,
    dataset_id: str,
    requirement_id: str,
) -> list[RequirementScope]:
    rows = connection.execute(
        """
        SELECT
            links.requirement_scope_link_id,
            links.applicability,
            links.inherit_to_descendants,
            dimensions.scope_dimension_id,
            dimensions.name AS dimension_name,
            scope_vals.scope_value_id,
            scope_vals.name AS value_name,
            scope_vals.status AS value_status
        FROM requirement_scope_links links
        JOIN scope_values scope_vals
          ON scope_vals.dataset_id = links.dataset_id
         AND scope_vals.scope_value_id = links.scope_value_id
        JOIN scope_dimensions dimensions
          ON dimensions.dataset_id = scope_vals.dataset_id
         AND dimensions.scope_dimension_id = scope_vals.scope_dimension_id
        WHERE links.dataset_id = ? AND links.requirement_id = ?
        ORDER BY dimensions.scope_dimension_id, scope_vals.scope_value_id
        """,
        (dataset_id, requirement_id),
    ).fetchall()
    return [
        RequirementScope(
            requirement_scope_link_id=row["requirement_scope_link_id"],
            applicability=row["applicability"],
            inherit_to_descendants=_as_bool(row["inherit_to_descendants"]),
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


def _criteria(
    connection: sqlite3.Connection,
    dataset_id: str,
    requirement_id: str,
) -> list[AcceptanceCriterion]:
    rows = connection.execute(
        """
        SELECT
            acceptance_criterion_id,
            criterion_statement,
            criterion_status,
            threshold,
            measurement_method,
            origin_kind
        FROM acceptance_criteria
        WHERE dataset_id = ? AND requirement_id = ?
        ORDER BY acceptance_criterion_id
        """,
        (dataset_id, requirement_id),
    ).fetchall()
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


def _questions(
    connection: sqlite3.Connection,
    dataset_id: str,
    requirement_id: str,
) -> list[OpenQuestion]:
    rows = connection.execute(
        """
        SELECT
            questions.open_question_id,
            questions.question,
            questions.blocking_kind,
            questions.status
        FROM open_question_requirement_links links
        JOIN open_questions questions
          ON questions.dataset_id = links.dataset_id
         AND questions.open_question_id = links.open_question_id
        WHERE links.dataset_id = ? AND links.requirement_id = ?
        ORDER BY questions.open_question_id
        """,
        (dataset_id, requirement_id),
    ).fetchall()
    return [OpenQuestion.model_validate(_row(row)) for row in rows]
