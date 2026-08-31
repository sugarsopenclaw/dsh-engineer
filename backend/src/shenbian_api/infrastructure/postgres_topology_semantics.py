from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from shenbian_api.application.topology_semantic_errors import (
    TopologySemanticConflictError,
    TopologySemanticNotFoundError,
    TopologySemanticsError,
    TopologySemanticsUnavailableError,
)
from shenbian_api.core.config import Settings
from shenbian_api.domain.topology_semantics import (
    DrawingContext,
    EvidenceAsset,
    ModelProvenance,
    SemanticDescriptionCreateRequest,
    SemanticDescriptionDetailResponse,
    SemanticDescriptionListResponse,
    SemanticDescriptionRecord,
    SemanticDescriptionWriteResponse,
    SemanticSearchItem,
    SemanticSearchResponse,
    TopologyFingerprint,
    TopologyMatchItem,
    TopologyMatchRequest,
    TopologyMatchResponse,
    TopologyObservationCreateRequest,
    TopologyObservationDetailResponse,
    TopologyObservationRecord,
    TopologyObservationWriteResponse,
    TopologyPatternDetail,
    TopologyPatternDetailResponse,
    TopologyPatternListResponse,
    TopologyPatternRecord,
    TopologySemanticLinkRecord,
)
from shenbian_api.infrastructure.database import create_postgres_engine

SCHEMA = "ontology"

PATTERN_COLUMNS = """
    p.pattern_id,
    p.knowledge_scope,
    p.fingerprint_schema_version,
    p.scope_kind,
    p.graph_hash,
    p.shape_hash,
    p.metric_hash,
    p.invariances,
    p.feature_summary,
    p.canonical_payload,
    p.created_at,
    count(o.observation_id)::integer AS observation_count,
    coalesce(max(o.created_at), p.created_at) AS last_observed_at
"""

PATTERN_BY_ID = sa.text(
    f"""
    SELECT {PATTERN_COLUMNS}
    FROM {SCHEMA}.topology_patterns p
    LEFT JOIN {SCHEMA}.topology_observations o ON o.pattern_id = p.pattern_id
    WHERE p.pattern_id = :pattern_id
    GROUP BY p.pattern_id
    """
)

OBSERVATION_COLUMNS = """
    observation_id,
    pattern_id,
    knowledge_scope,
    ingestion_key,
    workflow_kind,
    review_run_id,
    group_id,
    drawing,
    selection,
    plots,
    bom_context,
    capability_evidence,
    artifact_refs,
    provenance,
    payload_sha256,
    created_at
"""

DESCRIPTION_COLUMNS = """
    description_id,
    knowledge_scope,
    description_key,
    description_kind,
    content_md,
    structured_content,
    source_kind,
    model_provenance,
    evidence_refs,
    supersedes_description_id,
    content_sha256,
    created_at
"""
QUALIFIED_DESCRIPTION_COLUMNS = ", ".join(
    f"d.{column.strip()}" for column in DESCRIPTION_COLUMNS.split(",") if column.strip()
)

LINK_COLUMNS = """
    link_id,
    pattern_id,
    observation_id,
    description_id,
    relation_kind,
    link_context,
    created_at
"""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}-{digest[:32]}"


def _pattern_record(row: Mapping[str, Any]) -> TopologyPatternRecord:
    return TopologyPatternRecord(
        pattern_id=row["pattern_id"],
        knowledge_scope=row["knowledge_scope"],
        fingerprint=TopologyFingerprint(
            fingerprint_schema_version=row["fingerprint_schema_version"],
            scope_kind=row["scope_kind"],
            graph_hash=row["graph_hash"],
            shape_hash=row["shape_hash"],
            metric_hash=row["metric_hash"],
            invariances=list(row["invariances"] or []),
            feature_summary=dict(row["feature_summary"] or {}),
            canonical_payload=dict(row["canonical_payload"] or {}),
        ),
        observation_count=row["observation_count"],
        created_at=row["created_at"],
        last_observed_at=row["last_observed_at"],
    )


