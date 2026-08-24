from __future__ import annotations

from pathlib import Path

import ezdxf
import numpy as np
import pytest
from ezdxf.math import Vec2
from ezdxf.render.mleader import ConnectionSide

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.aggregate import IdentityKey, count
from cadkernel.annotations import query_region as query_annotations
from cadkernel.annotations import resolve_targets
from cadkernel.contracts import Exactness, PrecisionModel
from cadkernel.indexes import (
    SnapshotStore,
    point_in_face,
    query_faces,
    query_region,
    search_text,
)
from cadkernel.kernel.measure import angle
from cadkernel.kernel.units import convert
from cadkernel.repair import extract_endpoints
from cadkernel.topology import compile_topology, make_topology_payload


def fact_fixture(path: Path):
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    for layer in ("TARGET", "ANN", "FILL", "GEOM", "NOTES", "EXCLUDED", "FACE"):
        document.layers.add(layer)
    model = document.modelspace()
    model.add_line((0, 0), (10, 0), dxfattribs={"layer": "TARGET"})
    dimension = model.add_linear_dim(
        base=(0, 3),
        p1=(0, 0),
        p2=(10, 0),
        text="10 override",
        dxfattribs={"layer": "ANN"},
    )
    dimension.render()
    leader = model.add_leader([(0, 0), (3, 3)])
    leader.dxf.layer = "ANN"
    hatch = model.add_hatch(dxfattribs={"layer": "FILL"})
    hatch.paths.add_polyline_path(
        [(20, 0), (25, 0), (25, 5), (20, 5)],
        is_closed=True,
    )
    model.add_solid(
        [(30, 0), (35, 0), (30, 5), (35, 5)],
        dxfattribs={"layer": "FILL"},
    )
    model.add_polyline2d(
        [(40, 0), (45, 0), (45, 5)],
        dxfattribs={"layer": "GEOM"},
    )
    model.add_text(
        "Alpha Beta",
        dxfattribs={"insert": (50, 50), "layer": "NOTES"},
    )
    model.add_text(
        "Alpha hidden",
        dxfattribs={"insert": (55, 50), "layer": "EXCLUDED"},
    )
    model.add_lwpolyline(
        [(100, 0), (110, 0), (110, 10), (100, 10)],
        close=True,
        dxfattribs={"layer": "FACE"},
    )
    model.add_line((60, 0), (61, 0), dxfattribs={"layer": "GEOM"})
    model.add_line((60, 0), (61, 0), dxfattribs={"layer": "GEOM"})

    tagged = document.blocks.new("TAGGED")
    tagged.add_attdef("QTY", (0, 0))
    insert = model.add_blockref("TAGGED", (70, 0))
    insert.add_auto_attribs({"QTY": "3"})

    multileader = model.add_multileader_mtext("Standard")
    multileader.set_content("ML note")
    multileader.add_leader_line(
        ConnectionSide.left,
        [Vec2(0, 0), Vec2(3, 4)],
    )
    multileader.build(Vec2(8, 4))
    multileader.multileader.dxf.layer = "ANN"
    document.saveas(path)


@pytest.fixture
def fact_snapshot(tmp_path: Path):
    drawing = tmp_path / "facts.dxf"
    fact_fixture(drawing)
    result = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=10_000),
    )
    return result


def test_adapter_double_writes_annotations_without_topology_pollution(fact_snapshot) -> None:
    result = fact_snapshot
    snapshot = result.snapshot
    assert not {
        "DIMENSION",
        "LEADER",
        "MULTILEADER",
        "HATCH",
        "SOLID",
        "POLYLINE",
    } & dict(result.statistics.unsupported_by_type).keys()
    assert set(snapshot.annotations.source_types) == {
        "DIMENSION",
        "LEADER",
        "MULTILEADER",
        "HATCH",
        "SOLID",
    }
    dimension_row = int(np.flatnonzero(snapshot.annotations.source_types == "DIMENSION")[0])
    assert snapshot.annotations.measured_values[dimension_row] == pytest.approx(10.0)
    assert snapshot.annotations.text_overrides[dimension_row] == "10 override"
    assert snapshot.annotations.measurement_scales[dimension_row] == 1.0
    assert snapshot.annotations.measured_value_present[dimension_row]
    assert snapshot.annotations.text_override_present[dimension_row]

    assert np.any(snapshot.geometry.annotation_derived)
    assert not np.any(
        snapshot.geometry.annotation_derived & snapshot.geometry.topology_eligible
    )
    endpoints = extract_endpoints(snapshot)
    assert not np.any(snapshot.geometry.annotation_derived[endpoints.geometry_rows])


