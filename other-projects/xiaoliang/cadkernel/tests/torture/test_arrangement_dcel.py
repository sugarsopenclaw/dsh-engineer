from __future__ import annotations

from pathlib import Path

import ezdxf
import numpy as np
import pytest

import cadkernel.topology.arrangement as arrangement_module
from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import Decision, PrecisionModel, ToleranceProfile
from cadkernel.repair import extract_endpoints, propose
from cadkernel.topology import (
    build_arrangement,
    build_dcel,
    compile_topology,
    face_polygon,
    make_topology_payload,
)


def square(x0: float, y0: float, x1: float, y1: float):
    return [
        ((x0, y0), (x1, y0)),
        ((x1, y0), (x1, y1)),
        ((x1, y1), (x0, y1)),
        ((x0, y1), (x0, y0)),
    ]


def run_case(
    tmp_path: Path,
    name: str,
    lines,
    *,
    endpoint_snap: float = 0.001,
    grid_size: float = 0.0001,
):
    drawing = tmp_path / f"{name}.dxf"
    doc = ezdxf.new("R2018")
    model = doc.modelspace()
    for start, end in lines:
        model.add_line(start, end)
    doc.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(endpoint_snap=endpoint_snap, profile_name=name),
        precision=PrecisionModel(grid_size=grid_size, max_region_span=10_000),
    ).snapshot
    endpoints = extract_endpoints(snapshot)
    snap_plan = propose(snapshot, endpoints=endpoints).value
    assert snap_plan is not None
    arrangement_result = build_arrangement(snapshot, endpoints=endpoints, snap_plan=snap_plan)
    assert arrangement_result.value is not None
    dcel_result = build_dcel(snapshot, arrangement_result.value)
    assert dcel_result.value is not None
    return snapshot, endpoints, snap_plan, arrangement_result.value, dcel_result


@pytest.mark.parametrize(
    ("name", "lines", "vertices", "edges"),
    [
        (
            "cross_intersection",
            [((0, 5), (10, 5)), ((5, 0), (5, 10))],
            5,
            4,
        ),
        (
            "t_intersection",
            [((0, 0), (10, 0)), ((5, 0), (5, 5))],
            4,
            3,
        ),
    ],
)
def test_cross_and_t_noding(tmp_path: Path, name: str, lines, vertices: int, edges: int) -> None:
    _, _, _, arrangement, dcel = run_case(tmp_path, name, lines)
    assert len(arrangement.vertices_grid) == vertices
    assert len(arrangement.edge_vertices) == edges
    assert dcel.value.validation.valid
    assert len(dcel.value.faces) == 0


def test_rational_intersection_keeps_source_support_after_grid_rounding(tmp_path: Path) -> None:
    _, _, _, arrangement, _ = run_case(
        tmp_path,
        "rational_intersection",
        [((0, 0), (3, 1)), ((1, -1), (1, 2))],
    )
    support_counts = np.diff(arrangement.support_offsets)
    assert len(arrangement.edge_vertices) == 4
    assert np.all(support_counts >= 1)
    assert np.all(arrangement.support_parameter_ranges >= 0.0)
    assert np.all(arrangement.support_parameter_ranges <= 1.0)


def test_grid_rounding_is_renoded_before_building_the_planar_embedding(tmp_path: Path) -> None:
    _, _, _, arrangement, dcel = run_case(
        tmp_path,
        "rounding_creates_new_incidence",
        [((4, 5), (0, 2)), ((2, 4), (3, 5)), ((3, 5), (4, 4))],
        endpoint_snap=0.0,
        grid_size=1.0,
    )
    segments = arrangement.vertices_grid[arrangement.edge_vertices].tolist()
    assert [[-2, -2], [0, 0]] in segments
    assert [[-2, -2], [1, 1]] not in segments
    assert np.all(np.diff(arrangement.support_offsets) >= 1)
    assert dcel.value.validation.valid


def test_nonconvergent_grid_renoding_marks_the_compiled_artifact_ambiguous(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    drawing = tmp_path / "nonconvergent-renoding.dxf"
    document = ezdxf.new("R2018")
    model = document.modelspace()
    model.add_line((0, 0), (3, 1))
    model.add_line((1, -1), (1, 2))
    document.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(endpoint_snap=0.0, profile_name="nonconvergent"),
        precision=PrecisionModel(grid_size=1.0, max_region_span=1_000),
    ).snapshot

    # Alternate only the canonical row order so the branch is deterministic
    # without inventing malformed geometry.
    monkeypatch.setattr(
        arrangement_module,
        "_node_integer_segments_once",
        lambda segments: segments[::-1].copy(),
    )
    compilation = compile_topology(snapshot)
    payload = make_topology_payload(snapshot, compilation)

    assert compilation.decision is Decision.AMBIGUOUS
    assert any(
        item.code == "ARRANGEMENT_GRID_NODING_DID_NOT_CONVERGE"
        for item in compilation.diagnostics
    )
    assert payload.decision == "ambiguous"