def _observation_record(row: Mapping[str, Any]) -> TopologyObservationRecord:
    return TopologyObservationRecord(
        observation_id=row["observation_id"],
        pattern_id=row["pattern_id"],
        knowledge_scope=row["knowledge_scope"],
        ingestion_key=row["ingestion_key"],
        workflow_kind=row["workflow_kind"],
        review_run_id=row["review_run_id"],
        group_id=row["group_id"],
        drawing=DrawingContext.model_validate(row["drawing"]),
        selection=dict(row["selection"] or {}),
        plots=[EvidenceAsset.model_validate(item) for item in row["plots"] or []],
        bom_context=dict(row["bom_context"] or {}),
        capability_evidence=dict(row["capability_evidence"] or {}),
        artifact_refs=list(row["artifact_refs"] or []),
        provenance=dict(row["provenance"] or {}),
        payload_sha256=row["payload_sha256"],
        created_at=row["created_at"],
    )


def _description_record(row: Mapping[str, Any]) -> SemanticDescriptionRecord:
    provenance = row["model_provenance"]
    return SemanticDescriptionRecord(
        description_id=row["description_id"],
        knowledge_scope=row["knowledge_scope"],
        description_key=row["description_key"],
        description_kind=row["description_kind"],
        content_md=row["content_md"],
        structured_content=dict(row["structured_content"] or {}),
        source_kind=row["source_kind"],
        model_provenance=(
            ModelProvenance.model_validate(provenance) if provenance is not None else None
        ),
        evidence_refs=list(row["evidence_refs"] or []),
        supersedes_description_id=row["supersedes_description_id"],
        content_sha256=row["content_sha256"],
        created_at=row["created_at"],
    )


def _link_record(row: Mapping[str, Any]) -> TopologySemanticLinkRecord:
    return TopologySemanticLinkRecord(
        link_id=row["link_id"],
        pattern_id=row["pattern_id"],
        observation_id=row["observation_id"],
        description_id=row["description_id"],
        relation_kind=row["relation_kind"],
        link_context=dict(row["link_context"] or {}),
        created_at=row["created_at"],
    )


