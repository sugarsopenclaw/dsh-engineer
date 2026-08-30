from __future__ import annotations

import gzip
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from shenbian_api.application.cad_capabilities import CadCapabilitiesQueryService
from shenbian_api.application.cad_capability_errors import CapabilityDatasetNotFoundError
from shenbian_api.domain.cad_capabilities import (
    CapabilityAtomDetailData,
    CapabilityAtomFilters,
    CapabilityAtomPageData,
    CapabilityDatasetMetadata,
    CapabilityFacetsData,
    CapabilityGraphAtom,
    CapabilityGraphAtomStreamData,
)

DATASET = CapabilityDatasetMetadata(
    dataset_id="cad.capabilities.curated.v2",
    schema_version="1.0",
    imported_at=datetime(2026, 8, 28, tzinfo=UTC),
    content_sha256="a" * 64,
)

GRAPH_ATOMS = [
    CapabilityGraphAtom(
        atom_id="cap:dotnet:aaa",
        surface="dotnet",
        atom_kind="method",
        observed_host_ids=["thcad-v24"],
        member_name="ExplodeGeometry",
        declaring_symbol_full_name="Teigha.DatabaseServices.Entity",
        classification_status="classified",
        operation_kinds=["invoke", "transform"],
        domain_tags=["entity", "geometry"],
    ),
    CapabilityGraphAtom(
        atom_id="cap:dotnet:bbb",
        surface="dotnet",
        atom_kind="property_get",
        observed_host_ids=["thcad-v24"],
        member_name="GetString",
        declaring_symbol_full_name=None,
        classification_status="classified",
        operation_kinds=["read"],
        domain_tags=[],
    ),
]


class FakeGraphAtomsReader:
    def __init__(self) -> None:
        self.last_filters: CapabilityAtomFilters | None = None
        self.stream_closed = False

    async def prepare_graph_atom_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> CapabilityGraphAtomStreamData:
        self.last_filters = filters
        if dataset_id != DATASET.dataset_id:
            raise CapabilityDatasetNotFoundError(f"dataset {dataset_id} not found")
        reader = self

        async def _iterate() -> AsyncIterator[CapabilityGraphAtom]:
            try:
                for atom in GRAPH_ATOMS:
                    yield atom
            finally:
                reader.stream_closed = True

        return CapabilityGraphAtomStreamData(
            dataset=DATASET,
            total=len(GRAPH_ATOMS),
            stream=_iterate(),
        )

    async def list_atoms(self, dataset_id, filters, limit, offset) -> CapabilityAtomPageData:
        raise AssertionError("unexpected list call")

    async def get_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData:
        raise AssertionError("unexpected detail call")

    async def get_facets(self, dataset_id: str) -> CapabilityFacetsData:
        raise AssertionError("unexpected facets call")

    async def close(self) -> None:
        return None


def install_fake(client: TestClient) -> FakeGraphAtomsReader:
    reader = FakeGraphAtomsReader()
    client.app.state.cad_capabilities_service = CadCapabilitiesQueryService(reader)
    return reader