def test_face_polygon_removes_only_zero_area_spur_excursions(tmp_path: Path) -> None:
    _, _, _, arrangement, dcel_result = run_case(
        tmp_path,
        "bounded_face_with_spur",
        square(0, 0, 10, 10) + [((5, 0), (5, 5))],
    )
    assert dcel_result.value is not None
    assert dcel_result.value.validation.valid
    assert dcel_result.value.validation.invalid_face_count == 0
    assert len(dcel_result.value.faces) == 1
    polygon = face_polygon(arrangement, dcel_result.value, dcel_result.value.faces[0])
    assert polygon is not None and polygon.is_valid


def test_collinear_overlap_keeps_parameterized_multi_source_support(tmp_path: Path) -> None:
    _, _, _, arrangement, dcel = run_case(
        tmp_path,
        "collinear_overlap",
        [((0, 0), (10, 0)), ((5, 0), (15, 0))],
    )
    assert len(arrangement.edge_vertices) == 3
    support_counts = np.diff(arrangement.support_offsets)
    assert sorted(support_counts.tolist()) == [1, 1, 2]
    middle = int(np.flatnonzero(support_counts == 2)[0])
    fragments = arrangement.supporting_source_fragments(middle)
    assert len({fragment.source_occurrence_id for fragment in fragments}) == 2
    assert all(0.0 <= fragment.parameter_start <= fragment.parameter_end <= 1.0 for fragment in fragments)
    assert dcel.value.validation.valid


def test_duplicate_lines_are_one_edge_with_two_source_fragments(tmp_path: Path) -> None:
    _, _, _, arrangement, dcel = run_case(
        tmp_path,
        "duplicate_line",
        [((0, 0), (10, 0)), ((0, 0), (10, 0))],
    )
    assert len(arrangement.edge_vertices) == 1
    assert len(arrangement.supporting_source_fragments(0)) == 2
    assert dcel.value.validation.valid


def test_nested_contours_build_containment_forest(tmp_path: Path) -> None:
    _, _, _, _, dcel = run_case(
        tmp_path,
        "nested_contours",
        square(0, 0, 20, 20) + square(3, 3, 17, 17) + square(7, 7, 13, 13),
    )
    assert dcel.value.validation.valid
    assert sorted(face.depth for face in dcel.value.faces) == [0, 1, 2]
    assert sum(face.parent_face_id is None for face in dcel.value.faces) == 1


def test_hole_is_attached_to_smallest_containing_face_and_area_is_consistent(tmp_path: Path) -> None:
    _, _, _, _, dcel = run_case(
        tmp_path,
        "hole_region",
        square(0, 0, 10, 10) + square(3, 3, 7, 7),
    )
    assert dcel.value.validation.valid
    outer = next(face for face in dcel.value.faces if face.depth == 0)
    inner = next(face for face in dcel.value.faces if face.depth == 1)
    assert len(outer.hole_ring_ids) == 1
    assert outer.area_grid + inner.area_grid == pytest.approx(100_000**2)


def test_micro_gap_closes_only_in_repair_view(tmp_path: Path) -> None:
    lines = [
        ((0, 0), (10, 0)),
        ((10.0005, 0), (10, 10)),
        ((10, 10), (0, 10)),
        ((0, 10), (0, 0)),
    ]
    snapshot, endpoints, _, arrangement, dcel = run_case(
        tmp_path, "micro_gap_repair", lines, endpoint_snap=0.001
    )
    assert dcel.value.validation.valid
    assert len(dcel.value.faces) == 1

    strict = ToleranceProfile(endpoint_snap=0.0001, profile_name="strict")
    strict_plan = propose(snapshot, tolerance=strict, endpoints=endpoints).value
    assert strict_plan is not None
    strict_arrangement = build_arrangement(
        snapshot, endpoints=endpoints, snap_plan=strict_plan
    ).value
    assert strict_arrangement is not None
    strict_dcel = build_dcel(snapshot, strict_arrangement)
    assert strict_dcel.value is not None and strict_dcel.value.validation.valid
    assert len(strict_dcel.value.faces) == 0
    assert strict_arrangement.arrangement_id != arrangement.arrangement_id


def test_self_intersection_is_noded_into_valid_bounded_faces(tmp_path: Path) -> None:
    lines = [
        ((0, 0), (10, 10)),
        ((10, 10), (0, 10)),
        ((0, 10), (10, 0)),
        ((10, 0), (0, 0)),
    ]
    _, _, _, arrangement, dcel = run_case(tmp_path, "self_intersection", lines)
    assert [5_0000, 5_0000] in arrangement.vertices_grid.tolist()
    assert dcel.value.validation.valid
    assert len(dcel.value.faces) == 2


def test_multiple_independent_groups_satisfy_euler_with_one_unbounded_face(tmp_path: Path) -> None:
    _, _, _, _, dcel = run_case(
        tmp_path,
        "independent_groups",
        square(0, 0, 10, 10) + square(100, 100, 110, 110),
    )
    validation = dcel.value.validation
    assert validation.valid
    assert validation.connected_component_count == 2
    assert validation.euler_left == validation.euler_right == 3
    assert len(dcel.value.faces) == 2
