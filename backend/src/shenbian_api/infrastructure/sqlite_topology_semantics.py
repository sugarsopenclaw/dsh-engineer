from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sqlite3
from collections.abc import Mapping
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

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
from shenbian_api.infrastructure.sqlite_paths import resolve_sqlite_path

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topology_patterns (
    pattern_id TEXT PRIMARY KEY,
    knowledge_scope TEXT NOT NULL,
    fingerprint_schema_version TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    graph_hash TEXT NOT NULL,
    shape_hash TEXT NOT NULL,
    metric_hash TEXT NOT NULL,
    invariances TEXT NOT NULL,
    feature_summary TEXT NOT NULL,
    canonical_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
    UNIQUE (
        knowledge_scope,
        fingerprint_schema_version,
        scope_kind,
        graph_hash,
        shape_hash,
        metric_hash
    )
);

CREATE INDEX IF NOT EXISTS ix_topology_patterns_shape_hash
ON topology_patterns (knowledge_scope, fingerprint_schema_version, scope_kind, shape_hash);
CREATE INDEX IF NOT EXISTS ix_topology_patterns_graph_hash
ON topology_patterns (knowledge_scope, fingerprint_schema_version, scope_kind, graph_hash);
CREATE INDEX IF NOT EXISTS ix_topology_patterns_metric_hash
ON topology_patterns (knowledge_scope, fingerprint_schema_version, scope_kind, metric_hash);

CREATE TABLE IF NOT EXISTS topology_observations (
    observation_id TEXT PRIMARY KEY,
    pattern_id TEXT NOT NULL REFERENCES topology_patterns(pattern_id) ON DELETE RESTRICT,
    knowledge_scope TEXT NOT NULL,
    ingestion_key TEXT NOT NULL,
    workflow_kind TEXT NOT NULL,
    review_run_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    drawing TEXT NOT NULL,
    selection TEXT NOT NULL,
    plots TEXT NOT NULL,
    bom_context TEXT NOT NULL,
    capability_evidence TEXT NOT NULL,
    artifact_refs TEXT NOT NULL,
    provenance TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
    UNIQUE (knowledge_scope, ingestion_key)
);

CREATE INDEX IF NOT EXISTS ix_topology_observations_pattern
ON topology_observations (pattern_id, created_at);
CREATE INDEX IF NOT EXISTS ix_topology_observations_review_run
ON topology_observations (knowledge_scope, review_run_id, group_id);

CREATE TABLE IF NOT EXISTS semantic_descriptions (
    description_id TEXT PRIMARY KEY,
    knowledge_scope TEXT NOT NULL,
    description_key TEXT NOT NULL,
    description_kind TEXT NOT NULL,
    content_md TEXT NOT NULL,
    structured_content TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    model_provenance TEXT,
    evidence_refs TEXT NOT NULL,
    supersedes_description_id TEXT
        REFERENCES semantic_descriptions(description_id) ON DELETE SET NULL,
    content_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
    UNIQUE (knowledge_scope, description_key)
);

CREATE INDEX IF NOT EXISTS ix_semantic_descriptions_kind
ON semantic_descriptions (knowledge_scope, description_kind, created_at);

