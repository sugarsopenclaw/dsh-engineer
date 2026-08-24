from __future__ import annotations

import sqlite3
import json
from dataclasses import replace
from pathlib import Path

import ezdxf
import numpy as np
import pytest

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import (
    Decision,
    OpStatus,
    PrecisionModel,
    ToleranceProfile,
    stable_json_dumps,
)
from cadkernel.indexes import (
    SnapshotStore,
    assert_sqlite_capabilities,
    query_endpoints,
    query_faces,
    query_region,
    search_text,
)
from cadkernel.topology import compile_topology, load_topology, make_topology_payload


def indexed_snapshot(tmp_path: Path):
    drawing = tmp_path / "indexed.dxf"
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    model = doc.modelspace()
    model.add_line((0, 0), (10, 10), dxfattribs={"layer": "DIAGONAL"})
    model.add_line((20, 20), (30, 20), dxfattribs={"layer": "WIRE"})
    model.add_text("Transformer T-01", dxfattribs={"insert": (22, 21), "layer": "LABELS"})
    doc.saveas(drawing)
    adapter = DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(endpoint_snap=0.01),
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000),
    )
    return adapter.snapshot


def test_sqlite_build_asserts_required_extensions() -> None:
    connection = sqlite3.connect(":memory:")
    try:
        options = assert_sqlite_capabilities(connection)
        assert "ENABLE_RTREE" in options
        assert "ENABLE_FTS5" in options
    finally:
        connection.close()


def test_snapshot_round_trip_indexes_and_exact_rtree_filter(tmp_path: Path) -> None:
    snapshot = indexed_snapshot(tmp_path)
    store_path = tmp_path / "snapshot-a"
    location = SnapshotStore.create(store_path, snapshot)
    assert location.snapshot_id == snapshot.snapshot_id
    assert SnapshotStore.verify(store_path) == ()
    loaded = SnapshotStore.load(store_path)
    np.testing.assert_array_equal(loaded.geometry.grid_coordinates, snapshot.geometry.grid_coordinates)
    assert loaded.geometry.coordinates.flags.writeable is False

    # The diagonal AABB intersects this corner box, while the exact line does not.
    spatial = query_region(store_path, loaded, (0.0, 9.0, 1.0, 10.0)).value
    assert spatial is not None
    assert spatial.candidate_count == 1
    assert spatial.occurrence_ids == ()

    text = search_text(store_path, loaded, "transformer").value
    assert text is not None
    assert len(text.hits) == 1
    assert text.hits[0].layer_name == "LABELS"

    endpoints = query_endpoints(store_path, loaded, (20.0, 20.0), radius=0.005).value
    assert endpoints is not None
    assert len(endpoints.hits) == 1


def test_snapshot_verify_rejects_unmanifested_files(tmp_path: Path) -> None:
    snapshot = indexed_snapshot(tmp_path)
    store_path = tmp_path / "snapshot-with-extra"
    SnapshotStore.create(store_path, snapshot)
    unexpected = store_path / "patterns-v1" / "unexpected.bin"
    unexpected.parent.mkdir()
    unexpected.write_bytes(b"derived data must live outside the snapshot")

    assert SnapshotStore.verify(store_path) == (
        "unexpected:patterns-v1/unexpected.bin",
    )


def test_region_broad_phase_is_conservative_for_half_grid_rounding(tmp_path: Path) -> None:
    drawing = tmp_path / "half-grid.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_line((0.00049, 0.0), (0.00049, 1.0))
    document.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=100),
    ).snapshot
    store_path = tmp_path / "half-grid-snapshot"
    SnapshotStore.create(store_path, snapshot)

    result = query_region(store_path, snapshot, (0.0, 0.0, 0.0, 1.0))
    assert result.value is not None
    assert result.value.candidate_count == 1
    assert len(result.value.occurrence_ids) == 1


def test_same_snapshot_builds_byte_identically(tmp_path: Path) -> None:
    snapshot = indexed_snapshot(tmp_path)
    payload = make_topology_payload(snapshot, compile_topology(snapshot))
    first = SnapshotStore.create(tmp_path / "first", snapshot, derived_artifacts=(payload,))
    second = SnapshotStore.create(tmp_path / "second", snapshot, derived_artifacts=(payload,))
    assert first.file_sha256 == second.file_sha256


