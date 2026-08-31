from __future__ import annotations

from datetime import UTC, datetime

from conftest import (
    HealthyProbe,
    NoopBusinessRequirementsReader,
    NoopCadCapabilitiesReader,
)
from fastapi.testclient import TestClient

from shenbian_api.app_factory import create_app
from shenbian_api.application.topology_semantic_errors import (
    TopologySemanticConflictError,
)
from shenbian_api.domain.topology_semantics import (
    SemanticDescriptionCreateRequest,
    SemanticDescriptionDetailResponse,
    SemanticDescriptionListResponse,
    SemanticDescriptionRecord,
    SemanticDescriptionWriteResponse,
    SemanticSearchItem,
    SemanticSearchResponse,
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

NOW = datetime(2026, 8, 31, tzinfo=UTC)
GRAPH_HASH = "a" * 64
SHAPE_HASH = "b" * 64
METRIC_HASH = "c" * 64


def observation_payload() -> dict:
    return {
        "schema_version": "1.0",
        "knowledge_scope": "shenbian-transformer",
        "ingestion_key": "run-1/serial-annotation-group-028",
        "workflow_kind": "bom_close_reading",
        "review_run_id": "run-1",
        "group_id": "serial-annotation-group-028",
        "drawing": {
            "document_name": "5TBC.384.A110050.1_1.DWG",
            "document_ref": "client-data/transformer-design-drawings/example.dwg",
            "analysis_id": "cad-analysis-1",
            "dbmod": 21,
            "source_status": "dirty_current_session",
        },
        "topology": {
            "fingerprint_schema_version": "thcad-local-selection-v1",
            "scope_kind": "bom_target_component",
            "graph_hash": GRAPH_HASH,
            "shape_hash": SHAPE_HASH,
            "metric_hash": METRIC_HASH,
            "invariances": ["translation", "rotation", "reflection", "uniform_scale"],
            "feature_summary": {"occurrence_count": 18, "closed_count": 10},
            "canonical_payload": {"graph": {"edge_count": 18}},
        },
        "selection": {
            "target_point": [752.7, 5599.4],
            "selected_occurrences": [{"source_handle": "30A1B"}],
        },
        "plots": [
            {
                "role": "component_full",
                "artifact_ref": ".pi/runtime/thcad-reviews/runs/run-1/full.png",
                "media_type": "image/png",
                "sha256": "d" * 64,
                "metadata": {"width": 2048, "height": 2048},
            },
            {
                "role": "component_clean",
                "artifact_ref": ".pi/runtime/thcad-reviews/runs/run-1/clean.png",
                "media_type": "image/png",
                "sha256": "e" * 64,
                "metadata": {"width": 2048, "height": 2048},
            },
        ],
        "bom_context": {
            "item_numbers": [19, 20, 21],
            "items": [
                {"item_number": 19, "name": "板16×280×350"},
                {"item_number": 20, "name": "加强铁300×400×100×20"},
                {"item_number": 21, "name": "法兰"},
            ],
        },
        "capability_evidence": {
            "capability_21": {
                "status": "computed",
                "target_definition": {"handle": "30A03"},
            }
        },
        "artifact_refs": ["artifact:04", "artifact:21"],
        "provenance": {"producer": "@shenbian/pi"},
    }


class RecordingTopologyRepository:
    def __init__(self) -> None:
        self.observation_request: TopologyObservationCreateRequest | None = None
        self.description_request: SemanticDescriptionCreateRequest | None = None
        self.closed = False

    def _records(self) -> tuple[TopologyPatternRecord, TopologyObservationRecord]:
        request = self.observation_request or TopologyObservationCreateRequest.model_validate(
            observation_payload()
        )
        pattern = TopologyPatternRecord(
            pattern_id="topo-1",
            knowledge_scope=request.knowledge_scope,
            fingerprint=request.topology,
            observation_count=1,
            created_at=NOW,
            last_observed_at=NOW,
        )
        observation = TopologyObservationRecord(
            observation_id="obs-1",
            pattern_id=pattern.pattern_id,
            knowledge_scope=request.knowledge_scope,
            ingestion_key=request.ingestion_key,
            workflow_kind=request.workflow_kind,
            review_run_id=request.review_run_id,
            group_id=request.group_id,
            drawing=request.drawing,
            selection=request.selection,
            plots=request.plots,
            bom_context=request.bom_context,
            capability_evidence=request.capability_evidence,
            artifact_refs=request.artifact_refs,
            provenance=request.provenance,
            payload_sha256="f" * 64,
            created_at=NOW,
        )
        return pattern, observation

    def _description(self) -> SemanticDescriptionRecord:
        request = self.description_request or SemanticDescriptionCreateRequest(
            description_key="run-1/vision/group-028",
            description_kind="vision_component_interpretation",
            content_md="19/20/21 共同组成法兰、垫板和加强铁装配。",
            source_kind="vision_model",
            observation_keys=["run-1/serial-annotation-group-028"],
        )
        return SemanticDescriptionRecord(
            description_id="semantic-1",
            knowledge_scope=request.knowledge_scope,
            description_key=request.description_key,
            description_kind=request.description_kind,
            content_md=request.content_md,
            structured_content=request.structured_content,
            source_kind=request.source_kind,
            model_provenance=request.model_provenance,
            evidence_refs=request.evidence_refs,
            supersedes_description_id=request.supersedes_description_id,
            content_sha256="1" * 64,
            created_at=NOW,
        )

    def _detail(self) -> TopologyPatternDetail:
        pattern, observation = self._records()
        description = self._description()
        link = TopologySemanticLinkRecord(
            link_id="link-1",
            pattern_id=pattern.pattern_id,
            observation_id=observation.observation_id,
            description_id=description.description_id,
            relation_kind="describes",
            link_context={},
            created_at=NOW,
        )
        return TopologyPatternDetail(
            pattern=pattern,
            observations=[observation],
            descriptions=[description],
            links=[link],
        )

    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse:
        self.observation_request = request
        pattern, observation = self._records()
        return TopologyObservationWriteResponse(
            created=True,
            pattern_created=True,
            pattern=pattern,
            observation=observation,
        )

    async def append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse:
        self.description_request = request
        detail = self._detail()
        return SemanticDescriptionWriteResponse(
            created=True,
            description=detail.descriptions[0],
            links=detail.links,
        )

    async def match(self, request: TopologyMatchRequest) -> TopologyMatchResponse:
        assert request.fingerprint.shape_hash == SHAPE_HASH
        return TopologyMatchResponse(
            items=[
                TopologyMatchItem(
                    match_kinds=["metric_hash", "shape_hash", "graph_hash"],
                    detail=self._detail(),
                )
            ]
        )

    async def list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse:
        del knowledge_scope, description_kind
        return SemanticDescriptionListResponse(
            total=1,
            limit=limit,
            offset=offset,
            items=[self._description()],
        )

    async def list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse:
        del knowledge_scope, scope_kind
        return TopologyPatternListResponse(
            total=1,
            limit=limit,
            offset=offset,
            items=[self._records()[0]],
        )

    async def pattern_detail(self, pattern_id: str) -> TopologyPatternDetailResponse:
        assert pattern_id == "topo-1"
        return TopologyPatternDetailResponse(detail=self._detail())

    async def description_detail(
        self,
        description_id: str,
    ) -> SemanticDescriptionDetailResponse:
        assert description_id == "semantic-1"
        detail = self._detail()
        return SemanticDescriptionDetailResponse(
            description=detail.descriptions[0],
            patterns=[detail.pattern],
            links=detail.links,
        )

    async def observation_detail(
        self,
        observation_id: str,
    ) -> TopologyObservationDetailResponse:
        assert observation_id == "obs-1"
        return TopologyObservationDetailResponse(
            observation=self._records()[1],
            descriptions=[self._description()],
        )

    async def search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse:
        del knowledge_scope, limit
        return SemanticSearchResponse(
            query=query,
            total=1,
            items=[
                SemanticSearchItem(
                    description=self._description(),
                    patterns=[self._records()[0]],
                )
            ],
        )

    async def close(self) -> None:
        self.closed = True


class ConflictTopologyRepository(RecordingTopologyRepository):
    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse:
        del request
        raise TopologySemanticConflictError("same key, different payload")


def topology_client(settings, deepseek_gateway, repository) -> TestClient:
    app = create_app(
        settings=settings,
        probes=[HealthyProbe("postgresql"), HealthyProbe("redis"), HealthyProbe("oss")],
        deepseek_gateway=deepseek_gateway,
        business_requirements_reader=NoopBusinessRequirementsReader(),
        cad_capabilities_reader=NoopCadCapabilitiesReader(),
        topology_semantics_repository=repository,
    )
    return TestClient(app)


def test_records_local_topology_plots_bom_21_and_vision_semantics(
    settings,
    deepseek_gateway,
) -> None:
    repository = RecordingTopologyRepository()
    with topology_client(settings, deepseek_gateway, repository) as client:
        response = client.post(
            "/api/v1/topology-semantics/observations",
            json=observation_payload(),
        )
        assert response.status_code == 200
        assert response.json()["observation"]["bom_context"]["item_numbers"] == [19, 20, 21]
        assert response.json()["observation"]["plots"][1]["role"] == "component_clean"
        assert repository.observation_request is not None
        assert repository.observation_request.capability_evidence["capability_21"]["status"] == (
            "computed"
        )

        description = {
            "schema_version": "1.0",
            "knowledge_scope": "shenbian-transformer",
            "description_key": "run-1/vision/group-028",
            "description_kind": "vision_component_interpretation",
            "content_md": "19/20/21 共同组成法兰、垫板和加强铁装配。",
            "structured_content": {"items": [19, 20, 21]},
            "source_kind": "vision_model",
            "model_provenance": {"model": "deepseek-v4-vision", "role": "bom_close_reading"},
            "evidence_refs": ["image:component-full", "image:component-clean"],
            "observation_keys": ["run-1/serial-annotation-group-028"],
            "relation_kind": "describes",
            "link_context": {"projection": "plan"},
        }
        response = client.post("/api/v1/topology-semantics/descriptions", json=description)
        assert response.status_code == 200
        assert response.json()["links"][0]["pattern_id"] == "topo-1"

        descriptions = client.get("/api/v1/topology-semantics/semantics")
        assert descriptions.status_code == 200
        assert descriptions.json()["items"][0]["description_key"] == (
            "run-1/vision/group-028"
        )

        description_detail = client.get(
            "/api/v1/topology-semantics/semantics/semantic-1"
        )
        assert description_detail.status_code == 200
        assert description_detail.json()["patterns"][0]["pattern_id"] == "topo-1"


def test_matches_hashes_and_semantic_text_returns_candidate_topology(
    settings,
    deepseek_gateway,
) -> None:
    repository = RecordingTopologyRepository()
    with topology_client(settings, deepseek_gateway, repository) as client:
        match = client.post(
            "/api/v1/topology-semantics/match",
            json={
                "schema_version": "1.0",
                "knowledge_scope": "shenbian-transformer",
                "fingerprint": observation_payload()["topology"],
                "limit": 10,
            },
        )
        assert match.status_code == 200
        assert match.json()["items"][0]["match_kinds"] == [
            "metric_hash",
            "shape_hash",
            "graph_hash",
        ]

        search = client.get(
            "/api/v1/topology-semantics/semantics/search",
            params={"query": "法兰"},
        )
        assert search.status_code == 200
        assert search.json()["items"][0]["patterns"][0]["pattern_id"] == "topo-1"


def test_idempotency_conflict_is_public_409(settings, deepseek_gateway) -> None:
    with topology_client(
        settings,
        deepseek_gateway,
        ConflictTopologyRepository(),
    ) as client:
        response = client.post(
            "/api/v1/topology-semantics/observations",
            json=observation_payload(),
        )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "topology_semantic_conflict"
