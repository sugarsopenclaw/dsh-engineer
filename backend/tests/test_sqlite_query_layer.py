from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from conftest import HealthyProbe
from data.pipelines.cad_capabilities.build_curated import curated_atom
from data.pipelines.local_query_store.load_sqlite import (
    load_business_requirements,
    load_cad_capabilities,
)
from data.pipelines.shenbian_client_requirements.load_postgres import TABLE_SPECS
from fastapi.testclient import TestClient

from shenbian_api.app_factory import create_app
from shenbian_api.application.cad_capabilities import DEFAULT_CAD_CAPABILITIES_DATASET_ID
from shenbian_api.core.config import Settings
from shenbian_api.domain.cad_capabilities import CapabilityAtomFilters
from shenbian_api.infrastructure.sqlite_business_requirements import (
    SqliteBusinessRequirementsReader,
)
from shenbian_api.infrastructure.sqlite_cad_capabilities import SqliteCadCapabilitiesReader


def atom() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "inventory_id": "thcad-v24.dotnet",
        "atom_id": "cap:dotnet:000000000000000000000001",
        "canonical_key": "dotnet|Example.Type|Read()",
        "surface": "dotnet",
        "atom_kind": "method",
        "observed_host_ids": ["thcad-v24"],
        "source_artifact": {
            "artifact_id": "assembly:test",
            "kind": "assembly",
            "name": "test",
            "version": "1.0",
            "sha256": "a" * 64,
        },
        "declaring_symbol": {
            "symbol_id": "type:Example.Type",
            "full_name": "Example.Type",
            "kind": "class",
        },
        "member": {
            "name": "Read",
            "signature": "System.String Read()",
            "return_type": "System.String",
            "parameters": [],
            "is_static": False,
        },
        "provenance": {
            "extractor": "test",
            "extractor_version": "1.0",
            "source_locator": {"token": 1},
        },
        "surface_metadata": {},
    }


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
        newline="\n",
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_business_fixture(root: Path) -> Path:
    directory = root / "business"
    directory.mkdir()
    rows = {
        "source_documents.jsonl": [
            {
                "source_document_id": "SRC-DOC-001",
                "name": "Customer.xlsx",
                "source_kind": "customer_primary",
                "storage_ref": "client-data/example.xlsx",
                "sha256": "a" * 64,
                "authority_rank": 1,
                "parent_source_document_id": None,
            }
        ],
        "source_evidence.jsonl": [
            {
                "source_evidence_id": "EV-001",
                "source_document_id": "SRC-DOC-001",
                "evidence_kind": "cell",
                "locator": {"sheet": "A", "cell": "B2"},
                "verbatim_text": "需要法兰接口",
            }
        ],
        "requirement_nodes.jsonl": [
            {
                "requirement_id": "BR-000",
                "name": "根",
                "description": None,
                "requirement_kind": "requirement_group",
                "origin_kind": "normalized",
                "atomic": False,
                "verification_method": None,
                "priority_order": None,
                "source_emphasis": None,
                "customer_visible": True,
                "needs_confirmation": False,
                "lifecycle_status": "discovery",
                "derived_min_depth": 0,
            },
            {
                "requirement_id": "BR-A01",
                "name": "法兰接口",
                "description": "油箱法兰",
                "requirement_kind": "functional",
                "origin_kind": "customer_stated",
                "atomic": True,
                "verification_method": "核对图纸",
                "priority_order": 1,
                "source_emphasis": None,
                "customer_visible": True,
                "needs_confirmation": False,
                "lifecycle_status": "discovery",
                "derived_min_depth": 1,
            },
        ],
        "requirement_relations.jsonl": [
            {
                "requirement_relation_id": "REL-001",
                "parent_requirement_id": "BR-000",
                "child_requirement_id": "BR-A01",
                "relation_kind": "contains_requirement",
                "display_order": 1,
                "rationale": None,
                "origin_kind": "normalized",
            }
        ],
        "requirement_source_links.jsonl": [
            {
                "requirement_source_link_id": "RSL-001",
                "requirement_id": "BR-A01",
                "source_evidence_id": "EV-001",
                "link_kind": "direct",
            }
        ],
        "graph_views.jsonl": [
            {
                "graph_view_id": "GV-BUSINESS-DEFAULT",
                "name": "Default",
                "description": "Default view",
                "layout_algorithm": None,
                "layout_version": "initial-semantic-v1",
            }
        ],
    }
    counts = {spec.manifest_count_key: 0 for spec in TABLE_SPECS}
    for spec in TABLE_SPECS:
        table_rows = rows.get(spec.filename, [])
        _write_jsonl(directory / spec.filename, table_rows)
        counts[spec.manifest_count_key] = len(table_rows)
    counts["atomic_requirements"] = 1
    counts["level_one_requirements"] = 1
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "dataset_id": "shenbian.client_requirements.curated.v1",
                "schema_version": "1.0",
                "build_status": "valid",
                "counts": counts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return directory


