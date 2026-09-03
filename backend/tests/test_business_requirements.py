from __future__ import annotations

import math
from datetime import UTC, datetime

from conftest import HealthyProbe
from fastapi.testclient import TestClient

from shenbian_api.app_factory import create_app
from shenbian_api.application.business_requirement_errors import (
    BusinessRequirementsUnavailableError,
    DatasetNotFoundError,
    GraphViewNotFoundError,
    RequirementNotFoundError,
)
from shenbian_api.application.business_requirements import (
    DEFAULT_BUSINESS_REQUIREMENTS_DATASET_ID,
    DEFAULT_BUSINESS_REQUIREMENTS_VIEW_ID,
    build_graph_response,
)
from shenbian_api.core.config import Settings
from shenbian_api.domain.business_requirements import (
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


def requirement_node(
    requirement_id: str,
    *,
    origin_kind: str,
    depth: int,
    atomic: bool = False,
    needs_confirmation: bool = False,
) -> RequirementNodeRecord:
    return RequirementNodeRecord(
        requirement_id=requirement_id,
        name=f"Requirement {requirement_id}",
        description=None,
        requirement_kind="functional" if atomic else "requirement_group",
        origin_kind=origin_kind,
        atomic=atomic,
        verification_method="Verify it" if atomic else None,
        priority_order=None,
        source_emphasis=None,
        customer_visible=True,
        needs_confirmation=needs_confirmation,
        lifecycle_status="discovery",
        derived_min_depth=depth,
        summary=RequirementNodeSummary(
            direct_evidence_count=1 if requirement_id == "BR-A01" else 0,
            acceptance_criterion_count=1 if atomic else 0,
            open_question_count=1 if requirement_id == "BR-A01" else 0,
            scope_value_ids=["SV-ORG-SB"] if requirement_id == "BR-A01" else [],
        ),
        stored_position=StoredGraphPosition(
            x=None,
            y=None,
            z=None,
            position_source="unassigned",
            locked=False,
        ),
    )


def graph_snapshot() -> BusinessRequirementsGraphSnapshot:
    nodes = [
        requirement_node("BR-000", origin_kind="normalized", depth=0),
        requirement_node("BR-A01", origin_kind="customer_stated", depth=1),
        requirement_node("BR-A01-N01", origin_kind="normalized", depth=2),
        requirement_node(
            "BR-A01-001",
            origin_kind="domain_decomposition",
            depth=2,
            atomic=True,
            needs_confirmation=True,
        ),
    ]
    edges = [
        BusinessRequirementGraphEdge(
            id="RR-BR-000-BR-A01",
            source_node_id="BR-000",
            target_node_id="BR-A01",
            relation_kind="contains_requirement",
            display_order=1,
            rationale=None,
            origin_kind="domain_modeling",
        ),
        BusinessRequirementGraphEdge(
            id="RR-BR-A01-BR-A01-N01",
            source_node_id="BR-A01",
            target_node_id="BR-A01-N01",
            relation_kind="decomposes_to",
            display_order=1,
            rationale=None,
            origin_kind="domain_modeling",
        ),
        BusinessRequirementGraphEdge(
            id="RR-BR-A01-BR-A01-001",
            source_node_id="BR-A01",
            target_node_id="BR-A01-001",
            relation_kind="decomposes_to",
            display_order=2,
            rationale=None,
            origin_kind="domain_modeling",
        ),
    ]
    return BusinessRequirementsGraphSnapshot(
        dataset=DatasetRecord(
            dataset_id=DEFAULT_BUSINESS_REQUIREMENTS_DATASET_ID,
            schema_version="1.0",
            imported_at=datetime(2026, 8, 27, tzinfo=UTC),
            content_sha256="0" * 64,
        ),
        view=GraphViewRecord(
            graph_view_id=DEFAULT_BUSINESS_REQUIREMENTS_VIEW_ID,
            name="Test graph",
            description="Test graph view",
            layout_algorithm=None,
            layout_version="unassigned",
        ),
        nodes=nodes,
        edges=edges,
    )


def requirement_detail(
    snapshot: BusinessRequirementsGraphSnapshot,
) -> BusinessRequirementDetailData:
    edge_by_id = {edge.id: edge for edge in snapshot.edges}
    return BusinessRequirementDetailData(
        dataset_id=snapshot.dataset.dataset_id,
        requirement=next(node for node in snapshot.nodes if node.requirement_id == "BR-A01"),
        relations=RequirementRelations(
            parents=[edge_by_id["RR-BR-000-BR-A01"]],
            children=[
                edge_by_id["RR-BR-A01-BR-A01-N01"],
                edge_by_id["RR-BR-A01-BR-A01-001"],
            ],
        ),
        aliases=[
            RequirementAlias(
                requirement_alias_id="RA-TEST",
                alternate_name="Test alias",
                alias_kind="source_wording",
                note=None,
            )
        ],
        evidence=[
            RequirementEvidence(
                requirement_source_link_id="RSL-TEST",
                link_kind="stated_in",
                source_evidence_id="EV-TEST",
                evidence_kind="customer_statement",
                locator={"sheet": "Sheet1", "cell": "D2"},
                verbatim_text="Customer statement",
                source_document=SourceDocumentSummary(
                    source_document_id="SRC-TEST",
                    name="requirements.xlsx",
                    source_kind="customer_primary",
                    authority_rank=1,
                ),
            )
        ],
        scopes=[
            RequirementScope(
                requirement_scope_link_id="RSC-TEST",
                applicability="includes",
                inherit_to_descendants=True,
                dimension=ScopeDimensionSummary(
                    scope_dimension_id="SD-ORG",
                    name="所属机构",
                ),
                value=ScopeValueSummary(
                    scope_value_id="SV-ORG-SB",
                    name="沈变",
                    status="observed",
                ),
            )
        ],
        acceptance_criteria=[],
        open_questions=[
            OpenQuestion(
                open_question_id="OQ-TEST",
                question="Confirm this?",
                blocking_kind="scope",
                status="open",
            )
        ],
    )


class FakeBusinessRequirementsReader:
    def __init__(self) -> None:
        self.snapshot = graph_snapshot()
        self.detail_data = requirement_detail(self.snapshot)
        self.closed = False

    async def get_graph(
        self,
        dataset_id: str,
        view_id: str,
    ) -> BusinessRequirementsGraphSnapshot:
        if dataset_id == "missing":
            raise DatasetNotFoundError("Dataset missing was not found.")
        if dataset_id == "unavailable":
            raise BusinessRequirementsUnavailableError()
        if view_id == "missing":
            raise GraphViewNotFoundError("Graph view missing was not found.")
        return self.snapshot

    async def get_detail(
        self,
        dataset_id: str,
        requirement_id: str,
    ) -> BusinessRequirementDetailData:
        if dataset_id == "missing":
            raise DatasetNotFoundError("Dataset missing was not found.")
        if dataset_id == "unavailable":
            raise BusinessRequirementsUnavailableError()
        if requirement_id == "missing":
            raise RequirementNotFoundError(
                "Requirement missing was not found in the selected dataset."
            )
        return self.detail_data

    async def close(self) -> None:
        self.closed = True


def test_initial_layout_is_deterministic_and_preserves_semantic_radius() -> None:
    snapshot = graph_snapshot()
    first_2d = build_graph_response(snapshot, 2)
    second_2d = build_graph_response(snapshot, 2)
    assert first_2d == second_2d
    assert all(node.position.z == 0 for node in first_2d.nodes)

    by_id = {node.id: node for node in first_2d.nodes}
    assert by_id["BR-000"].position.radius == 0
    assert by_id["BR-A01"].position.radius == 180
    assert by_id["BR-A01-N01"].position.radius == 415
    assert by_id["BR-A01-001"].position.radius == 595

    response_3d = build_graph_response(snapshot, 3)
    for node in response_3d.nodes:
        distance = math.sqrt(node.position.x**2 + node.position.y**2 + node.position.z**2)
        assert math.isclose(distance, node.position.radius, abs_tol=1e-5)


def test_stored_coordinates_are_used_only_for_the_requested_layout_version() -> None:
    snapshot = graph_snapshot()
    node = next(item for item in snapshot.nodes if item.requirement_id == "BR-A01")
    node.stored_position = StoredGraphPosition(
        x=10,
        y=20,
        z=30,
        position_source="manual",
        locked=True,
    )

    stale = build_graph_response(snapshot, 3)
    stale_node = next(item for item in stale.nodes if item.id == "BR-A01")
    assert stale_node.position.source == "generated:initial-semantic-v1"

    snapshot.view.layout_version = "initial-semantic-v1"
    current = build_graph_response(snapshot, 3)
    current_node = next(item for item in current.nodes if item.id == "BR-A01")
    assert current_node.position.source == "stored"
    assert (current_node.position.x, current_node.position.y, current_node.position.z) == (
        10,
        20,
        30,
    )
    assert current.view.position_source == "mixed"


def test_business_requirements_http_contract(
    settings: Settings,
) -> None:
    reader = FakeBusinessRequirementsReader()
    app = create_app(
        settings=settings,
        probes=[HealthyProbe("postgresql")],
        business_requirements_reader=reader,
    )

    with TestClient(app) as client:
        graph_response = client.get(
            "/api/v1/business-requirements/graph",
            params={"dimensions": 3},
        )
        assert graph_response.status_code == 200, graph_response.text
        graph = graph_response.json()
        assert graph["counts"] == {
            "nodes": 4,
            "edges": 3,
            "atomic_requirements": 1,
            "level_one_requirements": 1,
            "needs_confirmation": 1,
        }
        assert graph["view"]["dimensions"] == 3
        assert graph["view"]["position_source"] == "generated:initial-semantic-v1"
        assert graph["nodes"][0]["id"] == "BR-000"

        detail_response = client.get("/api/v1/business-requirements/BR-A01")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["requirement"]["id"] == "BR-A01"
        assert detail["evidence"][0]["locator"] == {"sheet": "Sheet1", "cell": "D2"}
        assert len(detail["relations"]["children"]) == 2

        invalid_layout = client.get(
            "/api/v1/business-requirements/graph",
            params={"layout_version": "random"},
        )
        assert invalid_layout.status_code == 422

        dataset_missing = client.get(
            "/api/v1/business-requirements/graph",
            params={"dataset_id": "missing"},
        )
        assert dataset_missing.status_code == 404
        assert dataset_missing.json()["detail"]["code"] == "dataset_not_found"

        view_missing = client.get(
            "/api/v1/business-requirements/graph",
            params={"view_id": "missing"},
        )
        assert view_missing.status_code == 404
        assert view_missing.json()["detail"]["code"] == "graph_view_not_found"

        requirement_missing = client.get("/api/v1/business-requirements/missing")
        assert requirement_missing.status_code == 404
        assert requirement_missing.json()["detail"]["code"] == "requirement_not_found"

        unavailable = client.get(
            "/api/v1/business-requirements/graph",
            params={"dataset_id": "unavailable"},
        )
        assert unavailable.status_code == 503
        assert unavailable.json()["detail"] == {
            "code": "postgres_unavailable",
            "message": "The business requirements store is temporarily unavailable.",
        }
        assert "postgresql://" not in unavailable.text

        openapi = client.get("/openapi.json").json()
        assert "/api/v1/business-requirements/graph" in openapi["paths"]
        assert "/api/v1/business-requirements/{requirement_id}" in openapi["paths"]

    assert reader.closed is True
