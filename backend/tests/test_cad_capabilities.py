from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from shenbian_api.application.cad_capabilities import CadCapabilitiesQueryService
from shenbian_api.application.cad_capability_errors import CapabilityAtomNotFoundError
from shenbian_api.domain.cad_capabilities import (
    CapabilityAtomDetail,
    CapabilityAtomDetailData,
    CapabilityAtomFilters,
    CapabilityAtomListItem,
    CapabilityAtomPageData,
    CapabilityDatasetMetadata,
    CapabilityFacetsData,
    CapabilityFacetValue,
)

ATOM_ID = "cap:dotnet:1e68342480f269ca4a006c35"


def dataset(
    dataset_id: str = "cad.capabilities.curated.v2",
) -> CapabilityDatasetMetadata:
    return CapabilityDatasetMetadata(
        dataset_id=dataset_id,
        schema_version="1.0",
        imported_at=datetime(2026, 8, 28, tzinfo=UTC),
        content_sha256="a" * 64,
    )


def list_item() -> CapabilityAtomListItem:
    return CapabilityAtomListItem(
        atom_id=ATOM_ID,
        inventory_id="thcad-v24.dotnet",
        surface="dotnet",
        atom_kind="method",
        observed_host_ids=["thcad-v24"],
        declaring_symbol_full_name="TianHua.Equipment.ThXuHaoEntity",
        member_name="ExplodeGeometry",
        member_signature="DBObjectCollection ExplodeGeometry()",
        return_type="Teigha.DatabaseServices.DBObjectCollection",
        is_static=False,
        classification_status="classified",
        operation_kinds=["invoke", "read", "compute"],
        domain_tags=["entity", "geometry"],
        summary="分解序号标注几何。",
        classification_confidence=0.98,
    )


def detail_atom() -> CapabilityAtomDetail:
    return CapabilityAtomDetail(
        **list_item().model_dump(),
        schema_version="1.0",
        canonical_key="dotnet|TianHua.Equipment.ThXuHaoEntity|ExplodeGeometry",
        source_artifact={
            "artifact_id": "assembly:TA_Mgd",
            "kind": "assembly",
            "name": "TA_Mgd",
            "version": "23.9.0.0",
            "sha256": "b" * 64,
        },
        declaring_symbol={
            "symbol_id": "type:TianHua.Equipment.ThXuHaoEntity",
            "full_name": "TianHua.Equipment.ThXuHaoEntity",
            "kind": "class",
        },
        member={
            "name": "ExplodeGeometry",
            "signature": "DBObjectCollection ExplodeGeometry()",
            "return_type": "Teigha.DatabaseServices.DBObjectCollection",
            "parameters": [],
            "is_static": False,
        },
        provenance={
            "extractor": "ExportThcadDotNetCapabilityAtoms",
            "extractor_version": "1.0",
            "source_locator": {"metadata_token": 123},
        },
        surface_metadata={},
        semantic_candidates=[],
        evidence=[
            {
                "kind": "runtime_probe",
                "ref": "XuhaoCoordinateProbe",
                "claim": "Returns annotation geometry.",
            }
        ],
        processor={"kind": "rule", "name": "dotnet-rules", "run_id": "run-1"},
        processed_at=datetime(2026, 8, 28, tzinfo=UTC),
        notes=None,
    )


