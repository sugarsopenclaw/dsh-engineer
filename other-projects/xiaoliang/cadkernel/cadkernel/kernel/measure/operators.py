from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely

from cadkernel._serialization import freeze_array
from cadkernel.contracts import (
    Decision,
    EvidenceRef,
    Exactness,
    OperatorSpec,
    OpResult,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot, GeometryStore


@dataclass(frozen=True, slots=True, eq=False)
class MeasurementBatch:
    occurrence_ids: np.ndarray
    values: np.ndarray
    unit: str
    approximation_errors: np.ndarray

    def __post_init__(self) -> None:
        ids = freeze_array(self.occurrence_ids, ndim=1)
        values = freeze_array(self.values, dtype=np.float64)
        errors = freeze_array(self.approximation_errors, dtype=np.float64, ndim=1)
        if values.shape[0] != len(ids) or errors.shape != (len(ids),):
            raise ValueError("MeasurementBatch columns disagree")
        object.__setattr__(self, "occurrence_ids", ids)
        object.__setattr__(self, "values", values)
        object.__setattr__(self, "approximation_errors", errors)


@dataclass(frozen=True, slots=True, eq=False)
class OrientedBoundsBatch:
    occurrence_ids: np.ndarray
    corners: np.ndarray
    approximation_errors: np.ndarray

    def __post_init__(self) -> None:
        ids = freeze_array(self.occurrence_ids, ndim=1)
        corners = freeze_array(self.corners, dtype=np.float64, ndim=3)
        errors = freeze_array(self.approximation_errors, dtype=np.float64, ndim=1)
        if corners.shape != (len(ids), 4, 2) or errors.shape != (len(ids),):
            raise ValueError("OrientedBoundsBatch requires corners[N,4,2]")
        object.__setattr__(self, "occurrence_ids", ids)
        object.__setattr__(self, "corners", corners)
        object.__setattr__(self, "approximation_errors", errors)


def _positions(store: GeometryStore, occurrence_ids: Any | None) -> np.ndarray:
    if occurrence_ids is None:
        result = np.arange(len(store), dtype=np.int64)
        result.setflags(write=False)
        return result
    result = np.atleast_1d(store.positions(occurrence_ids))
    result.setflags(write=False)
    return result


def _segment_columns(
    store: GeometryStore,
    *,
    dimensions: int = 2,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if len(store.coordinates) < 2:
        return (
            np.empty((0, dimensions), dtype=np.float64),
            np.empty((0, dimensions), dtype=np.float64),
            np.empty(0, dtype=np.int64),
        )
    if dimensions not in (2, 3):
        raise ValueError("Segment dimensions must be 2 or 3")
    starts = store.coordinates[:-1, :dimensions]
    ends = store.coordinates[1:, :dimensions]
    valid = np.ones(len(starts), dtype=np.bool_)
    boundary_indices = store.coordinate_offsets[1:-1] - 1
    valid[boundary_indices] = False
    counts = np.diff(store.coordinate_offsets) - 1
    owners = np.repeat(np.arange(len(store), dtype=np.int64), counts)
    return starts[valid], ends[valid], owners


def _exactness(store: GeometryStore, positions: np.ndarray) -> Exactness:
    return (
        Exactness.APPROXIMATED_CURVE
        if np.any(store.approximation_errors[positions] > 0)
        else Exactness.EXACT
    )


def _geometry_evidence(
    snapshot: DrawingSnapshot,
    positions: np.ndarray,
) -> tuple[EvidenceRef, ...]:
    """Return row-addressable provenance for every measured occurrence.

    Batch values remain columnar, while these compact references make each row
    resolvable back to its definition and complete source parameter/vertex span.
    """

    store = snapshot.geometry
    return tuple(
        EvidenceRef(
            snapshot_id=snapshot.snapshot_id,
            occurrence_id=str(store.occurrence_ids[position]),
            definition_entity_id=str(store.definition_ids[position]),
            source_parameter_range=(0.0, 1.0),
            vertex_range=(
                0,
                int(store.coordinate_offsets[position + 1] - store.coordinate_offsets[position] - 1),
            ),
        )
        for position in np.unique(positions)
    )


@operator_registry.operator(
    OperatorSpec("measure.length", "1.1.0", "Batched 3D curve length", "DrawingSnapshot+ids", "MeasurementBatch", Exactness.UNKNOWN)
)
def length(snapshot: DrawingSnapshot, occurrence_ids: Any | None = None) -> OpResult[MeasurementBatch]:
    store = snapshot.geometry
    positions = _positions(store, occurrence_ids)
    # Length is coordinate-frame invariant in 3D.  Using only XY here silently
    # reported a projection length for tilted OCS/WCS geometry.
    starts, ends, owners = _segment_columns(store, dimensions=3)
    segment_lengths = np.linalg.norm(ends - starts, axis=1)
    totals = np.bincount(owners, weights=segment_lengths, minlength=len(store))
    batch = MeasurementBatch(
        occurrence_ids=store.occurrence_ids[positions],
        values=totals[positions],
        unit=snapshot.unit_status,
        approximation_errors=store.approximation_errors[positions],
    )
    exactness = _exactness(store, positions)
    return successful_result(
        batch,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=exactness,
        evidence=_geometry_evidence(snapshot, positions),
        decision=Decision.APPROXIMATED if exactness is Exactness.APPROXIMATED_CURVE else Decision.COMPUTED,
        derivation=("vectorized sum of Euclidean segment lengths over ragged coordinate offsets",),
    )


@operator_registry.operator(
    OperatorSpec("measure.area", "1.0.0", "Batched signed-boundary area in the analysis plane", "DrawingSnapshot+ids", "MeasurementBatch", Exactness.UNKNOWN)
)
def area(snapshot: DrawingSnapshot, occurrence_ids: Any | None = None) -> OpResult[MeasurementBatch]:
    store = snapshot.geometry
    positions = _positions(store, occurrence_ids)
    starts, ends, owners = _segment_columns(store)
    cross = starts[:, 0] * ends[:, 1] - starts[:, 1] * ends[:, 0]
    twice_area = np.bincount(owners, weights=cross, minlength=len(store))
    counts = np.diff(store.coordinate_offsets)
    first = store.coordinates[store.coordinate_offsets[:-1], :2]
    last = store.coordinates[store.coordinate_offsets[1:] - 1, :2]
    implicit_close = store.closed & (np.linalg.norm(first - last, axis=1) > 0)
    twice_area += np.where(
        implicit_close,
        last[:, 0] * first[:, 1] - last[:, 1] * first[:, 0],
        0.0,
    )
    values = np.where(store.closed, np.abs(twice_area) / 2.0, np.nan)
    batch = MeasurementBatch(
        occurrence_ids=store.occurrence_ids[positions],
        values=values[positions],
        unit=f"{snapshot.unit_status}^2",
        approximation_errors=store.approximation_errors[positions],
    )
    exactness = _exactness(store, positions)
    return successful_result(
        batch,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=exactness,
        evidence=_geometry_evidence(snapshot, positions),
        decision=Decision.APPROXIMATED if exactness is Exactness.APPROXIMATED_CURVE else Decision.COMPUTED,
        derivation=("vectorized shoelace sum over closed ragged coordinate groups",),
    )


@operator_registry.operator(
    OperatorSpec("measure.aabb", "1.0.0", "Batched axis-aligned bounds", "DrawingSnapshot+ids", "MeasurementBatch", Exactness.UNKNOWN)
)
def aabb(snapshot: DrawingSnapshot, occurrence_ids: Any | None = None) -> OpResult[MeasurementBatch]:
    store = snapshot.geometry
    positions = _positions(store, occurrence_ids)
    return successful_result(
        MeasurementBatch(
            occurrence_ids=store.occurrence_ids[positions],
            values=store.bounds[positions],
            unit=snapshot.unit_status,
            approximation_errors=store.approximation_errors[positions],
        ),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=_exactness(store, positions),
        evidence=_geometry_evidence(snapshot, positions),
        derivation=("columnar coordinate minima and maxima",),
    )


def _geometries(store: GeometryStore) -> np.ndarray:
    counts = np.diff(store.coordinate_offsets)
    result = np.empty(len(store), dtype=object)
    line_rows = np.flatnonzero(counts >= 2)
    if len(line_rows):
        owners = np.repeat(np.arange(len(store), dtype=np.int64), counts)
        selected = counts[owners] >= 2
        row_to_line = np.full(len(store), -1, dtype=np.int64)
        row_to_line[line_rows] = np.arange(len(line_rows), dtype=np.int64)
        result[line_rows] = shapely.linestrings(
            store.coordinates[selected, :2], indices=row_to_line[owners[selected]]
        )
    point_rows = np.flatnonzero(counts == 1)
    if len(point_rows):
        result[point_rows] = shapely.points(
            store.coordinates[store.coordinate_offsets[point_rows], :2]
        )
    return result


@operator_registry.operator(
    OperatorSpec("measure.obb", "1.0.0", "Batched minimum rotated bounds", "DrawingSnapshot+ids", "OrientedBoundsBatch", Exactness.FLOATING_CONSTRUCTION)
)
def obb(snapshot: DrawingSnapshot, occurrence_ids: Any | None = None) -> OpResult[OrientedBoundsBatch]:
    store = snapshot.geometry
    positions = _positions(store, occurrence_ids)
    geometries = _geometries(store)[positions]
    rectangles = shapely.minimum_rotated_rectangle(geometries)
    corners = np.empty((len(positions), 4, 2), dtype=np.float64)
    for index, rectangle in enumerate(rectangles):
        coordinates = shapely.get_coordinates(rectangle)[:, :2]
        type_id = int(shapely.get_type_id(rectangle))
        if type_id == 3 and len(coordinates) >= 5:  # Polygon, closing point repeated.
            polygon = coordinates[:-1]
            start = int(np.lexsort((polygon[:, 1], polygon[:, 0]))[0])
            corners[index] = np.roll(polygon, -start, axis=0)
        elif type_id == 1 and len(coordinates) == 2:  # Degenerate collinear box.
            order = np.lexsort((coordinates[:, 1], coordinates[:, 0]))
            first, second = coordinates[order]
            corners[index] = (first, second, second, first)
        elif type_id == 0 and len(coordinates) == 1:  # Point box.
            corners[index] = np.repeat(coordinates, 4, axis=0)
        else:
            raise ValueError("Geometry produced an unsupported minimum rotated rectangle")
    return successful_result(
        OrientedBoundsBatch(
            occurrence_ids=store.occurrence_ids[positions],
            corners=corners,
            approximation_errors=store.approximation_errors[positions],
        ),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=_exactness(store, positions),
        evidence=_geometry_evidence(snapshot, positions),
        derivation=("GEOS minimum rotated rectangle on normalized approximation views",),
    )


@operator_registry.operator(
    OperatorSpec("measure.distance", "1.0.0", "Batched analysis-plane geometry distance", "DrawingSnapshot+id-pairs", "MeasurementBatch", Exactness.UNKNOWN)
)
def distance(
    snapshot: DrawingSnapshot,
    occurrence_ids_a: Any,
    occurrence_ids_b: Any,
) -> OpResult[MeasurementBatch]:
    store = snapshot.geometry
    positions_a = np.atleast_1d(store.positions(occurrence_ids_a))
    positions_b = np.atleast_1d(store.positions(occurrence_ids_b))
    positions_a, positions_b = np.broadcast_arrays(positions_a, positions_b)
    geometries = _geometries(store)
    values = shapely.distance(geometries[positions_a], geometries[positions_b])
    errors = store.approximation_errors[positions_a] + store.approximation_errors[positions_b]
    selected = np.concatenate((positions_a.ravel(), positions_b.ravel()))
    return successful_result(
        MeasurementBatch(
            occurrence_ids=store.occurrence_ids[positions_a],
            values=values,
            unit=snapshot.unit_status,
            approximation_errors=errors,
        ),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=_exactness(store, selected),
        evidence=_geometry_evidence(snapshot, selected),
        derivation=("vectorized GEOS distance between normalized curve views",),
    )


@operator_registry.operator(
    OperatorSpec("measure.extent", "1.0.0", "Aggregate axis-aligned extent", "DrawingSnapshot+ids", "MeasurementBatch", Exactness.UNKNOWN)
)
def extent(snapshot: DrawingSnapshot, occurrence_ids: Any | None = None) -> OpResult[MeasurementBatch]:
    store = snapshot.geometry
    positions = _positions(store, occurrence_ids)
    if len(positions) == 0:
        values = np.asarray([[np.nan, np.nan, np.nan, np.nan]], dtype=np.float64)
        ids = np.asarray(["extent-empty"])
        errors = np.asarray([0.0])
    else:
        selected = store.bounds[positions]
        values = np.asarray(
            [[selected[:, 0].min(), selected[:, 1].min(), selected[:, 2].max(), selected[:, 3].max()]]
        )
        ids = np.asarray(["extent"])
        errors = np.asarray([store.approximation_errors[positions].max(initial=0.0)])
    return successful_result(
        MeasurementBatch(ids, values, snapshot.unit_status, errors),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=_exactness(store, positions),
        evidence=_geometry_evidence(snapshot, positions),
        derivation=("reduction over precomputed entity bounds",),
    )


@operator_registry.operator(
    OperatorSpec(
        "measure.angle",
        "1.0.0",
        "Batched unsigned angle from three points or two directed segments",
        "DrawingSnapshot+points|segments|occurrence_pairs",
        "MeasurementBatch",
        Exactness.FLOATING_CONSTRUCTION,
    )
)
def angle(
    snapshot: DrawingSnapshot,
    points: Any | None = None,
    *,
    segments: Any | None = None,
    occurrence_ids: tuple[Any, Any] | None = None,
    unit: str = "radian",
) -> OpResult[MeasurementBatch]:
    modes = sum(value is not None for value in (points, segments, occurrence_ids))
    if modes != 1:
        raise ValueError("measure.angle requires exactly one of points, segments, or occurrence_ids")
    selected_positions = np.empty(0, dtype=np.int64)
    evidence: tuple[EvidenceRef, ...] = ()
    errors: np.ndarray
    ids: np.ndarray

    if points is not None:
        values = np.asarray(points, dtype=np.float64)
        if values.ndim == 2:
            values = values[None, ...]
        if values.ndim != 3 or values.shape[1] != 3 or values.shape[2] not in (2, 3):
            raise ValueError("points must have shape (3,2|3) or (N,3,2|3)")
        if not np.isfinite(values).all():
            raise ValueError("angle points must be finite")
        first_vectors = values[:, 0] - values[:, 1]
        second_vectors = values[:, 2] - values[:, 1]
        ids = np.asarray([f"angle:points:{index}" for index in range(len(values))])
        errors = np.zeros(len(values), dtype=np.float64)
    elif occurrence_ids is not None:
        left = np.atleast_1d(snapshot.geometry.positions(occurrence_ids[0]))
        right = np.atleast_1d(snapshot.geometry.positions(occurrence_ids[1]))
        left, right = np.broadcast_arrays(left, right)

        def directions(rows: np.ndarray) -> np.ndarray:
            starts = snapshot.geometry.coordinate_offsets[rows]
            ends = snapshot.geometry.coordinate_offsets[rows + 1] - 1
            return (
                snapshot.geometry.coordinates[ends]
                - snapshot.geometry.coordinates[starts]
            )

        first_vectors = directions(left)
        second_vectors = directions(right)
        ids = np.asarray(
            [
                f"{snapshot.geometry.occurrence_ids[int(a)]}|{snapshot.geometry.occurrence_ids[int(b)]}"
                for a, b in zip(left.reshape(-1), right.reshape(-1))
            ]
        )
        errors = (
            snapshot.geometry.approximation_errors[left]
            + snapshot.geometry.approximation_errors[right]
        ).reshape(-1)
        selected_positions = np.concatenate((left.reshape(-1), right.reshape(-1)))
        evidence = _geometry_evidence(snapshot, selected_positions)
        first_vectors = first_vectors.reshape((-1, 3))
        second_vectors = second_vectors.reshape((-1, 3))
    else:
        raw_segments = np.asarray(segments)
        if raw_segments.dtype.kind in {"U", "S", "O"} and raw_segments.ndim == 1 and len(raw_segments) == 2:
            return angle(
                snapshot,
                occurrence_ids=(str(raw_segments[0]), str(raw_segments[1])),
                unit=unit,
            )
        values = np.asarray(segments, dtype=np.float64)
        if values.ndim == 3:
            values = values[None, ...]
        if values.ndim != 4 or values.shape[1:3] != (2, 2) or values.shape[3] not in (2, 3):
            raise ValueError("segments must have shape (2,2,2|3) or (N,2,2,2|3)")
        if not np.isfinite(values).all():
            raise ValueError("angle segments must be finite")
        first_vectors = values[:, 0, 1] - values[:, 0, 0]
        second_vectors = values[:, 1, 1] - values[:, 1, 0]
        ids = np.asarray([f"angle:segments:{index}" for index in range(len(values))])
        errors = np.zeros(len(values), dtype=np.float64)

    first_norms = np.linalg.norm(first_vectors, axis=1)
    second_norms = np.linalg.norm(second_vectors, axis=1)
    if np.any(first_norms == 0.0) or np.any(second_norms == 0.0):
        raise ValueError("measure.angle does not accept zero-length vectors")
    dots = np.einsum("ij,ij->i", first_vectors, second_vectors)
    if first_vectors.shape[1] == 2:
        cross_norms = np.abs(
            first_vectors[:, 0] * second_vectors[:, 1]
            - first_vectors[:, 1] * second_vectors[:, 0]
        )
    else:
        cross_norms = np.linalg.norm(np.cross(first_vectors, second_vectors), axis=1)
    values = np.arctan2(cross_norms, dots)
    normalized_unit = unit.casefold()
    if normalized_unit in {"degree", "degrees", "deg"}:
        values = np.degrees(values)
        output_unit = "degree"
    elif normalized_unit in {"radian", "radians", "rad"}:
        output_unit = "radian"
    else:
        raise ValueError("angle unit must be radian or degree")
    return successful_result(
        MeasurementBatch(ids, values, output_unit, errors),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.FLOATING_CONSTRUCTION,
        evidence=evidence,
        derivation=(
            "atan2(norm(cross), dot) unsigned angle in [0, pi]",
            "entity-segment mode uses each source curve's first and last stored points",
        ),
    )