def test_topology_compilation_round_trips_as_canonical_json(tmp_path: Path) -> None:
    snapshot = indexed_snapshot(tmp_path)
    compilation = compile_topology(snapshot)
    store_path = tmp_path / "topology-round-trip"
    SnapshotStore.create(
        store_path,
        snapshot,
        derived_artifacts=(make_topology_payload(snapshot, compilation),),
    )

    result = load_topology(store_path, snapshot)

    assert result.value is not None
    assert stable_json_dumps(result.value) == stable_json_dumps(compilation)
    (store_path / "unmanifested.bin").write_bytes(b"not part of the snapshot")
    rejected = load_topology(store_path, snapshot)
    assert rejected.status is OpStatus.FAILED
    assert rejected.value is None
    assert rejected.diagnostics[0].code == "TOPOLOGY_LOAD_FAILED"


def test_face_query_propagates_ambiguous_dcel_validation(tmp_path: Path) -> None:
    snapshot = indexed_snapshot(tmp_path)
    compilation = compile_topology(snapshot)
    payload = replace(
        make_topology_payload(snapshot, compilation),
        decision="ambiguous",
        validation_diagnostics=("synthetic Euler mismatch",),
    )
    store_path = tmp_path / "ambiguous-faces"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))
    result = query_faces(store_path, snapshot, (0.0, 0.0, 100.0, 100.0))
    assert result.status is OpStatus.AMBIGUOUS
    assert result.decision.value == "ambiguous"
    assert [item.message for item in result.diagnostics] == ["synthetic Euler mismatch"]


def test_snap_conflict_makes_the_persisted_topology_non_queryable(tmp_path: Path) -> None:
    drawing = tmp_path / "collapsed-source-edge.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_line((0.0, 0.0), (0.0005, 0.0))
    document.saveas(drawing)
    tolerance = ToleranceProfile(endpoint_snap=0.001, profile_name="conflict")
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.0001, max_region_span=1_000),
    ).snapshot

    compilation = compile_topology(snapshot, tolerance=tolerance)
    assert compilation.decision is Decision.AMBIGUOUS
    assert any(item.code == "COLLAPSED_SOURCE_EDGE" for item in compilation.diagnostics)
    assert compilation.dcel.validation.valid  # DCEL validity must not erase an earlier conflict.

    payload = make_topology_payload(snapshot, compilation)
    assert payload.decision == "ambiguous"
    assert any(
        getattr(item, "code", None) == "COLLAPSED_SOURCE_EDGE"
        for item in payload.validation_diagnostics
    )
    document_payload = json.loads(payload.json_payload)
    assert document_payload["schema_version"] == 2
    assert document_payload["decision"] == "ambiguous"
    assert {
        item["operator_id"]: item["decision"]
        for item in document_payload["stage_outcomes"]
    }["snap.propose"] == "ambiguous"

    store_path = tmp_path / "collapsed-source-edge-snapshot"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))
    loaded_topology = load_topology(store_path, snapshot)
    assert loaded_topology.status is OpStatus.AMBIGUOUS
    assert loaded_topology.value is not None
    assert stable_json_dumps(loaded_topology.value) == stable_json_dumps(compilation)
    result = query_faces(store_path, snapshot, (-1.0, -1.0, 1.0, 1.0))
    assert result.status is OpStatus.AMBIGUOUS
    assert result.value is not None and result.value.hits == ()
    assert [item.code for item in result.diagnostics] == ["COLLAPSED_SOURCE_EDGE"]


def test_ambiguous_face_query_gates_before_reading_invalid_wkb(tmp_path: Path) -> None:
    drawing = tmp_path / "face.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_lwpolyline(
        [(0, 0), (10, 0), (10, 10), (0, 10)], close=True
    )
    document.saveas(drawing)
    snapshot = DxfAdapter().build(drawing).snapshot
    compilation = compile_topology(snapshot)
    payload = replace(
        make_topology_payload(snapshot, compilation),
        decision="ambiguous",
        validation_diagnostics=("synthetic invalid face",),
    )
    store_path = tmp_path / "invalid-wkb-ambiguous"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))
    connection = sqlite3.connect(store_path / "snapshot.sqlite3")
    try:
        connection.execute("UPDATE faces SET geometry_wkb=x'00'")
        connection.commit()
    finally:
        connection.close()

    result = query_faces(store_path, snapshot, (-1.0, -1.0, 11.0, 11.0))
    assert result.status is OpStatus.AMBIGUOUS
    assert result.value is not None and result.value.hits == ()
    assert result.diagnostics[0].message == "synthetic invalid face"