def build_cad_fixture(
    root: Path,
    *,
    name: str = "cad",
    dataset_id: str = DEFAULT_CAD_CAPABILITIES_DATASET_ID,
) -> Path:
    directory = root / name
    directory.mkdir()
    record = curated_atom(
        atom(),
        {
            "status": "classified",
            "operation_kinds": ["read"],
            "domain_tags": ["entity"],
            "summary": "Reads a value.",
            "classification_confidence": 0.8,
            "semantic_candidates": [],
            "evidence": [{"kind": "signature", "ref": "Read", "claim": "read"}],
            "processor": {"kind": "rule", "name": "test", "run_id": "run-1"},
            "processed_at": "2026-08-28T00:00:00Z",
            "notes": None,
        },
    )
    inventories = [
        {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.dotnet",
            "surface": "dotnet",
            "observed_host_id": "thcad-v24",
            "captured_at": "2026-08-28T00:00:00Z",
            "extractor": {"name": "test", "version": "1.0"},
            "source_artifacts": [],
            "atoms_sha256": "a" * 64,
            "counts": {"atoms": 1},
            "classification_counts": {
                "classified": 1,
                "deferred": 0,
                "failed": 0,
                "pending": 0,
            },
        }
    ]
    inventories_path = directory / "capability-inventories.jsonl"
    atoms_path = directory / "capability-atoms.jsonl"
    _write_jsonl(inventories_path, inventories)
    _write_jsonl(atoms_path, [record])
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "dataset_id": dataset_id,
                "schema_version": "1.0",
                "build_status": "valid",
                "counts": {
                    "inventories": 1,
                    "atoms": 1,
                    "by_surface": {"dotnet": 1},
                },
                "files": {
                    "capability-inventories.jsonl": {
                        "rows": 1,
                        "sha256": _sha256(inventories_path),
                    },
                    "capability-atoms.jsonl": {
                        "rows": 1,
                        "sha256": _sha256(atoms_path),
                    },
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return directory


async def test_sqlite_business_graph_and_detail(tmp_path: Path, settings: Settings) -> None:
    sqlite_path = tmp_path / "business.sqlite"
    load_business_requirements(build_business_fixture(tmp_path), sqlite_path)
    settings = settings.model_copy(update={"business_requirements_sqlite": str(sqlite_path)})
    reader = SqliteBusinessRequirementsReader(settings)
    snapshot = await reader.get_graph(
        "shenbian.client_requirements.curated.v1",
        "GV-BUSINESS-DEFAULT",
    )
    assert len(snapshot.nodes) == 2
    assert len(snapshot.edges) == 1
    detail = await reader.get_detail("shenbian.client_requirements.curated.v1", "BR-A01")
    assert detail.requirement.name == "法兰接口"
    assert detail.evidence[0].verbatim_text == "需要法兰接口"
    await reader.close()


async def test_sqlite_cad_list_facets_and_graph(tmp_path: Path, settings: Settings) -> None:
    sqlite_path = tmp_path / "cad.sqlite"
    load_cad_capabilities(build_cad_fixture(tmp_path), sqlite_path)
    settings = settings.model_copy(update={"cad_capabilities_sqlite": str(sqlite_path)})
    reader = SqliteCadCapabilitiesReader(settings)
    filters = CapabilityAtomFilters(surface="dotnet", observed_host_id="thcad-v24")
    page = await reader.list_atoms(DEFAULT_CAD_CAPABILITIES_DATASET_ID, filters, 50, 0)
    assert page.total == 1
    assert page.items[0].member_name == "Read"
    facets = await reader.get_facets(DEFAULT_CAD_CAPABILITIES_DATASET_ID)
    assert facets.total_atoms == 1
    assert facets.surfaces[0].value == "dotnet"
    stream = await reader.prepare_graph_atom_stream(
        DEFAULT_CAD_CAPABILITIES_DATASET_ID,
        CapabilityAtomFilters(),
    )
    atoms = [atom async for atom in stream.stream]
    assert stream.total == 1
    assert atoms[0].atom_id == page.items[0].atom_id
    detail = await reader.get_atom(DEFAULT_CAD_CAPABILITIES_DATASET_ID, page.items[0].atom_id)
    assert detail.atom.summary == "Reads a value."
    await reader.close()


async def test_sqlite_cad_v1_and_v2_coexist(tmp_path: Path, settings: Settings) -> None:
    sqlite_path = tmp_path / "cad.sqlite"
    load_cad_capabilities(
        build_cad_fixture(
            tmp_path,
            name="cad-v1",
            dataset_id="cad.capabilities.curated.v1",
        ),
        sqlite_path,
    )
    load_cad_capabilities(build_cad_fixture(tmp_path, name="cad-v2"), sqlite_path)
    settings = settings.model_copy(update={"cad_capabilities_sqlite": str(sqlite_path)})
    reader = SqliteCadCapabilitiesReader(settings)
    v1 = await reader.get_facets("cad.capabilities.curated.v1")
    v2 = await reader.get_facets(DEFAULT_CAD_CAPABILITIES_DATASET_ID)
    assert v1.total_atoms == 1
    assert v2.total_atoms == 1
    assert v1.dataset_id == "cad.capabilities.curated.v1"
    assert v2.dataset_id == DEFAULT_CAD_CAPABILITIES_DATASET_ID
    await reader.close()


def test_missing_sqlite_file_returns_503(
    tmp_path: Path,
    settings: Settings,
) -> None:
    settings = settings.model_copy(
        update={
            "business_requirements_sqlite": str(tmp_path / "missing-business.sqlite"),
            "cad_capabilities_sqlite": str(tmp_path / "missing-cad.sqlite"),
        }
    )
    app = create_app(
        settings=settings,
        probes=[HealthyProbe("postgresql"), HealthyProbe("redis"), HealthyProbe("oss")],
    )
    with TestClient(app) as client:
        business = client.get("/api/v1/business-requirements/graph")
        assert business.status_code == 503
        assert business.json()["detail"]["code"] == "postgres_unavailable"
        cad = client.get("/api/v1/cad-capabilities/facets")
        assert cad.status_code == 503
        assert cad.json()["detail"]["code"] == "postgres_unavailable"


def test_postgres_importers_refuse_to_write() -> None:
    from data.pipelines.cad_capabilities.load_postgres import import_dataset as import_cad
    from data.pipelines.cad_capabilities.load_postgres_via_oss import import_dataset_via_oss
    from data.pipelines.local_query_store.retired_postgres import POSTGRES_IMPORT_RETIRED
    from data.pipelines.shenbian_client_requirements.load_postgres import (
        import_dataset as import_business,
    )

    async def expect_retired(factory):
        try:
            await factory(Path("unused"))
        except RuntimeError as error:
            assert "retired" in str(error)
            return
        raise AssertionError("expected retired importer")

    import asyncio

    asyncio.run(expect_retired(import_business))
    asyncio.run(expect_retired(import_cad))
    asyncio.run(expect_retired(import_dataset_via_oss))
    assert "load_sqlite.py" in POSTGRES_IMPORT_RETIRED