class FakeCadCapabilitiesReader:
    def __init__(self) -> None:
        self.last_dataset_id: str | None = None
        self.last_filters: CapabilityAtomFilters | None = None
        self.last_limit: int | None = None
        self.last_offset: int | None = None

    async def list_atoms(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomPageData:
        self.last_dataset_id = dataset_id
        self.last_filters = filters
        self.last_limit = limit
        self.last_offset = offset
        return CapabilityAtomPageData(
            dataset=dataset(dataset_id), total=1, items=[list_item()]
        )

    async def get_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData:
        if atom_id == "missing":
            raise CapabilityAtomNotFoundError(
                "Capability atom missing was not found in the selected dataset."
            )
        return CapabilityAtomDetailData(dataset_id=dataset_id, atom=detail_atom())

    async def get_facets(self, dataset_id: str) -> CapabilityFacetsData:
        return CapabilityFacetsData(
            dataset_id=dataset_id,
            total_atoms=334049,
            surfaces=[
                CapabilityFacetValue(value="native", count=221591),
                CapabilityFacetValue(value="dotnet", count=45641),
                CapabilityFacetValue(value="com", count=30597),
                CapabilityFacetValue(value="command", count=25544),
                CapabilityFacetValue(value="lisp", count=10676),
            ],
            observed_host_ids=[
                CapabilityFacetValue(value="autocad-2024", count=254500),
                CapabilityFacetValue(value="thcad-v24", count=79549),
            ],
            atom_kinds=[CapabilityFacetValue(value="method", count=8953)],
            classification_statuses=[
                CapabilityFacetValue(value="classified", count=102398),
                CapabilityFacetValue(value="pending", count=221591),
                CapabilityFacetValue(value="deferred", count=10060),
            ],
            operation_kinds=[CapabilityFacetValue(value="read", count=36709)],
            domain_tags=[CapabilityFacetValue(value="entity", count=100)],
        )

    async def close(self) -> None:
        return None


def install_fake(client: TestClient) -> FakeCadCapabilitiesReader:
    reader = FakeCadCapabilitiesReader()
    client.app.state.cad_capabilities_service = CadCapabilitiesQueryService(reader)
    return reader


def test_list_atoms_forwards_open_filters_and_pagination(client: TestClient) -> None:
    reader = install_fake(client)
    response = client.get(
        "/api/v1/cad-capabilities/atoms",
        params={
            "surface": "dotnet",
            "observed_host_id": "thcad-v24",
            "operation_kind": "read",
            "domain_tag": "geometry",
            "q": "ExplodeGeometry",
            "limit": 25,
            "offset": 5,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["atom_id"] == ATOM_ID
    assert payload["items"][0]["surface"] == "dotnet"
    assert payload["items"][0]["observed_host_ids"] == ["thcad-v24"]
    assert payload["items"][0]["operation_kinds"] == ["invoke", "read", "compute"]
    assert reader.last_filters == CapabilityAtomFilters(
        surface="dotnet",
        observed_host_id="thcad-v24",
        operation_kind="read",
        domain_tag="geometry",
        query="ExplodeGeometry",
    )
    assert (reader.last_limit, reader.last_offset) == (25, 5)
    assert reader.last_dataset_id == "cad.capabilities.curated.v2"


def test_v1_dataset_remains_explicitly_queryable(client: TestClient) -> None:
    reader = install_fake(client)
    response = client.get(
        "/api/v1/cad-capabilities/atoms",
        params={"dataset_id": "cad.capabilities.curated.v1"},
    )
    assert response.status_code == 200
    assert response.json()["dataset"]["dataset_id"] == "cad.capabilities.curated.v1"
    assert reader.last_dataset_id == "cad.capabilities.curated.v1"


def test_detail_returns_full_atom_properties(client: TestClient) -> None:
    install_fake(client)
    response = client.get(f"/api/v1/cad-capabilities/atoms/{ATOM_ID}")
    assert response.status_code == 200
    atom = response.json()["atom"]
    assert atom["member"]["name"] == "ExplodeGeometry"
    assert atom["source_artifact"]["name"] == "TA_Mgd"
    assert atom["evidence"][0]["kind"] == "runtime_probe"


def test_facets_are_data_driven(client: TestClient) -> None:
    install_fake(client)
    response = client.get("/api/v1/cad-capabilities/facets")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_atoms"] == 334049
    assert payload["surfaces"][0] == {"value": "native", "count": 221591}
    assert payload["observed_host_ids"] == [
        {"value": "autocad-2024", "count": 254500},
        {"value": "thcad-v24", "count": 79549},
    ]


def test_missing_atom_returns_stable_404(client: TestClient) -> None:
    install_fake(client)
    response = client.get("/api/v1/cad-capabilities/atoms/missing")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "capability_atom_not_found"


def test_list_rejects_oversized_page(client: TestClient) -> None:
    install_fake(client)
    response = client.get("/api/v1/cad-capabilities/atoms?limit=201")
    assert response.status_code == 422


def test_openapi_contains_capability_endpoints(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/cad-capabilities/atoms" in paths
    assert "/api/v1/cad-capabilities/atoms/{atom_id}" in paths
    assert "/api/v1/cad-capabilities/facets" in paths
