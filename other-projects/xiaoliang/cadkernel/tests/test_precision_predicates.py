from __future__ import annotations

import numpy as np
from hypothesis import given, strategies as st

from cadkernel.contracts import Exactness, PrecisionModel, ToleranceProfile
from cadkernel.ir import CoordinateFrame
from cadkernel.kernel.precision import TruthValue, collinear, orientation_2d, parallel, perpendicular, point_on_segment


SNAPSHOT_ID = "predicate-snapshot"
PROFILE = ToleranceProfile(
    numeric_equality=1e-9,
    collinearity=1e-8,
    parallel_angle=1e-8,
    perpendicular_angle=1e-8,
    endpoint_snap=1e-6,
)


def frame_for(points: np.ndarray, grid_size: float = 1.0) -> CoordinateFrame:
    minimum = points.min(axis=0) - 10
    maximum = points.max(axis=0) + 10
    return CoordinateFrame.from_bounds(
        (minimum[0], minimum[1], maximum[0], maximum[1]),
        PrecisionModel(grid_size=grid_size, max_region_span=1e9),
    )


@given(
    ax=st.integers(-10_000, 10_000),
    ay=st.integers(-10_000, 10_000),
    bx=st.integers(-10_000, 10_000),
    by=st.integers(-10_000, 10_000),
    cx=st.integers(-10_000, 10_000),
    cy=st.integers(-10_000, 10_000),
    tx=st.integers(-1_000_000, 1_000_000),
    ty=st.integers(-1_000_000, 1_000_000),
    scale=st.integers(1, 20),
)
def test_orientation_is_translation_rotation_and_positive_scale_invariant(
    ax: int,
    ay: int,
    bx: int,
    by: int,
    cx: int,
    cy: int,
    tx: int,
    ty: int,
    scale: int,
) -> None:
    points = np.asarray([[ax, ay], [bx, by], [cx, cy]], dtype=np.float64)
    base_frame = frame_for(points)
    base = orientation_2d(*points, frame=base_frame, snapshot_id=SNAPSHOT_ID).value
    assert base is not None

    rotation = np.asarray([[0.0, -1.0], [1.0, 0.0]])
    transformed = (points @ rotation.T) * scale + np.asarray([tx, ty])
    transformed_frame = frame_for(transformed)
    actual = orientation_2d(*transformed, frame=transformed_frame, snapshot_id=SNAPSHOT_ID).value
    assert actual is not None
    np.testing.assert_array_equal(actual.signs, base.signs)


def test_exact_orientation_handles_large_rebased_coordinates() -> None:
    points = np.asarray(
        [
            [2_670_000.000, 970_000.000],
            [2_670_100.000, 970_000.001],
            [2_670_200.000, 970_000.003],
        ]
    )
    frame = frame_for(points, grid_size=0.001)
    result = orientation_2d(*points, frame=frame, snapshot_id=SNAPSHOT_ID)
    assert result.exactness is Exactness.EXACT_PREDICATE
    assert result.value is not None
    assert result.value.signs.item() == 1


def test_degenerate_and_angular_predicates_are_three_state() -> None:
    points = np.asarray([[0.0, 0.0], [10.0, 0.0], [0.0, 10.0]])
    frame = frame_for(points, grid_size=1e-3)
    collinear_result = collinear(
        points[0], points[0], points[1], frame=frame, tolerance=PROFILE, snapshot_id=SNAPSHOT_ID
    )
    assert collinear_result.value is not None
    assert collinear_result.value.truth.item() == TruthValue.INDETERMINATE

    parallel_result = parallel(
        (0, 0), (10, 0), (0, 5), (20, 5), frame=frame, tolerance=PROFILE, snapshot_id=SNAPSHOT_ID
    )
    assert parallel_result.value is not None and parallel_result.value.all_true
    perpendicular_result = perpendicular(
        (0, 0), (10, 0), (2, 2), (2, 12), frame=frame, tolerance=PROFILE, snapshot_id=SNAPSHOT_ID
    )
    assert perpendicular_result.value is not None and perpendicular_result.value.all_true


def test_point_on_segment_observes_both_distance_and_parameter_range() -> None:
    points = np.asarray([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]])
    frame = frame_for(points, grid_size=1e-3)
    result = point_on_segment(
        [[5.0, 0.0], [20.0, 0.0]],
        [[0.0, 0.0], [0.0, 0.0]],
        [[10.0, 0.0], [10.0, 0.0]],
        frame=frame,
        tolerance=PROFILE,
        snapshot_id=SNAPSHOT_ID,
    )
    assert result.value is not None
    assert result.value.truth.tolist() == [TruthValue.TRUE, TruthValue.FALSE]


@given(
    x=st.integers(-10_000, 10_000),
    y=st.integers(-10_000, 10_000),
    dx=st.integers(-1_000, 1_000).filter(lambda value: value != 0),
    dy=st.integers(-1_000, 1_000),
    tx=st.integers(-1_000_000, 1_000_000),
    ty=st.integers(-1_000_000, 1_000_000),
    scale=st.integers(1, 20),
)
def test_linear_predicates_are_rigid_and_positive_scale_invariant(
    x: int,
    y: int,
    dx: int,
    dy: int,
    tx: int,
    ty: int,
    scale: int,
) -> None:
    origin = np.asarray([x, y], dtype=np.float64)
    direction = np.asarray([dx, dy], dtype=np.float64)
    offset = np.asarray([17, -23], dtype=np.float64)
    perpendicular_direction = np.asarray([-dy, dx], dtype=np.float64)
    points = np.asarray(
        [
            origin,
            origin + 4 * direction,
            origin + 7 * direction,
            origin + offset,
            origin + offset + 3 * direction,
            origin + offset + 5 * perpendicular_direction,
            origin + 2 * direction,
        ]
    )

    rotation = np.asarray([[0.0, -1.0], [1.0, 0.0]])
    transformed = points @ rotation.T * scale + np.asarray([tx, ty])

    for candidate in (points, transformed):
        frame = frame_for(candidate)
        collinear_result = collinear(
            candidate[0],
            candidate[1],
            candidate[2],
            frame=frame,
            tolerance=PROFILE,
            snapshot_id=SNAPSHOT_ID,
        )
        parallel_result = parallel(
            candidate[0],
            candidate[1],
            candidate[3],
            candidate[4],
            frame=frame,
            tolerance=PROFILE,
            snapshot_id=SNAPSHOT_ID,
        )
        perpendicular_result = perpendicular(
            candidate[0],
            candidate[1],
            candidate[3],
            candidate[5],
            frame=frame,
            tolerance=PROFILE,
            snapshot_id=SNAPSHOT_ID,
        )
        on_segment_result = point_on_segment(
            candidate[6],
            candidate[0],
            candidate[1],
            frame=frame,
            tolerance=PROFILE,
            snapshot_id=SNAPSHOT_ID,
        )

        assert collinear_result.value is not None
        assert collinear_result.value.all_true
        assert parallel_result.value is not None
        assert parallel_result.value.all_true
        assert perpendicular_result.value is not None
        assert perpendicular_result.value.all_true
        assert on_segment_result.value is not None
        assert on_segment_result.value.all_true
