from __future__ import annotations

import math
from pathlib import Path

import ezdxf
import numpy as np

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel
from cadkernel.ir import CoordinateFrame
from cadkernel.kernel.curves import SourceCurve, approximate_arc, approximate_bulged_polyline
from cadkernel.kernel.intersect import IntersectionKind, intersect_geometry_pairs, intersect_segments
from cadkernel.kernel.measure import aabb, area, distance, length, obb


def test_bulge_and_arc_are_explicit_bounded_approximations() -> None:
    source = SourceCurve(
        occurrence_id="polyline",
        definition_id="definition",
        curve_type="LWPOLYLINE",
        control_points=((0.0, 0.0, 0.0), (10.0, 0.0, 0.0)),
    )
    view = approximate_bulged_polyline(
        source,
        points=source.control_points,
        bulges=[1.0],
        closed=False,
        chord_error=0.01,
        max_segment_length=1.0,
    )
    assert view.source is source
    assert view.measured_chord_error <= view.chord_error
    np.testing.assert_allclose(view.coordinates[[0, -1], :2], [[0, 0], [10, 0]], atol=1e-12)

    arc = approximate_arc(
        SourceCurve("arc", "arc-def", "ARC", ()),
        center=(0.0, 0.0, 0.0),
        radius=10.0,
        start_angle=0.0,
        end_angle=math.pi / 2,
        chord_error=0.001,
        max_segment_length=1.0,
    )
    assert arc.measured_chord_error <= 0.001
    np.testing.assert_allclose(arc.coordinates[0], [10, 0, 0], atol=1e-12)
    np.testing.assert_allclose(arc.coordinates[-1], [0, 10, 0], atol=1e-12)


def test_segment_intersection_preserves_overlap_parameter_intervals() -> None:
    frame = CoordinateFrame.from_bounds(
        (-10.0, -10.0, 30.0, 30.0),
        PrecisionModel(grid_size=1e-3),
    )
    result = intersect_segments(
        [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]],
        [[10.0, 0.0], [10.0, 10.0], [1.0, 0.0]],
        [[5.0, 0.0], [0.0, 10.0], [2.0, 0.0]],
        [[15.0, 0.0], [10.0, 0.0], [3.0, 0.0]],
        frame=frame,
        snapshot_id="intersection-snapshot",
    )
    assert result.value is not None
    kinds = [record.kind for record in result.value.records]
    assert kinds == [
        IntersectionKind.OVERLAP_INTERVAL,
        IntersectionKind.POINT,
        IntersectionKind.NONE,
    ]
    assert result.value.records[0].parameters_a == ((0.5, 1.0),)
    assert result.value.records[0].parameters_b == ((0.0, 0.5),)


def test_measurements_are_batched_and_propagate_units(tmp_path: Path) -> None:
    drawing = tmp_path / "measure.dxf"
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    model = doc.modelspace()
    model.add_lwpolyline(
        [(0, 0), (10, 0), (10, 10), (0, 10)],
        close=True,
        dxfattribs={"layer": "SQUARE"},
    )
    model.add_line((20, 0), (30, 0), dxfattribs={"layer": "LINE"})
    model.add_text("ignored by line construction", dxfattribs={"insert": (50, 50)})
    doc.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000),
    ).snapshot
    definition_layers = {
        str(definition): str(layer)
        for definition, layer in zip(snapshot.definitions.definition_ids, snapshot.definitions.layers)
    }
    ids = {
        definition_layers[str(definition)]: str(occurrence)
        for occurrence, definition in zip(snapshot.geometry.occurrence_ids, snapshot.geometry.definition_ids)
    }
    square_id = ids["SQUARE"]
    line_id = ids["LINE"]
    length_result = length(snapshot, [square_id, line_id]).value
    assert length_result is not None
    np.testing.assert_allclose(length_result.values, [40.0, 10.0])
    assert length(snapshot, [square_id]).evidence[0].snapshot_id == snapshot.snapshot_id
    evidence = length(snapshot, [square_id]).evidence[0]
    assert evidence.occurrence_id == square_id
    assert evidence.definition_entity_id is not None
    assert evidence.source_parameter_range == (0.0, 1.0)
    np.testing.assert_allclose(length(snapshot, line_id).value.values, [10.0])
    assert length_result.unit == "millimetre"
    area_result = area(snapshot, [square_id]).value
    assert area_result is not None
    np.testing.assert_allclose(area_result.values, [100.0])
    np.testing.assert_allclose(aabb(snapshot, [square_id]).value.values, [[0, 0, 10, 10]])
    assert obb(snapshot, [square_id]).value.corners.shape == (1, 4, 2)
    line_box = obb(snapshot, [line_id]).value.corners[0]
    np.testing.assert_allclose(line_box, [[20, 0], [30, 0], [30, 0], [20, 0]])
    text_id = next(
        str(occurrence)
        for occurrence, source_type in zip(
            snapshot.geometry.occurrence_ids, snapshot.geometry.source_types
        )
        if source_type == "TEXT"
    )
    point_box = obb(snapshot, [text_id]).value.corners[0]
    np.testing.assert_allclose(point_box, np.repeat([[50, 50]], 4, axis=0))
    np.testing.assert_allclose(distance(snapshot, [square_id], [line_id]).value.values, [10.0])
    np.testing.assert_allclose(distance(snapshot, square_id, line_id).value.values, [10.0])


