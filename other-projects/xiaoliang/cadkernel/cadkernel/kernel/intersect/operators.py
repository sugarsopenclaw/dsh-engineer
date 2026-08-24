from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np
import shapely

from cadkernel.contracts import (
    Decision,
    EvidenceRef,
    Exactness,
    OperatorSpec,
    OpResult,
    OpStatus,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import CoordinateFrame, DrawingSnapshot, GeometryKind


class IntersectionKind(str, Enum):
    NONE = "none"
    POINT = "point"
    MULTI_POINT = "multi_point"
    OVERLAP_INTERVAL = "overlap_interval"
    OVERLAP_CURVE = "overlap_curve"
    AMBIGUOUS = "ambiguous"
    UNSUPPORTED = "unsupported"


@dataclass(frozen=True, slots=True)
class IntersectionRecord:
    kind: IntersectionKind
    pair_index: int
    occurrence_id_a: str | None = None
    occurrence_id_b: str | None = None
    points: tuple[tuple[float, float], ...] = ()
    parameters_a: tuple[tuple[float, float], ...] = ()
    parameters_b: tuple[tuple[float, float], ...] = ()


@dataclass(frozen=True, slots=True)
class IntersectionBatch:
    records: tuple[IntersectionRecord, ...]
    batch_shape: tuple[int, ...]


def _cross(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return left[:, 0] * right[:, 1] - left[:, 1] * right[:, 0]


@operator_registry.operator(
    OperatorSpec(
        "intersection.segment_segment",
        "1.1.0",
        "Checked-grid segment intersection including overlap intervals",
        "segment-pair-batch",
        "IntersectionBatch",
        Exactness.EXACT_PREDICATE,
    )
)
def intersect_segments(
    a_start: Any,
    a_end: Any,
    b_start: Any,
    b_end: Any,
    *,
    frame: CoordinateFrame,
    snapshot_id: str,
    evidence: tuple[EvidenceRef, ...] = (),
) -> OpResult[IntersectionBatch]:
    arrays = [np.asarray(value, dtype=np.float64) for value in (a_start, a_end, b_start, b_end)]
    if any(array.ndim == 0 or array.shape[-1] != 2 for array in arrays):
        raise ValueError("Segment endpoint arrays must end in dimension 2")
    broadcast = np.broadcast_arrays(*arrays)
    shape = broadcast[0].shape[:-1]
    flat = [array.reshape((-1, 2)) for array in broadcast]
    qa0, qa1, qb0, qb1 = (frame.quantize(array) for array in flat)
    r = qa1 - qa0
    s = qb1 - qb0
    q_minus_p = qb0 - qa0
    denominator = _cross(r, s)
    collinearity = _cross(q_minus_p, r)
    a_length_squared = np.sum(r * r, axis=1)
    b_length_squared = np.sum(s * s, axis=1)
    records: list[IntersectionRecord] = []

    for index in range(len(r)):
        if a_length_squared[index] == 0 or b_length_squared[index] == 0:
            records.append(IntersectionRecord(IntersectionKind.AMBIGUOUS, index))
            continue
        if denominator[index] == 0:
            if collinearity[index] != 0:
                records.append(IntersectionRecord(IntersectionKind.NONE, index))
                continue
            t0 = float(np.dot(q_minus_p[index], r[index]) / a_length_squared[index])
            t1 = float(t0 + np.dot(s[index], r[index]) / a_length_squared[index])
            start = max(0.0, min(t0, t1))
            end = min(1.0, max(t0, t1))
            if end < start:
                records.append(IntersectionRecord(IntersectionKind.NONE, index))
                continue
            start_point = flat[0][index] + start * (flat[1][index] - flat[0][index])
            if np.isclose(start, end, rtol=0.0, atol=1e-15):
                u = float(
                    np.dot(frame.quantize(start_point[None, :])[0] - qb0[index], s[index])
                    / b_length_squared[index]
                )
                records.append(
                    IntersectionRecord(
                        IntersectionKind.POINT,
                        index,
                        points=(tuple(float(value) for value in start_point),),
                        parameters_a=((start, start),),
                        parameters_b=((u, u),),
                    )
                )
                continue
            end_point = flat[0][index] + end * (flat[1][index] - flat[0][index])
            u0 = float(
                np.dot(frame.quantize(start_point[None, :])[0] - qb0[index], s[index])
                / b_length_squared[index]
            )
            u1 = float(
                np.dot(frame.quantize(end_point[None, :])[0] - qb0[index], s[index])
                / b_length_squared[index]
            )
            records.append(
                IntersectionRecord(
                    IntersectionKind.OVERLAP_INTERVAL,
                    index,
                    points=(
                        tuple(float(value) for value in start_point),
                        tuple(float(value) for value in end_point),
                    ),
                    parameters_a=((start, end),),
                    parameters_b=((min(u0, u1), max(u0, u1)),),
                )
            )
            continue

        t = float(_cross(q_minus_p[index : index + 1], s[index : index + 1])[0] / denominator[index])
        u = float(_cross(q_minus_p[index : index + 1], r[index : index + 1])[0] / denominator[index])
        if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
            point = flat[0][index] + t * (flat[1][index] - flat[0][index])
            records.append(
                IntersectionRecord(
                    IntersectionKind.POINT,
                    index,
                    points=(tuple(float(value) for value in point),),
                    parameters_a=((t, t),),
                    parameters_b=((u, u),),
                )
            )
        else:
            records.append(IntersectionRecord(IntersectionKind.NONE, index))

    exactness = Exactness.EXACT_PREDICATE
    decision = Decision.AMBIGUOUS if any(
        record.kind is IntersectionKind.AMBIGUOUS for record in records
    ) else Decision.COMPUTED
    ambiguous_count = sum(record.kind is IntersectionKind.AMBIGUOUS for record in records)
    return successful_result(
        IntersectionBatch(tuple(records), shape),
        snapshot_id=snapshot_id,
        coordinate_frame_id=frame.frame_id,
        exactness=exactness,
        decision=decision,
        status=(
            OpStatus.AMBIGUOUS
            if records and ambiguous_count == len(records)
            else OpStatus.PARTIAL
            if ambiguous_count
            else OpStatus.SUCCESS
        ),
        evidence=evidence,
        derivation=(
            "int64 grid cross products classify disjoint, point, and collinear overlap",
            "overlaps retain ordered parameter intervals on both source segments",
        ),
    )


def _snapshot_geometries(snapshot: DrawingSnapshot) -> np.ndarray:
    store = snapshot.geometry
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


def _parameters_for_points(line: object, points: list[tuple[float, float]]) -> tuple[tuple[float, float], ...]:
    return tuple(
        (value, value)
        for value in (
            float(shapely.line_locate_point(line, shapely.Point(point), normalized=True))
            for point in points
        )
    )


def _line_parts(geometry: object) -> list[object]:
    type_name = shapely.get_type_id(geometry)
    # Shapely ids: LineString=1, MultiLineString=5, GeometryCollection=7.
    if type_name == 1:
        return [geometry]
    if type_name in (5, 7):
        return [part for part in shapely.get_parts(geometry) if shapely.get_type_id(part) == 1]
    return []


def _point_parts(geometry: object) -> list[tuple[float, float]]:
    type_name = shapely.get_type_id(geometry)
    if type_name == 0:
        coordinate = shapely.get_coordinates(geometry)[0]
        return [(float(coordinate[0]), float(coordinate[1]))]
    if type_name in (4, 7):
        points: list[tuple[float, float]] = []
        for part in shapely.get_parts(geometry):
            if shapely.get_type_id(part) == 0:
                coordinate = shapely.get_coordinates(part)[0]
                points.append((float(coordinate[0]), float(coordinate[1])))
        return points
    return []


@operator_registry.operator(
    OperatorSpec(
        "intersection.geometry_pairs",
        "1.1.0",
        "Batched normalized-geometry intersection with seven result kinds",
        "DrawingSnapshot+id-pairs",
        "IntersectionBatch",
        Exactness.UNKNOWN,
    )
)
def intersect_geometry_pairs(
    snapshot: DrawingSnapshot,
    occurrence_ids_a: Any,
    occurrence_ids_b: Any,
) -> OpResult[IntersectionBatch]:
    """Vectorized GEOS construction with stable seven-kind result classification."""

    store = snapshot.geometry
    positions_a = store.positions(occurrence_ids_a)
    positions_b = store.positions(occurrence_ids_b)
    positions_a, positions_b = np.broadcast_arrays(positions_a, positions_b)
    shape = positions_a.shape
    flat_a = positions_a.ravel()
    flat_b = positions_b.ravel()
    geometries = _snapshot_geometries(snapshot)
    supported_kinds = np.asarray(
        [
            int(GeometryKind.LINE),
            int(GeometryKind.POLYLINE),
            int(GeometryKind.ARC),
            int(GeometryKind.CIRCLE),
            int(GeometryKind.ELLIPSE),
            int(GeometryKind.SPLINE),
            int(GeometryKind.POINT),
        ],
        dtype=np.uint8,
    )
    supported = np.isin(store.kinds[flat_a], supported_kinds) & np.isin(
        store.kinds[flat_b], supported_kinds
    )
    intersections = np.empty(len(flat_a), dtype=object)
    if np.any(supported):
        intersections[supported] = shapely.intersection(
            geometries[flat_a[supported]], geometries[flat_b[supported]]
        )
    records: list[IntersectionRecord] = []
    for index, (row_a, row_b) in enumerate(zip(flat_a, flat_b)):
        occurrence_a = str(store.occurrence_ids[row_a])
        occurrence_b = str(store.occurrence_ids[row_b])
        common = {
            "pair_index": index,
            "occurrence_id_a": occurrence_a,
            "occurrence_id_b": occurrence_b,
        }
        if not supported[index]:
            records.append(IntersectionRecord(kind=IntersectionKind.UNSUPPORTED, **common))
            continue
        intersection = intersections[index]
        if shapely.is_empty(intersection):
            records.append(IntersectionRecord(kind=IntersectionKind.NONE, **common))
            continue
        points = sorted(set(_point_parts(intersection)))
        lines = _line_parts(intersection)
        if points and lines:
            records.append(
                IntersectionRecord(
                    kind=IntersectionKind.AMBIGUOUS,
                    points=tuple(points),
                    **common,
                )
            )
            continue
        line_a = geometries[row_a]
        line_b = geometries[row_b]
        if lines:
            line_endpoints: list[tuple[float, float]] = []
            for line in lines:
                coordinates = shapely.get_coordinates(line)
                line_endpoints.extend(
                    [
                        (float(coordinates[0, 0]), float(coordinates[0, 1])),
                        (float(coordinates[-1, 0]), float(coordinates[-1, 1])),
                    ]
                )
            parameters_a = _parameters_for_points(line_a, line_endpoints)
            parameters_b = _parameters_for_points(line_b, line_endpoints)
            kind = (
                IntersectionKind.OVERLAP_INTERVAL
                if store.kinds[row_a] == int(GeometryKind.LINE)
                and store.kinds[row_b] == int(GeometryKind.LINE)
                and len(lines) == 1
                else IntersectionKind.OVERLAP_CURVE
            )
            records.append(
                IntersectionRecord(
                    kind=kind,
                    points=tuple(line_endpoints),
                    parameters_a=tuple(
                        (min(parameters_a[i], parameters_a[i + 1])[0], max(parameters_a[i], parameters_a[i + 1])[1])
                        for i in range(0, len(parameters_a), 2)
                    ),
                    parameters_b=tuple(
                        (min(parameters_b[i], parameters_b[i + 1])[0], max(parameters_b[i], parameters_b[i + 1])[1])
                        for i in range(0, len(parameters_b), 2)
                    ),
                    **common,
                )
            )
            continue
        if len(points) == 1:
            kind = IntersectionKind.POINT
        elif len(points) > 1:
            kind = IntersectionKind.MULTI_POINT
        else:
            kind = IntersectionKind.AMBIGUOUS
        records.append(
            IntersectionRecord(
                kind=kind,
                points=tuple(points),
                parameters_a=_parameters_for_points(line_a, points) if points else (),
                parameters_b=_parameters_for_points(line_b, points) if points else (),
                **common,
            )
        )
    approximation = np.any(store.approximation_errors[np.concatenate((flat_a, flat_b))] > 0)
    has_ambiguous = any(record.kind is IntersectionKind.AMBIGUOUS for record in records)
    has_unsupported = any(record.kind is IntersectionKind.UNSUPPORTED for record in records)
    unresolved_count = sum(
        record.kind in {IntersectionKind.AMBIGUOUS, IntersectionKind.UNSUPPORTED}
        for record in records
    )
    if records and unresolved_count == len(records):
        status = OpStatus.AMBIGUOUS if has_ambiguous else OpStatus.UNSUPPORTED
    elif unresolved_count:
        status = OpStatus.PARTIAL
    else:
        status = OpStatus.SUCCESS
    evidence_by_key: dict[tuple[str, tuple[float, float]], EvidenceRef] = {}
    for record, row_a, row_b in zip(records, flat_a, flat_b):
        for row, parameter_ranges in (
            (int(row_a), record.parameters_a),
            (int(row_b), record.parameters_b),
        ):
            parameter_range = (
                (
                    min(start for start, _ in parameter_ranges),
                    max(end for _, end in parameter_ranges),
                )
                if parameter_ranges
                else (0.0, 1.0)
            )
            occurrence_id = str(store.occurrence_ids[row])
            evidence_by_key[(occurrence_id, parameter_range)] = EvidenceRef(
                snapshot_id=snapshot.snapshot_id,
                occurrence_id=occurrence_id,
                definition_entity_id=str(store.definition_ids[row]),
                source_parameter_range=parameter_range,
                vertex_range=(
                    0,
                    int(
                        store.coordinate_offsets[row + 1]
                        - store.coordinate_offsets[row]
                        - 1
                    ),
                ),
            )
    evidence = tuple(evidence_by_key[key] for key in sorted(evidence_by_key))
    return successful_result(
        IntersectionBatch(tuple(records), shape),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.APPROXIMATED_CURVE if approximation else Exactness.FLOATING_CONSTRUCTION,
        decision=(
            Decision.AMBIGUOUS
            if has_ambiguous
            else Decision.UNSUPPORTED
            if has_unsupported
            else Decision.APPROXIMATED
            if approximation
            else Decision.COMPUTED
        ),
        status=status,
        evidence=evidence,
        derivation=(
            "vectorized GEOS intersection over explicit approximation views",
            "stable classification into none/point/multi-point/overlap-interval/overlap-curve/ambiguous/unsupported",
        ),
    )