CREATE TABLE IF NOT EXISTS topology_semantic_links (
    link_id TEXT PRIMARY KEY,
    pattern_id TEXT NOT NULL REFERENCES topology_patterns(pattern_id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL REFERENCES topology_observations(observation_id) ON DELETE CASCADE,
    description_id TEXT NOT NULL REFERENCES semantic_descriptions(description_id) ON DELETE CASCADE,
    relation_kind TEXT NOT NULL,
    link_context TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
    UNIQUE (pattern_id, observation_id, description_id, relation_kind)
);

CREATE INDEX IF NOT EXISTS ix_topology_semantic_links_description
ON topology_semantic_links (description_id, pattern_id);
"""

PATTERN_FIELDS = """
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
    count(o.observation_id) AS observation_count,
    coalesce(max(o.created_at), p.created_at) AS last_observed_at
"""

OBSERVATION_FIELDS = """
    observation_id, pattern_id, knowledge_scope, ingestion_key, workflow_kind,
    review_run_id, group_id, drawing, selection, plots, bom_context,
    capability_evidence, artifact_refs, provenance, payload_sha256, created_at
"""

DESCRIPTION_FIELDS = """
    description_id, knowledge_scope, description_key, description_kind,
    content_md, structured_content, source_kind, model_provenance,
    evidence_refs, supersedes_description_id, content_sha256, created_at
"""
QUALIFIED_DESCRIPTION_FIELDS = ", ".join(
    f"d.{item.strip()}" for item in DESCRIPTION_FIELDS.split(",") if item.strip()
)

LINK_FIELDS = """
    link_id, pattern_id, observation_id, description_id,
    relation_kind, link_context, created_at
"""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}-{digest[:32]}"


def _loads(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(str(value))


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    target = f"file:{path.as_posix()}?mode=ro" if readonly else str(path)
    connection = sqlite3.connect(target, uri=readonly, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def initialize_topology_semantics_sqlite(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect(path)) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA_SQL)
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        connection.commit()


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
            invariances=list(_loads(row["invariances"], [])),
            feature_summary=dict(_loads(row["feature_summary"], {})),
            canonical_payload=dict(_loads(row["canonical_payload"], {})),
        ),
        observation_count=int(row["observation_count"]),
        created_at=_as_datetime(row["created_at"]),
        last_observed_at=_as_datetime(row["last_observed_at"]),
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
        drawing=DrawingContext.model_validate(_loads(row["drawing"], {})),
        selection=dict(_loads(row["selection"], {})),
        plots=[EvidenceAsset.model_validate(item) for item in _loads(row["plots"], [])],
        bom_context=dict(_loads(row["bom_context"], {})),
        capability_evidence=dict(_loads(row["capability_evidence"], {})),
        artifact_refs=list(_loads(row["artifact_refs"], [])),
        provenance=dict(_loads(row["provenance"], {})),
        payload_sha256=row["payload_sha256"],
        created_at=_as_datetime(row["created_at"]),
    )


def _description_record(row: Mapping[str, Any]) -> SemanticDescriptionRecord:
    provenance = _loads(row["model_provenance"], None)
    return SemanticDescriptionRecord(
        description_id=row["description_id"],
        knowledge_scope=row["knowledge_scope"],
        description_key=row["description_key"],
        description_kind=row["description_kind"],
        content_md=row["content_md"],
        structured_content=dict(_loads(row["structured_content"], {})),
        source_kind=row["source_kind"],
        model_provenance=(
            ModelProvenance.model_validate(provenance) if provenance is not None else None
        ),
        evidence_refs=list(_loads(row["evidence_refs"], [])),
        supersedes_description_id=row["supersedes_description_id"],
        content_sha256=row["content_sha256"],
        created_at=_as_datetime(row["created_at"]),
    )


def _link_record(row: Mapping[str, Any]) -> TopologySemanticLinkRecord:
    return TopologySemanticLinkRecord(
        link_id=row["link_id"],
        pattern_id=row["pattern_id"],
        observation_id=row["observation_id"],
        description_id=row["description_id"],
        relation_kind=row["relation_kind"],
        link_context=dict(_loads(row["link_context"], {})),
        created_at=_as_datetime(row["created_at"]),
    )


class SqliteTopologySemanticsRepository:
    def __init__(self, settings: Settings) -> None:
        self._path = resolve_sqlite_path(settings.topology_semantics_sqlite)
        initialize_topology_semantics_sqlite(self._path)

    def _pattern(self, connection: sqlite3.Connection, pattern_id: str) -> TopologyPatternRecord:
        row = connection.execute(
            f"""
            SELECT {PATTERN_FIELDS}
            FROM topology_patterns p
            LEFT JOIN topology_observations o ON o.pattern_id = p.pattern_id
            WHERE p.pattern_id = ?
            GROUP BY p.pattern_id
            """,
            (pattern_id,),
        ).fetchone()
        if row is None:
            raise TopologySemanticNotFoundError(f"Topology pattern {pattern_id} was not found.")
        return _pattern_record(row)

    def _register_observation(
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
        observation_id = _stable_id("obs", request.knowledge_scope, request.ingestion_key)
        payload_sha256 = _sha256(request.model_dump(mode="json"))
        with closing(_connect(self._path)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO topology_patterns (
                    pattern_id, knowledge_scope, fingerprint_schema_version,
                    scope_kind, graph_hash, shape_hash, metric_hash,
                    invariances, feature_summary, canonical_payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    pattern_id,
                    request.knowledge_scope,
                    fingerprint.fingerprint_schema_version,
                    fingerprint.scope_kind,
                    fingerprint.graph_hash,
                    fingerprint.shape_hash,
                    fingerprint.metric_hash,
                    _canonical_json(fingerprint.invariances),
                    _canonical_json(fingerprint.feature_summary),
                    _canonical_json(fingerprint.canonical_payload),
                ),
            )
            pattern_created = cursor.rowcount == 1
            existing_pattern = connection.execute(
                """
                SELECT pattern_id, invariances, feature_summary, canonical_payload
                FROM topology_patterns
                WHERE knowledge_scope = ?
                  AND fingerprint_schema_version = ?
                  AND scope_kind = ?
                  AND graph_hash = ?
                  AND shape_hash = ?
                  AND metric_hash = ?
                """,
                (
                    request.knowledge_scope,
                    fingerprint.fingerprint_schema_version,
                    fingerprint.scope_kind,
                    fingerprint.graph_hash,
                    fingerprint.shape_hash,
                    fingerprint.metric_hash,
                ),
            ).fetchone()
            if existing_pattern is None:
                raise TopologySemanticsUnavailableError()
            pattern_id = existing_pattern["pattern_id"]
            if (
                list(_loads(existing_pattern["invariances"], [])) != fingerprint.invariances
                or dict(_loads(existing_pattern["feature_summary"], {}))
                != fingerprint.feature_summary
                or dict(_loads(existing_pattern["canonical_payload"], {}))
                != fingerprint.canonical_payload
            ):
                raise TopologySemanticConflictError(
                    "The fingerprint hashes already exist with a different canonical payload."
                )

            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO topology_observations (
                    observation_id, pattern_id, knowledge_scope, ingestion_key,
                    workflow_kind, review_run_id, group_id, drawing, selection,
                    plots, bom_context, capability_evidence, artifact_refs,
                    provenance, payload_sha256
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    observation_id,
                    pattern_id,
                    request.knowledge_scope,
                    request.ingestion_key,
                    request.workflow_kind,
                    request.review_run_id,
                    request.group_id,
                    _canonical_json(request.drawing.model_dump(mode="json")),
                    _canonical_json(request.selection),
                    _canonical_json([item.model_dump(mode="json") for item in request.plots]),
                    _canonical_json(request.bom_context),
                    _canonical_json(request.capability_evidence),
                    _canonical_json(request.artifact_refs),
                    _canonical_json(request.provenance),
                    payload_sha256,
                ),
            )
            observation_created = cursor.rowcount == 1
            row = connection.execute(
                f"""
                SELECT {OBSERVATION_FIELDS}
                FROM topology_observations
                WHERE knowledge_scope = ? AND ingestion_key = ?
                """,
                (request.knowledge_scope, request.ingestion_key),
            ).fetchone()
            if row is None:
                raise TopologySemanticsUnavailableError()
            if row["payload_sha256"] != payload_sha256:
                raise TopologySemanticConflictError(
                    "The observation ingestion key already exists with different content."
                )
            return TopologyObservationWriteResponse(
                created=observation_created,
                pattern_created=pattern_created,
                pattern=self._pattern(connection, pattern_id),
                observation=_observation_record(row),
            )

    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse:
        try:
            return await asyncio.to_thread(self._register_observation, request)
        except TopologySemanticsError:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            logger.warning("SQLite topology observation write failed: %s", type(error).__name__)
            raise TopologySemanticsUnavailableError() from error

    def _append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse:
        description_id = _stable_id(
            "semantic", request.knowledge_scope, request.description_key
        )
        content_sha256 = _sha256(request.model_dump(mode="json"))
        placeholders = ",".join("?" for _ in request.observation_keys)
        with closing(_connect(self._path)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            observations = connection.execute(
                f"""
                SELECT observation_id, pattern_id, ingestion_key
                FROM topology_observations
                WHERE knowledge_scope = ? AND ingestion_key IN ({placeholders})
                ORDER BY ingestion_key
                """,
                (request.knowledge_scope, *request.observation_keys),
            ).fetchall()
            found = {row["ingestion_key"] for row in observations}
            missing = [key for key in request.observation_keys if key not in found]
            if missing:
                raise TopologySemanticNotFoundError(
                    f"Topology observations were not found: {', '.join(missing)}"
                )
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO semantic_descriptions (
                    description_id, knowledge_scope, description_key,
                    description_kind, content_md, structured_content,
                    source_kind, model_provenance, evidence_refs,
                    supersedes_description_id, content_sha256
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    description_id,
                    request.knowledge_scope,
                    request.description_key,
                    request.description_kind,
                    request.content_md,
                    _canonical_json(request.structured_content),
                    request.source_kind,
                    (
                        _canonical_json(request.model_provenance.model_dump(mode="json"))
                        if request.model_provenance
                        else None
                    ),
                    _canonical_json(request.evidence_refs),
                    request.supersedes_description_id,
                    content_sha256,
                ),
            )
            created = cursor.rowcount == 1
            description = connection.execute(
                f"""
                SELECT {DESCRIPTION_FIELDS}
                FROM semantic_descriptions
                WHERE knowledge_scope = ? AND description_key = ?
                """,
                (request.knowledge_scope, request.description_key),
            ).fetchone()
            if description is None:
                raise TopologySemanticsUnavailableError()
            if description["content_sha256"] != content_sha256:
                raise TopologySemanticConflictError(
                    "The semantic description key already exists with different content."
                )
            for observation in observations:
                link_id = _stable_id(
                    "topology-link",
                    observation["pattern_id"],
                    observation["observation_id"],
                    description_id,
                    request.relation_kind,
                )
                connection.execute(
                    """
                    INSERT OR IGNORE INTO topology_semantic_links (
                        link_id, pattern_id, observation_id, description_id,
                        relation_kind, link_context
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        link_id,
                        observation["pattern_id"],
                        observation["observation_id"],
                        description_id,
                        request.relation_kind,
                        _canonical_json(request.link_context),
                    ),
                )
            links = connection.execute(
                f"""
                SELECT {LINK_FIELDS}
                FROM topology_semantic_links
                WHERE description_id = ?
                ORDER BY link_id
                """,
                (description_id,),
            ).fetchall()
            return SemanticDescriptionWriteResponse(
                created=created,
                description=_description_record(description),
                links=[_link_record(row) for row in links],
            )

    async def append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse:
        try:
            return await asyncio.to_thread(self._append_description, request)
        except TopologySemanticsError:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            logger.warning("SQLite semantic description write failed: %s", type(error).__name__)
            raise TopologySemanticsUnavailableError() from error

    def _pattern_detail(
        self,
        connection: sqlite3.Connection,
        pattern_id: str,
    ) -> TopologyPatternDetail:
        pattern = self._pattern(connection, pattern_id)
        observations = connection.execute(
            f"""
            SELECT {OBSERVATION_FIELDS}
            FROM topology_observations
            WHERE pattern_id = ?
            ORDER BY created_at, observation_id
            """,
            (pattern_id,),
        ).fetchall()
        descriptions = connection.execute(
            f"""
            SELECT DISTINCT {QUALIFIED_DESCRIPTION_FIELDS}
            FROM semantic_descriptions d
            JOIN topology_semantic_links l ON l.description_id = d.description_id
            WHERE l.pattern_id = ?
            ORDER BY d.created_at, d.description_id
            """,
            (pattern_id,),
        ).fetchall()
        links = connection.execute(
            f"""
            SELECT {LINK_FIELDS}
            FROM topology_semantic_links
            WHERE pattern_id = ?
            ORDER BY created_at, link_id
            """,
            (pattern_id,),
        ).fetchall()
        return TopologyPatternDetail(
            pattern=pattern,
            observations=[_observation_record(row) for row in observations],
            descriptions=[_description_record(row) for row in descriptions],
            links=[_link_record(row) for row in links],
        )

    def _match(self, request: TopologyMatchRequest) -> TopologyMatchResponse:
        fingerprint = request.fingerprint
        with closing(_connect(self._path, readonly=True)) as connection:
            rows = connection.execute(
                """
                SELECT pattern_id, graph_hash, shape_hash, metric_hash
                FROM topology_patterns
                WHERE knowledge_scope = ?
                  AND fingerprint_schema_version = ?
                  AND scope_kind = ?
                  AND (graph_hash = ? OR shape_hash = ? OR metric_hash = ?)
                ORDER BY
                    CASE
                        WHEN metric_hash = ? THEN 0
                        WHEN shape_hash = ? THEN 1
                        ELSE 2
                    END,
                    pattern_id
                LIMIT ?
                """,
                (
                    request.knowledge_scope,
                    fingerprint.fingerprint_schema_version,
                    fingerprint.scope_kind,
                    fingerprint.graph_hash,
                    fingerprint.shape_hash,
                    fingerprint.metric_hash,
                    fingerprint.metric_hash,
                    fingerprint.shape_hash,
                    request.limit,
                ),
            ).fetchall()
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
                        detail=self._pattern_detail(connection, row["pattern_id"]),
                    )
                )
            return TopologyMatchResponse(items=items)

    async def match(self, request: TopologyMatchRequest) -> TopologyMatchResponse:
        try:
            return await asyncio.to_thread(self._match, request)
        except TopologySemanticsError:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    def _list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse:
        where = "p.knowledge_scope = ?"
        parameters: list[Any] = [knowledge_scope]
        if scope_kind is not None:
            where += " AND p.scope_kind = ?"
            parameters.append(scope_kind)
        with closing(_connect(self._path, readonly=True)) as connection:
            total = connection.execute(
                f"SELECT count(*) FROM topology_patterns p WHERE {where}",
                parameters,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT {PATTERN_FIELDS}
                FROM topology_patterns p
                LEFT JOIN topology_observations o ON o.pattern_id = p.pattern_id
                WHERE {where}
                GROUP BY p.pattern_id
                ORDER BY last_observed_at DESC, p.pattern_id
                LIMIT ? OFFSET ?
                """,
                (*parameters, limit, offset),
            ).fetchall()
            return TopologyPatternListResponse(
                total=total,
                limit=limit,
                offset=offset,
                items=[_pattern_record(row) for row in rows],
            )

    async def list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse:
        try:
            return await asyncio.to_thread(
                self._list_patterns, knowledge_scope, scope_kind, limit, offset
            )
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    def _list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse:
        where = "knowledge_scope = ?"
        parameters: list[Any] = [knowledge_scope]
        if description_kind is not None:
            where += " AND description_kind = ?"
            parameters.append(description_kind)
        with closing(_connect(self._path, readonly=True)) as connection:
            total = connection.execute(
                f"SELECT count(*) FROM semantic_descriptions WHERE {where}",
                parameters,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT {DESCRIPTION_FIELDS}
                FROM semantic_descriptions
                WHERE {where}
                ORDER BY created_at, description_id
                LIMIT ? OFFSET ?
                """,
                (*parameters, limit, offset),
            ).fetchall()
            return SemanticDescriptionListResponse(
                total=total,
                limit=limit,
                offset=offset,
                items=[_description_record(row) for row in rows],
            )

    async def list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse:
        try:
            return await asyncio.to_thread(
                self._list_descriptions,
                knowledge_scope,
                description_kind,
                limit,
                offset,
            )
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    def _pattern_detail_response(self, pattern_id: str) -> TopologyPatternDetailResponse:
        with closing(_connect(self._path, readonly=True)) as connection:
            return TopologyPatternDetailResponse(
                detail=self._pattern_detail(connection, pattern_id)
            )

    async def pattern_detail(self, pattern_id: str) -> TopologyPatternDetailResponse:
        try:
            return await asyncio.to_thread(self._pattern_detail_response, pattern_id)
        except TopologySemanticsError:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    def _description_detail(self, description_id: str) -> SemanticDescriptionDetailResponse:
        with closing(_connect(self._path, readonly=True)) as connection:
            description = connection.execute(
                f"SELECT {DESCRIPTION_FIELDS} FROM semantic_descriptions WHERE description_id = ?",
                (description_id,),
            ).fetchone()
            if description is None:
                raise TopologySemanticNotFoundError(
                    f"Semantic description {description_id} was not found."
                )
            links = connection.execute(
                f"""
                SELECT {LINK_FIELDS}
                FROM topology_semantic_links
                WHERE description_id = ?
                ORDER BY link_id
                """,
                (description_id,),
            ).fetchall()
            pattern_ids = sorted({row["pattern_id"] for row in links})
            return SemanticDescriptionDetailResponse(
                description=_description_record(description),
                patterns=[self._pattern(connection, pattern_id) for pattern_id in pattern_ids],
                links=[_link_record(row) for row in links],
            )

    async def description_detail(
        self,
        description_id: str,
    ) -> SemanticDescriptionDetailResponse:
        try:
            return await asyncio.to_thread(self._description_detail, description_id)
        except TopologySemanticsError:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    def _observation_detail(self, observation_id: str) -> TopologyObservationDetailResponse:
        with closing(_connect(self._path, readonly=True)) as connection:
            observation = connection.execute(
                f"SELECT {OBSERVATION_FIELDS} FROM topology_observations WHERE observation_id = ?",
                (observation_id,),
            ).fetchone()
            if observation is None:
                raise TopologySemanticNotFoundError(
                    f"Topology observation {observation_id} was not found."
                )
            descriptions = connection.execute(
                f"""
                SELECT DISTINCT {QUALIFIED_DESCRIPTION_FIELDS}
                FROM semantic_descriptions d
                JOIN topology_semantic_links l ON l.description_id = d.description_id
                WHERE l.observation_id = ?
                ORDER BY d.created_at, d.description_id
                """,
                (observation_id,),
            ).fetchall()
            return TopologyObservationDetailResponse(
                observation=_observation_record(observation),
                descriptions=[_description_record(row) for row in descriptions],
            )

    async def observation_detail(
        self,
        observation_id: str,
    ) -> TopologyObservationDetailResponse:
        try:
            return await asyncio.to_thread(self._observation_detail, observation_id)
        except TopologySemanticsError:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    def _search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse:
        with closing(_connect(self._path, readonly=True)) as connection:
            parameters = (knowledge_scope, query)
            total = connection.execute(
                """
                SELECT count(*)
                FROM semantic_descriptions
                WHERE knowledge_scope = ? AND instr(lower(content_md), lower(?)) > 0
                """,
                parameters,
            ).fetchone()[0]
            descriptions = connection.execute(
                f"""
                SELECT {DESCRIPTION_FIELDS}
                FROM semantic_descriptions
                WHERE knowledge_scope = ? AND instr(lower(content_md), lower(?)) > 0
                ORDER BY created_at DESC, description_id
                LIMIT ?
                """,
                (*parameters, limit),
            ).fetchall()
            items: list[SemanticSearchItem] = []
            for description in descriptions:
                pattern_rows = connection.execute(
                    f"""
                    SELECT {PATTERN_FIELDS}
                    FROM topology_patterns p
                    LEFT JOIN topology_observations o ON o.pattern_id = p.pattern_id
                    WHERE p.pattern_id IN (
                        SELECT pattern_id
                        FROM topology_semantic_links
                        WHERE description_id = ?
                    )
                    GROUP BY p.pattern_id
                    ORDER BY p.pattern_id
                    """,
                    (description["description_id"],),
                ).fetchall()
                items.append(
                    SemanticSearchItem(
                        description=_description_record(description),
                        patterns=[_pattern_record(row) for row in pattern_rows],
                    )
                )
            return SemanticSearchResponse(query=query, total=total, items=items)

    async def search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse:
        try:
            return await asyncio.to_thread(
                self._search_semantics, knowledge_scope, query, limit
            )
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            raise TopologySemanticsUnavailableError() from error

    async def close(self) -> None:
        return None