def test_graph_atoms_streams_ndjson_with_headers(client: TestClient) -> None:
    reader = install_fake(client)
    response = client.get(
        "/api/v1/cad-capabilities/graph-atoms?surface=dotnet",
        headers={"Accept-Encoding": "identity"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert response.headers["x-total-count"] == "2"
    assert response.headers["x-dataset-sha256"] == "a" * 64
    assert response.headers["cache-control"] == "private, no-cache"
    assert "etag" in response.headers
    assert "content-encoding" not in response.headers

    lines = [line for line in response.text.strip().split("\n") if line]
    assert len(lines) == 2
    first = json.loads(lines[0])
    # 最小投影：只允许这 9 个键，重字段不进入批量流。
    assert set(first) == {
        "atom_id",
        "surface",
        "atom_kind",
        "observed_host_ids",
        "member_name",
        "declaring_symbol_full_name",
        "classification_status",
        "operation_kinds",
        "domain_tags",
    }
    assert first["atom_id"] == "cap:dotnet:aaa"
    assert reader.last_filters is not None
    assert reader.last_filters.surface == "dotnet"
    assert reader.stream_closed


def test_graph_atoms_etag_second_request_returns_304(client: TestClient) -> None:
    reader = install_fake(client)
    first = client.get("/api/v1/cad-capabilities/graph-atoms")
    etag = first.headers["etag"]

    second = client.get(
        "/api/v1/cad-capabilities/graph-atoms",
        headers={"If-None-Match": etag},
    )
    assert second.status_code == 304
    assert second.headers["etag"] == etag
    assert second.content == b""
    # 304 路径也必须归还预准备流持有的连接。
    assert reader.stream_closed


def test_graph_atoms_etag_changes_with_filters(client: TestClient) -> None:
    install_fake(client)
    all_atoms = client.get("/api/v1/cad-capabilities/graph-atoms")
    dotnet = client.get("/api/v1/cad-capabilities/graph-atoms?surface=dotnet")
    assert all_atoms.headers["etag"] != dotnet.headers["etag"]


def test_graph_atoms_gzip_when_client_accepts(client: TestClient) -> None:
    install_fake(client)
    # TestClient(httpx) 默认带 Accept-Encoding: gzip 并自动解压。
    response = client.get("/api/v1/cad-capabilities/graph-atoms")
    assert response.headers.get("content-encoding") == "gzip"
    lines = [line for line in response.text.strip().split("\n") if line]
    assert len(lines) == 2


def test_graph_atoms_unknown_dataset_returns_404(client: TestClient) -> None:
    install_fake(client)
    response = client.get(
        "/api/v1/cad-capabilities/graph-atoms",
        params={"dataset_id": "cad.capabilities.missing.v1"},
    )
    assert response.status_code == 404
    body = response.json()
    assert body["detail"]["code"] == "capability_dataset_not_found"


def test_openapi_contains_graph_atoms_endpoint(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/cad-capabilities/graph-atoms" in paths


def test_matches_graph_atom_filters_parity() -> None:
    from shenbian_api.infrastructure.postgres_cad_capabilities import (
        _matches_graph_atom_filters,
    )

    atom = GRAPH_ATOMS[0]
    assert _matches_graph_atom_filters(atom, CapabilityAtomFilters())
    assert _matches_graph_atom_filters(atom, CapabilityAtomFilters(surface="dotnet"))
    assert not _matches_graph_atom_filters(atom, CapabilityAtomFilters(surface="com"))
    assert _matches_graph_atom_filters(
        atom, CapabilityAtomFilters(observed_host_id="thcad-v24")
    )
    assert not _matches_graph_atom_filters(
        atom, CapabilityAtomFilters(observed_host_id="autocad-2025")
    )
    assert _matches_graph_atom_filters(atom, CapabilityAtomFilters(atom_kind="method"))
    assert not _matches_graph_atom_filters(atom, CapabilityAtomFilters(atom_kind="macro"))
    assert _matches_graph_atom_filters(
        atom, CapabilityAtomFilters(classification_status="classified")
    )
    assert not _matches_graph_atom_filters(
        atom, CapabilityAtomFilters(classification_status="pending")
    )
    assert _matches_graph_atom_filters(
        atom, CapabilityAtomFilters(operation_kind="transform")
    )
    assert not _matches_graph_atom_filters(atom, CapabilityAtomFilters(operation_kind="delete"))
    assert _matches_graph_atom_filters(atom, CapabilityAtomFilters(domain_tag="geometry"))
    assert not _matches_graph_atom_filters(atom, CapabilityAtomFilters(domain_tag="paper"))


def test_graph_snapshot_scope_uses_surface_and_host_only() -> None:
    from shenbian_api.infrastructure.postgres_cad_capabilities import (
        _graph_snapshot_scope,
    )

    filters = CapabilityAtomFilters(
        surface="dotnet",
        observed_host_id="autocad-2024",
        operation_kind="read",
        domain_tag="geometry",
    )
    assert _graph_snapshot_scope("cad.capabilities.curated.v2", filters) == (
        "cad.capabilities.curated.v2",
        "dotnet",
        "autocad-2024",
    )


def test_decode_graph_snapshot_checks_count() -> None:
    from shenbian_api.infrastructure.postgres_cad_capabilities import (
        _decode_graph_snapshot,
    )

    payload = b"\n".join(
        json.dumps(atom.model_dump(mode="json"), separators=(",", ":")).encode()
        for atom in GRAPH_ATOMS
    )
    decoded = _decode_graph_snapshot(gzip.compress(payload, mtime=0), 2)
    assert [atom.atom_id for atom in decoded] == [atom.atom_id for atom in GRAPH_ATOMS]

    try:
        _decode_graph_snapshot(gzip.compress(payload, mtime=0), 3)
    except ValueError as error:
        assert "count mismatch" in str(error)
    else:
        raise AssertionError("count mismatch must fail")