class PostgresTopologySemanticsRepository:
    def __init__(self, settings: Settings) -> None:
        self._engine: AsyncEngine = create_postgres_engine(
            settings.database_url.get_secret_value()
        )

    async def _pattern(self, connection: AsyncConnection, pattern_id: str) -> TopologyPatternRecord:
        row = (
            (await connection.execute(PATTERN_BY_ID, {"pattern_id": pattern_id}))
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise TopologySemanticNotFoundError(f"Topology pattern {pattern_id} was not found.")
        return _pattern_record(row)

    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse:
        fingerprint = request.topology
        pattern_id = _stable_id(
            "topo",
            request.knowledge_scope,
            fingerprint.fingerprint_schema_version,
            fingerprint.scope_kind,
            fingerprint.graph_hash,
            fingerprint.shape_hash,
            fingerprint.metric_hash,
        )
        observation_id = _stable_id(
            "obs",
            request.knowledge_scope,
            request.ingestion_key,
        )
        payload_sha256 = _sha256(request.model_dump(mode="json"))
        try:
            async with self._engine.begin() as connection:
                pattern_inserted = (
                    await connection.execute(
                        sa.text(
                            f"""
                            INSERT INTO {SCHEMA}.topology_patterns (
                                pattern_id, knowledge_scope, fingerprint_schema_version,
                                scope_kind, graph_hash, shape_hash, metric_hash,
                                invariances, feature_summary, canonical_payload
                            ) VALUES (
                                :pattern_id, :knowledge_scope, :fingerprint_schema_version,
                                :scope_kind, :graph_hash, :shape_hash, :metric_hash,
                                CAST(:invariances AS text[]), CAST(:feature_summary AS jsonb),
                                CAST(:canonical_payload AS jsonb)
                            )
                            ON CONFLICT ON CONSTRAINT uq_topology_patterns_fingerprint DO NOTHING
                            RETURNING pattern_id
                            """
                        ),
                        {
                            "pattern_id": pattern_id,
                            "knowledge_scope": request.knowledge_scope,
                            "fingerprint_schema_version": fingerprint.fingerprint_schema_version,
                            "scope_kind": fingerprint.scope_kind,
                            "graph_hash": fingerprint.graph_hash,
                            "shape_hash": fingerprint.shape_hash,
                            "metric_hash": fingerprint.metric_hash,
                            "invariances": fingerprint.invariances,
                            "feature_summary": _canonical_json(fingerprint.feature_summary),
                            "canonical_payload": _canonical_json(fingerprint.canonical_payload),
                        },
                    )
                ).scalar_one_or_none()
                if pattern_inserted is None:
                    existing_pattern = (
                        (
                            await connection.execute(
                                sa.text(
                                    f"""
                                    SELECT
                                        pattern_id,
                                        invariances,
                                        feature_summary,
                                        canonical_payload
                                    FROM {SCHEMA}.topology_patterns
                                    WHERE knowledge_scope = :knowledge_scope
                                      AND fingerprint_schema_version = :fingerprint_schema_version
                                      AND scope_kind = :scope_kind
                                      AND graph_hash = :graph_hash
                                      AND shape_hash = :shape_hash
                                      AND metric_hash = :metric_hash
                                    """
                                ),
                                {
                                    "knowledge_scope": request.knowledge_scope,
                                    "fingerprint_schema_version": (
                                        fingerprint.fingerprint_schema_version
                                    ),
                                    "scope_kind": fingerprint.scope_kind,
                                    "graph_hash": fingerprint.graph_hash,
                                    "shape_hash": fingerprint.shape_hash,
                                    "metric_hash": fingerprint.metric_hash,
                                },
                            )
                        )
                        .mappings()
                        .one()
                    )
                    pattern_id = existing_pattern["pattern_id"]
                    if (
                        list(existing_pattern["invariances"] or []) != fingerprint.invariances
                        or dict(existing_pattern["feature_summary"] or {})
                        != fingerprint.feature_summary
                        or dict(existing_pattern["canonical_payload"] or {})
                        != fingerprint.canonical_payload
                    ):
                        raise TopologySemanticConflictError(
                            "The fingerprint hashes already exist with a different "
                            "canonical payload."
                        )

                observation_inserted = (
                    await connection.execute(
                        sa.text(
                            f"""
                            INSERT INTO {SCHEMA}.topology_observations (
                                observation_id, pattern_id, knowledge_scope, ingestion_key,
                                workflow_kind, review_run_id, group_id, drawing, selection,
                                plots, bom_context, capability_evidence, artifact_refs,
                                provenance, payload_sha256
                            ) VALUES (
                                :observation_id, :pattern_id, :knowledge_scope, :ingestion_key,
                                :workflow_kind, :review_run_id, :group_id,
                                CAST(:drawing AS jsonb), CAST(:selection AS jsonb),
                                CAST(:plots AS jsonb), CAST(:bom_context AS jsonb),
                                CAST(:capability_evidence AS jsonb), CAST(:artifact_refs AS text[]),
                                CAST(:provenance AS jsonb), :payload_sha256
                            )
                            ON CONFLICT ON CONSTRAINT uq_topology_observations_ingestion_key
                            DO NOTHING
                            RETURNING observation_id
                            """
                        ),
                        {
                            "observation_id": observation_id,
                            "pattern_id": pattern_id,
                            "knowledge_scope": request.knowledge_scope,
                            "ingestion_key": request.ingestion_key,
                            "workflow_kind": request.workflow_kind,
                            "review_run_id": request.review_run_id,
                            "group_id": request.group_id,
                            "drawing": _canonical_json(request.drawing.model_dump(mode="json")),
                            "selection": _canonical_json(request.selection),
                            "plots": _canonical_json(
                                [item.model_dump(mode="json") for item in request.plots]
                            ),
                            "bom_context": _canonical_json(request.bom_context),
                            "capability_evidence": _canonical_json(request.capability_evidence),
                            "artifact_refs": request.artifact_refs,
                            "provenance": _canonical_json(request.provenance),
                            "payload_sha256": payload_sha256,
                        },
                    )
                ).scalar_one_or_none()
                row = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {OBSERVATION_COLUMNS}
                                FROM {SCHEMA}.topology_observations
                                WHERE knowledge_scope = :knowledge_scope
                                  AND ingestion_key = :ingestion_key
                                """
                            ),
                            {
                                "knowledge_scope": request.knowledge_scope,
                                "ingestion_key": request.ingestion_key,
                            },
                        )
                    )
                    .mappings()
                    .one()
                )
                if row["payload_sha256"] != payload_sha256:
                    raise TopologySemanticConflictError(
                        "The observation ingestion key already exists with different content."
                    )
                pattern = await self._pattern(connection, pattern_id)
                return TopologyObservationWriteResponse(
                    created=observation_inserted is not None,
                    pattern_created=pattern_inserted is not None,
                    pattern=pattern,
                    observation=_observation_record(row),
                )
        except TopologySemanticsError:
            raise
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse:
        description_id = _stable_id(
            "semantic",
            request.knowledge_scope,
            request.description_key,
        )
        content_sha256 = _sha256(request.model_dump(mode="json"))
        try:
            async with self._engine.begin() as connection:
                observation_rows = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT observation_id, pattern_id, ingestion_key
                                FROM {SCHEMA}.topology_observations
                                WHERE knowledge_scope = :knowledge_scope
                                  AND ingestion_key = ANY(CAST(:observation_keys AS text[]))
                                ORDER BY ingestion_key
                                """
                            ),
                            {
                                "knowledge_scope": request.knowledge_scope,
                                "observation_keys": request.observation_keys,
                            },
                        )
                    )
                    .mappings()
                    .all()
                )
                found = {row["ingestion_key"] for row in observation_rows}
                missing = [key for key in request.observation_keys if key not in found]
                if missing:
                    raise TopologySemanticNotFoundError(
                        f"Topology observations were not found: {', '.join(missing)}"
                    )

                inserted = (
                    await connection.execute(
                        sa.text(
                            f"""
                            INSERT INTO {SCHEMA}.semantic_descriptions (
                                description_id, knowledge_scope, description_key,
                                description_kind, content_md, structured_content,
                                source_kind, model_provenance, evidence_refs,
                                supersedes_description_id, content_sha256
                            ) VALUES (
                                :description_id, :knowledge_scope, :description_key,
                                :description_kind, :content_md, CAST(:structured_content AS jsonb),
                                :source_kind, CAST(:model_provenance AS jsonb),
                                CAST(:evidence_refs AS text[]), :supersedes_description_id,
                                :content_sha256
                            )
                            ON CONFLICT ON CONSTRAINT uq_semantic_descriptions_key DO NOTHING
                            RETURNING description_id
                            """
                        ),
                        {
                            "description_id": description_id,
                            "knowledge_scope": request.knowledge_scope,
                            "description_key": request.description_key,
                            "description_kind": request.description_kind,
                            "content_md": request.content_md,
                            "structured_content": _canonical_json(request.structured_content),
                            "source_kind": request.source_kind,
                            "model_provenance": (
                                _canonical_json(request.model_provenance.model_dump(mode="json"))
                                if request.model_provenance
                                else None
                            ),
                            "evidence_refs": request.evidence_refs,
                            "supersedes_description_id": request.supersedes_description_id,
                            "content_sha256": content_sha256,
                        },
                    )
                ).scalar_one_or_none()
                description_row = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {DESCRIPTION_COLUMNS}
                                FROM {SCHEMA}.semantic_descriptions
                                WHERE knowledge_scope = :knowledge_scope
                                  AND description_key = :description_key
                                """
                            ),
                            {
                                "knowledge_scope": request.knowledge_scope,
                                "description_key": request.description_key,
                            },
                        )
                    )
                    .mappings()
                    .one()
                )
                if description_row["content_sha256"] != content_sha256:
                    raise TopologySemanticConflictError(
                        "The semantic description key already exists with different content."
                    )

                for observation in observation_rows:
                    link_id = _stable_id(
                        "topology-link",
                        observation["pattern_id"],
                        observation["observation_id"],
                        description_id,
                        request.relation_kind,
                    )
                    await connection.execute(
                        sa.text(
                            f"""
                            INSERT INTO {SCHEMA}.topology_semantic_links (
                                link_id, pattern_id, observation_id, description_id,
                                relation_kind, link_context
                            ) VALUES (
                                :link_id, :pattern_id, :observation_id, :description_id,
                                :relation_kind, CAST(:link_context AS jsonb)
                            )
                            ON CONFLICT ON CONSTRAINT uq_topology_semantic_links_relation
                            DO NOTHING
                            """
                        ),
                        {
                            "link_id": link_id,
                            "pattern_id": observation["pattern_id"],
                            "observation_id": observation["observation_id"],
                            "description_id": description_id,
                            "relation_kind": request.relation_kind,
                            "link_context": _canonical_json(request.link_context),
                        },
                    )
                links = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {LINK_COLUMNS}
                                FROM {SCHEMA}.topology_semantic_links
                                WHERE description_id = :description_id
                                ORDER BY link_id
                                """
                            ),
                            {"description_id": description_id},
                        )
                    )
                    .mappings()
                    .all()
                )
                return SemanticDescriptionWriteResponse(
                    created=inserted is not None,
                    description=_description_record(description_row),
                    links=[_link_record(row) for row in links],
                )
        except TopologySemanticsError:
            raise
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def _pattern_detail(
        self,
        connection: AsyncConnection,
        pattern_id: str,
    ) -> TopologyPatternDetail:
        pattern = await self._pattern(connection, pattern_id)
        observations = (
            (
                await connection.execute(
                    sa.text(
                        f"""
                        SELECT {OBSERVATION_COLUMNS}
                        FROM {SCHEMA}.topology_observations
                        WHERE pattern_id = :pattern_id
                        ORDER BY created_at, observation_id
                        """
                    ),
                    {"pattern_id": pattern_id},
                )
            )
            .mappings()
            .all()
        )
        descriptions = (
            (
                await connection.execute(
                    sa.text(
                        f"""
                        SELECT DISTINCT {QUALIFIED_DESCRIPTION_COLUMNS}
                        FROM {SCHEMA}.semantic_descriptions d
                        JOIN {SCHEMA}.topology_semantic_links l
                          ON l.description_id = d.description_id
                        WHERE l.pattern_id = :pattern_id
                        ORDER BY d.created_at, d.description_id
                        """
                    ),
                    {"pattern_id": pattern_id},
                )
            )
            .mappings()
            .all()
        )
        links = (
            (
                await connection.execute(
                    sa.text(
                        f"""
                        SELECT {LINK_COLUMNS}
                        FROM {SCHEMA}.topology_semantic_links
                        WHERE pattern_id = :pattern_id
                        ORDER BY created_at, link_id
                        """
                    ),
                    {"pattern_id": pattern_id},
                )
            )
            .mappings()
            .all()
        )
        return TopologyPatternDetail(
            pattern=pattern,
            observations=[_observation_record(row) for row in observations],
            descriptions=[_description_record(row) for row in descriptions],
            links=[_link_record(row) for row in links],
        )

    async def match(self, request: TopologyMatchRequest) -> TopologyMatchResponse:
        fingerprint = request.fingerprint
        try:
            async with self._engine.connect() as connection:
                rows = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT pattern_id, graph_hash, shape_hash, metric_hash
                                FROM {SCHEMA}.topology_patterns
                                WHERE knowledge_scope = :knowledge_scope
                                  AND fingerprint_schema_version = :fingerprint_schema_version
                                  AND scope_kind = :scope_kind
                                  AND (
                                      graph_hash = :graph_hash
                                      OR shape_hash = :shape_hash
                                      OR metric_hash = :metric_hash
                                  )
                                ORDER BY
                                    CASE
                                      WHEN metric_hash = :metric_hash THEN 0
                                      WHEN shape_hash = :shape_hash THEN 1
                                      ELSE 2
                                    END,
                                    pattern_id
                                LIMIT CAST(:limit AS integer)
                                """
                            ),
                            {
                                "knowledge_scope": request.knowledge_scope,
                                "fingerprint_schema_version": (
                                    fingerprint.fingerprint_schema_version
                                ),
                                "scope_kind": fingerprint.scope_kind,
                                "graph_hash": fingerprint.graph_hash,
                                "shape_hash": fingerprint.shape_hash,
                                "metric_hash": fingerprint.metric_hash,
                                "limit": request.limit,
                            },
                        )
                    )
                    .mappings()
                    .all()
                )
                items: list[TopologyMatchItem] = []
                for row in rows:
                    kinds: list[str] = []
                    if row["metric_hash"] == fingerprint.metric_hash:
                        kinds.append("metric_hash")
                    if row["shape_hash"] == fingerprint.shape_hash:
                        kinds.append("shape_hash")
                    if row["graph_hash"] == fingerprint.graph_hash:
                        kinds.append("graph_hash")
                    items.append(
                        TopologyMatchItem(
                            match_kinds=kinds,
                            detail=await self._pattern_detail(connection, row["pattern_id"]),
                        )
                    )
                return TopologyMatchResponse(items=items)
        except TopologySemanticsError:
            raise
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse:
        where = (
            "p.knowledge_scope = :knowledge_scope "
            "AND (CAST(:scope_kind AS text) IS NULL "
            "OR p.scope_kind = CAST(:scope_kind AS text))"
        )
        parameters = {
            "knowledge_scope": knowledge_scope,
            "scope_kind": scope_kind,
            "limit": limit,
            "offset": offset,
        }
        try:
            async with self._engine.connect() as connection:
                total = (
                    await connection.execute(
                        sa.text(
                            f"""
                            SELECT count(*)::integer
                            FROM {SCHEMA}.topology_patterns p
                            WHERE {where}
                            """
                        ),
                        parameters,
                    )
                ).scalar_one()
                rows = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {PATTERN_COLUMNS}
                                FROM {SCHEMA}.topology_patterns p
                                LEFT JOIN {SCHEMA}.topology_observations o
                                  ON o.pattern_id = p.pattern_id
                                WHERE {where}
                                GROUP BY p.pattern_id
                                ORDER BY last_observed_at DESC, p.pattern_id
                                LIMIT CAST(:limit AS integer) OFFSET CAST(:offset AS integer)
                                """
                            ),
                            parameters,
                        )
                    )
                    .mappings()
                    .all()
                )
                return TopologyPatternListResponse(
                    total=total,
                    limit=limit,
                    offset=offset,
                    items=[_pattern_record(row) for row in rows],
                )
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse:
        parameters = {
            "knowledge_scope": knowledge_scope,
            "description_kind": description_kind,
            "limit": limit,
            "offset": offset,
        }
        where = (
            "knowledge_scope = :knowledge_scope "
            "AND (CAST(:description_kind AS text) IS NULL "
            "OR description_kind = CAST(:description_kind AS text))"
        )
        try:
            async with self._engine.connect() as connection:
                total = (
                    await connection.execute(
                        sa.text(
                            f"""
                            SELECT count(*)::integer
                            FROM {SCHEMA}.semantic_descriptions
                            WHERE {where}
                            """
                        ),
                        parameters,
                    )
                ).scalar_one()
                rows = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {DESCRIPTION_COLUMNS}
                                FROM {SCHEMA}.semantic_descriptions
                                WHERE {where}
                                ORDER BY created_at, description_id
                                LIMIT CAST(:limit AS integer)
                                OFFSET CAST(:offset AS integer)
                                """
                            ),
                            parameters,
                        )
                    )
                    .mappings()
                    .all()
                )
                return SemanticDescriptionListResponse(
                    total=total,
                    limit=limit,
                    offset=offset,
                    items=[_description_record(row) for row in rows],
                )
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def pattern_detail(self, pattern_id: str) -> TopologyPatternDetailResponse:
        try:
            async with self._engine.connect() as connection:
                return TopologyPatternDetailResponse(
                    detail=await self._pattern_detail(connection, pattern_id)
                )
        except TopologySemanticsError:
            raise
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def description_detail(
        self,
        description_id: str,
    ) -> SemanticDescriptionDetailResponse:
        try:
            async with self._engine.connect() as connection:
                description = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {DESCRIPTION_COLUMNS}
                                FROM {SCHEMA}.semantic_descriptions
                                WHERE description_id = :description_id
                                """
                            ),
                            {"description_id": description_id},
                        )
                    )
                    .mappings()
                    .one_or_none()
                )
                if description is None:
                    raise TopologySemanticNotFoundError(
                        f"Semantic description {description_id} was not found."
                    )
                links = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {LINK_COLUMNS}
                                FROM {SCHEMA}.topology_semantic_links
                                WHERE description_id = :description_id
                                ORDER BY link_id
                                """
                            ),
                            {"description_id": description_id},
                        )
                    )
                    .mappings()
                    .all()
                )
                pattern_ids = sorted({row["pattern_id"] for row in links})
                patterns = [
                    await self._pattern(connection, pattern_id)
                    for pattern_id in pattern_ids
                ]
                return SemanticDescriptionDetailResponse(
                    description=_description_record(description),
                    patterns=patterns,
                    links=[_link_record(row) for row in links],
                )
        except TopologySemanticsError:
            raise
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def observation_detail(
        self,
        observation_id: str,
    ) -> TopologyObservationDetailResponse:
        try:
            async with self._engine.connect() as connection:
                row = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {OBSERVATION_COLUMNS}
                                FROM {SCHEMA}.topology_observations
                                WHERE observation_id = :observation_id
                                """
                            ),
                            {"observation_id": observation_id},
                        )
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    raise TopologySemanticNotFoundError(
                        f"Topology observation {observation_id} was not found."
                    )
                descriptions = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT DISTINCT {QUALIFIED_DESCRIPTION_COLUMNS}
                                FROM {SCHEMA}.semantic_descriptions d
                                JOIN {SCHEMA}.topology_semantic_links l
                                  ON l.description_id = d.description_id
                                WHERE l.observation_id = :observation_id
                                ORDER BY d.created_at, d.description_id
                                """
                            ),
                            {"observation_id": observation_id},
                        )
                    )
                    .mappings()
                    .all()
                )
                return TopologyObservationDetailResponse(
                    observation=_observation_record(row),
                    descriptions=[_description_record(item) for item in descriptions],
                )
        except TopologySemanticsError:
            raise
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse:
        try:
            async with self._engine.connect() as connection:
                total = (
                    await connection.execute(
                        sa.text(
                            f"""
                            SELECT count(*)::integer
                            FROM {SCHEMA}.semantic_descriptions
                            WHERE knowledge_scope = :knowledge_scope
                              AND strpos(lower(content_md), lower(:query)) > 0
                            """
                        ),
                        {"knowledge_scope": knowledge_scope, "query": query},
                    )
                ).scalar_one()
                descriptions = (
                    (
                        await connection.execute(
                            sa.text(
                                f"""
                                SELECT {DESCRIPTION_COLUMNS}
                                FROM {SCHEMA}.semantic_descriptions
                                WHERE knowledge_scope = :knowledge_scope
                                  AND strpos(lower(content_md), lower(:query)) > 0
                                ORDER BY created_at DESC, description_id
                                LIMIT CAST(:limit AS integer)
                                """
                            ),
                            {
                                "knowledge_scope": knowledge_scope,
                                "query": query,
                                "limit": limit,
                            },
                        )
                    )
                    .mappings()
                    .all()
                )
                items: list[SemanticSearchItem] = []
                for description in descriptions:
                    pattern_rows = (
                        (
                            await connection.execute(
                                sa.text(
                                    f"""
                                    SELECT {PATTERN_COLUMNS}
                                    FROM {SCHEMA}.topology_patterns p
                                    LEFT JOIN {SCHEMA}.topology_observations o
                                      ON o.pattern_id = p.pattern_id
                                    WHERE p.pattern_id IN (
                                        SELECT pattern_id
                                        FROM {SCHEMA}.topology_semantic_links
                                        WHERE description_id = :description_id
                                    )
                                    GROUP BY p.pattern_id
                                    ORDER BY p.pattern_id
                                    """
                                ),
                                {"description_id": description["description_id"]},
                            )
                        )
                        .mappings()
                        .all()
                    )
                    items.append(
                        SemanticSearchItem(
                            description=_description_record(description),
                            patterns=[_pattern_record(row) for row in pattern_rows],
                        )
                    )
                return SemanticSearchResponse(query=query, total=total, items=items)
        except SQLAlchemyError as error:
            raise TopologySemanticsUnavailableError() from error

    async def close(self) -> None:
        await self._engine.dispose()