def test_annotation_round_trip_queries_and_target_exactness(
    fact_snapshot,
    tmp_path: Path,
) -> None:
    snapshot = fact_snapshot.snapshot
    compilation = compile_topology(snapshot)
    payload = make_topology_payload(snapshot, compilation)
    store_path = tmp_path / "snapshot"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))
    loaded = SnapshotStore.load(store_path)
    np.testing.assert_array_equal(
        loaded.annotations.measured_value_present,
        snapshot.annotations.measured_value_present,
    )
    np.testing.assert_array_equal(
        loaded.annotations.definition_points,
        snapshot.annotations.definition_points,
    )

    annotations = query_annotations(store_path, loaded, (-1, -1, 40, 10)).value
    assert annotations is not None
    assert {hit.annotation_kind for hit in annotations.hits} >= {
        "linear",
        "leader",
        "multileader",
        "hatch",
        "solid",
    }
    dimension = next(hit for hit in annotations.hits if hit.source_type == "DIMENSION")
    assert dimension.measured_value == pytest.approx(10.0)
    assert dimension.text_override == "10 override"

    leader = next(hit for hit in annotations.hits if hit.annotation_kind == "leader")
    resolved = resolve_targets(loaded, [leader.occurrence_id]).value
    assert resolved is not None
    assert any(target.exactness is Exactness.EXACT for target in resolved.targets)
    assert any(
        target.association_kind == "geometric_inference"
        and target.exactness is Exactness.GRID_SNAPPED
        for target in resolved.targets
    )


def test_projected_hits_text_filters_face_trace_and_point_predicate(
    fact_snapshot,
    tmp_path: Path,
) -> None:
    snapshot = fact_snapshot.snapshot
    payload = make_topology_payload(snapshot, compile_topology(snapshot))
    store_path = tmp_path / "query-snapshot"
    SnapshotStore.create(store_path, snapshot, derived_artifacts=(payload,))

    spatial = query_region(store_path, snapshot, (49, 49, 51, 51)).value
    assert spatial is not None and spatial.occurrence_ids
    assert len(spatial.occurrence_ids) == len(spatial.layer_names) == len(spatial.bounds)
    assert "NOTES" in spatial.layer_names
    assert "TEXT" in spatial.source_types

    text = search_text(
        store_path,
        snapshot,
        "Alpha",
        layer_in=("NOTES",),
        layer_not_in=("EXCLUDED",),
        source_type_in=("TEXT",),
        field_in=("plain_text",),
    ).value
    assert text is not None and len(text.hits) == 1
    hit = text.hits[0]
    assert hit.layer_name == "NOTES"
    assert hit.source_type == "TEXT"
    assert hit.matched_fields == ("plain_text",)
    assert hit.anchor_point == (50.0, 50.0, 0.0)

    faces = query_faces(store_path, snapshot, (99, -1, 111, 11)).value
    assert faces is not None and len(faces.hits) == 1
    face = faces.hits[0]
    assert face.bounds == pytest.approx((100.0, 0.0, 110.0, 10.0))
    assert face.boundary_occurrence_ids
    assert 100.0 <= face.representative_point[0] <= 110.0

    inside = point_in_face(store_path, snapshot, (105, 5)).value
    boundary = point_in_face(store_path, snapshot, (100, 5)).value
    assert inside is not None and inside.hits[0].relation == "inside"
    assert boundary is not None and boundary.hits[0].relation == "boundary"


def test_count_requires_identity_and_measure_angle_unit_are_explicit(fact_snapshot) -> None:
    snapshot = fact_snapshot.snapshot
    with pytest.raises(TypeError, match="identity_key"):
        count(snapshot)

    annotations = count(snapshot, identity_key=IdentityKey.ANNOTATION_RECORD).value
    assert annotations is not None
    assert annotations.population == len(snapshot.annotations)
    assert not isinstance(annotations, int)

    instances = count(snapshot, identity_key=IdentityKey.DEFINITION_INSTANCE).value
    attributes = count(snapshot, identity_key=IdentityKey.ATTRIBUTE_VALUE).value
    signatures = count(snapshot, identity_key=IdentityKey.GEOMETRY_SIGNATURE).value
    assert instances is not None and instances.population == 1
    assert attributes is not None and attributes.population == 3
    assert signatures is not None
    assert any(entry.kind == "geometry_signature" for entry in signatures.dedup_report.entries)

    measured_angle = angle(
        snapshot,
        points=((1, 0), (0, 0), (0, 1)),
        unit="degree",
    ).value
    assert measured_angle is not None
    np.testing.assert_allclose(measured_angle.values, [90.0])

    length = convert(snapshot, [1000.0], "metre").value
    area = convert(snapshot, [1_000_000.0], "metre^2", from_unit="mm^2").value
    assert length is not None and length.values[0] == pytest.approx(1.0)
    assert area is not None and area.values[0] == pytest.approx(1.0)