def test_computed_face_query_rejects_unreadable_wkb_without_raising(tmp_path: Path) -> None:
    drawing = tmp_path / "face.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_lwpolyline(
        [(0, 0), (10, 0), (10, 10), (0, 10)], close=True
    )
    document.saveas(drawing)
    snapshot = DxfAdapter().build(drawing).snapshot
    payload = make_topology_payload(snapshot, compile_topology(snapshot))
    store_path = tmp_path / "invalid-wkb-computed"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))
    connection = sqlite3.connect(store_path / "snapshot.sqlite3")
    try:
        connection.execute("UPDATE faces SET geometry_wkb=x'00'")
        connection.commit()
    finally:
        connection.close()

    result = query_faces(store_path, snapshot, (-1.0, -1.0, 11.0, 11.0))
    assert result.status is OpStatus.FAILED
    assert result.decision.value == "rejected"
    assert result.value is not None and result.value.hits == ()
    assert result.diagnostics[0].code == "FACE_GEOMETRY_INVALID"


def test_face_query_limit_is_applied_after_the_exact_filter(tmp_path: Path) -> None:
    drawing = tmp_path / "two-faces.dxf"
    document = ezdxf.new("R2018")
    model = document.modelspace()
    model.add_lwpolyline([(0, 0), (2, 0), (2, 2), (0, 2)], close=True)
    model.add_lwpolyline([(4, 0), (6, 0), (6, 2), (4, 2)], close=True)
    document.saveas(drawing)
    snapshot = DxfAdapter().build(drawing).snapshot
    payload = make_topology_payload(snapshot, compile_topology(snapshot))
    store_path = tmp_path / "two-faces-snapshot"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))

    result = query_faces(store_path, snapshot, (-1.0, -1.0, 7.0, 3.0), limit=1)
    assert result.status is OpStatus.SUCCESS
    assert result.value is not None
    assert result.value.candidate_count == 2
    assert len(result.value.hits) == 1


def test_face_query_accepts_degenerate_point_bounds(tmp_path: Path) -> None:
    drawing = tmp_path / "face.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_lwpolyline(
        [(0, 0), (10, 0), (10, 10), (0, 10)], close=True
    )
    document.saveas(drawing)
    snapshot = DxfAdapter().build(drawing).snapshot
    payload = make_topology_payload(snapshot, compile_topology(snapshot))
    store_path = tmp_path / "point-bounds-snapshot"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))

    inside = query_faces(store_path, snapshot, (5.0, 5.0, 5.0, 5.0))
    assert inside.status is OpStatus.SUCCESS
    assert inside.value is not None and len(inside.value.hits) == 1
    boundary = query_faces(store_path, snapshot, (10.0, 5.0, 10.0, 5.0))
    assert boundary.status is OpStatus.SUCCESS
    assert boundary.value is not None and len(boundary.value.hits) == 1
    outside = query_faces(store_path, snapshot, (20.0, 20.0, 20.0, 20.0))
    assert outside.status is OpStatus.SUCCESS
    assert outside.value is not None and outside.value.hits == ()


def test_snapshot_rejects_an_old_manifest_schema(tmp_path: Path) -> None:
    snapshot = indexed_snapshot(tmp_path)
    store_path = tmp_path / "old-schema"
    SnapshotStore.create(store_path, snapshot)
    manifest_path = store_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["schema_version"] -= 1
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    assert any(item.startswith("schema_version:") for item in SnapshotStore.verify(store_path))
    with pytest.raises(ValueError, match="Snapshot integrity failure"):
        SnapshotStore.load(store_path)


def test_empty_drawing_builds_a_valid_queryable_snapshot(tmp_path: Path) -> None:
    drawing = tmp_path / "empty.dxf"
    ezdxf.new("R2018").saveas(drawing)
    snapshot = DxfAdapter().build(drawing).snapshot
    compilation = compile_topology(snapshot)
    assert compilation.dcel.validation.valid
    payload = make_topology_payload(snapshot, compilation)
    store_path = tmp_path / "empty-snapshot"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))
    loaded = SnapshotStore.load(store_path)
    assert len(loaded.geometry) == 0
    result = query_region(store_path, loaded, (0.0, 0.0, 1.0, 1.0))
    assert result.value is not None and result.value.occurrence_ids == ()