def test_length_uses_all_three_coordinates_instead_of_silent_xy_projection(tmp_path: Path) -> None:
    drawing = tmp_path / "length-3d.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_line((0, 0, 0), (3, 4, 12))
    document.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    ).snapshot
    result = length(snapshot)
    assert result.value is not None
    np.testing.assert_allclose(result.value.values, [13.0])


def test_geometry_intersection_operator_exercises_all_seven_kinds(tmp_path: Path) -> None:
    drawing = tmp_path / "intersections.dxf"
    doc = ezdxf.new("R2018")
    model = doc.modelspace()
    model.add_line((0, 0), (10, 0), dxfattribs={"layer": "BASE"})
    model.add_line((0, 10), (10, 10), dxfattribs={"layer": "NONE"})
    model.add_line((5, -5), (5, 5), dxfattribs={"layer": "POINT"})
    model.add_circle((5, 0), radius=2, dxfattribs={"layer": "MULTI"})
    model.add_line((5, 0), (15, 0), dxfattribs={"layer": "INTERVAL"})
    model.add_lwpolyline([(0, 0), (5, 0), (5, 5)], dxfattribs={"layer": "CURVE"})
    model.add_lwpolyline(
        [(0, 0), (5, 0), (5, 5), (8, 0)],
        dxfattribs={"layer": "AMBIGUOUS"},
    )
    model.add_text("label", dxfattribs={"insert": (5, 0), "layer": "UNSUPPORTED"})
    doc.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000),
    ).snapshot
    definition_layers = {
        str(definition): str(layer)
        for definition, layer in zip(snapshot.definitions.definition_ids, snapshot.definitions.layers)
    }
    ids = {
        definition_layers[str(definition)]: str(occurrence)
        for occurrence, definition in zip(snapshot.geometry.occurrence_ids, snapshot.geometry.definition_ids)
    }
    targets = ["NONE", "POINT", "MULTI", "INTERVAL", "CURVE", "AMBIGUOUS", "UNSUPPORTED"]
    result = intersect_geometry_pairs(
        snapshot,
        [ids["BASE"]] * len(targets),
        [ids[target] for target in targets],
    )
    assert result.value is not None
    assert [record.kind for record in result.value.records] == [
        IntersectionKind.NONE,
        IntersectionKind.POINT,
        IntersectionKind.MULTI_POINT,
        IntersectionKind.OVERLAP_INTERVAL,
        IntersectionKind.OVERLAP_CURVE,
        IntersectionKind.AMBIGUOUS,
        IntersectionKind.UNSUPPORTED,
    ]
    assert result.status.value == "partial"
    assert {item.occurrence_id for item in result.evidence} == set(ids.values())
    assert any(
        item.occurrence_id == ids["BASE"]
        and item.source_parameter_range == (0.5, 0.5)
        for item in result.evidence
    )
