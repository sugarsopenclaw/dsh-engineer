from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Any

import numpy as np

from cadkernel._serialization import freeze_array
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    Exactness,
    OpResult,
    OperatorSpec,
    ToleranceProfile,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import CoordinateFrame


class TruthValue(IntEnum):
    FALSE = -1
    INDETERMINATE = 0
    TRUE = 1


@dataclass(frozen=True, slots=True, eq=False)
class OrientationBatch:
    signs: np.ndarray
    batch_shape: tuple[int, ...]

    def __post_init__(self) -> None:
        signs = freeze_array(self.signs, dtype=np.int8)
        if signs.shape != self.batch_shape:
            raise ValueError("Orientation signs and batch_shape disagree")
        if np.any((signs < -1) | (signs > 1)):
            raise ValueError("Orientation signs must be -1, 0, or 1")
        object.__setattr__(self, "signs", signs)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "OrientationBatch":
        return cls(np.asarray(value["signs"], dtype=np.int8), tuple(value["batch_shape"]))


@dataclass(frozen=True, slots=True, eq=False)
class PredicateBatch:
    truth: np.ndarray
    distance: np.ndarray
    batch_shape: tuple[int, ...]
    distance_unit: str

    def __post_init__(self) -> None:
        truth = freeze_array(self.truth, dtype=np.int8)
        distance = freeze_array(self.distance, dtype=np.float64)
        if truth.shape != self.batch_shape or distance.shape != self.batch_shape:
            raise ValueError("Predicate arrays and batch_shape disagree")
        if np.any((truth < -1) | (truth > 1)):
            raise ValueError("Predicate truth values must be -1, 0, or 1")
        object.__setattr__(self, "truth", truth)
        object.__setattr__(self, "distance", distance)

    @property
    def all_true(self) -> bool:
        return bool(np.all(self.truth == TruthValue.TRUE))

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "PredicateBatch":
        return cls(
            truth=np.asarray(value["truth"], dtype=np.int8),
            distance=np.asarray(value["distance"], dtype=np.float64),
            batch_shape=tuple(value["batch_shape"]),
            distance_unit=str(value["distance_unit"]),
        )


def _points2(*values: Any) -> tuple[list[np.ndarray], tuple[int, ...]]:
    arrays = [np.asarray(value, dtype=np.float64) for value in values]
    if any(array.ndim == 0 or array.shape[-1] != 2 for array in arrays):
        raise ValueError("2D point arrays must end in dimension 2")
    broadcast = np.broadcast_arrays(*arrays)
    shape = broadcast[0].shape[:-1]
    return [array.reshape((-1, 2)) for array in broadcast], shape


def _points3(*values: Any) -> tuple[list[np.ndarray], tuple[int, ...]]:
    arrays = [np.asarray(value, dtype=np.float64) for value in values]
    if any(array.ndim == 0 or array.shape[-1] != 3 for array in arrays):
        raise ValueError("3D point arrays must end in dimension 3")
    broadcast = np.broadcast_arrays(*arrays)
    shape = broadcast[0].shape[:-1]
    return [array.reshape((-1, 3)) for array in broadcast], shape


ORIENTATION_SPEC = OperatorSpec(
    operator_id="precision.orientation_2d",
    version="1.0.0",
    summary="Exact int64 grid orientation predicate",
    input_type="point-set[3]",
    output_type="OrientationBatch",
    exactness=Exactness.EXACT_PREDICATE,
)


@operator_registry.operator(ORIENTATION_SPEC)
def orientation_2d(
    a: Any,
    b: Any,
    c: Any,
    *,
    frame: CoordinateFrame,
    snapshot_id: str,
) -> OpResult[OrientationBatch]:
    points, batch_shape = _points2(a, b, c)
    qa, qb, qc = (frame.quantize(point) for point in points)
    ab = qb - qa
    ac = qc - qa
    cross = ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]
    signs = np.sign(cross).astype(np.int8).reshape(batch_shape)
    return successful_result(
        OrientationBatch(signs=signs, batch_shape=batch_shape),
        snapshot_id=snapshot_id,
        coordinate_frame_id=frame.frame_id,
        exactness=Exactness.EXACT_PREDICATE,
        derivation=("sign((bx-ax)*(cy-ay) - (by-ay)*(cx-ax)) on checked int64 grid",),
    )


def _predicate_result(
    truth: np.ndarray,
    distance: np.ndarray,
    shape: tuple[int, ...],
    *,
    distance_unit: str,
    snapshot_id: str,
    frame: CoordinateFrame,
    exactness: Exactness,
    derivation: tuple[str, ...],
    diagnostics: tuple[Diagnostic, ...] = (),
) -> OpResult[PredicateBatch]:
    batch = PredicateBatch(
        truth=np.asarray(truth, dtype=np.int8).reshape(shape),
        distance=np.asarray(distance, dtype=np.float64).reshape(shape),
        batch_shape=shape,
        distance_unit=distance_unit,
    )
    if np.all(batch.truth == TruthValue.TRUE):
        decision = Decision.PROVEN_TRUE
    elif np.all(batch.truth == TruthValue.FALSE):
        decision = Decision.PROVEN_FALSE
    else:
        decision = Decision.COMPUTED
    return successful_result(
        batch,
        snapshot_id=snapshot_id,
        coordinate_frame_id=frame.frame_id,
        exactness=exactness,
        decision=decision,
        diagnostics=diagnostics,
        derivation=derivation,
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.near_equal",
        "1.0.0",
        "Tolerance-derived 2D point equality",
        "point-pair",
        "PredicateBatch",
        Exactness.FLOATING_CONSTRUCTION,
        tolerance_fields=("numeric_equality",),
    )
)
def near_equal(
    a: Any,
    b: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    points, shape = _points2(a, b)
    distance = np.linalg.norm(points[0] - points[1], axis=1)
    truth = np.where(distance <= tolerance.numeric_equality, TruthValue.TRUE, TruthValue.FALSE)
    return _predicate_result(
        truth,
        distance,
        shape,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
        frame=frame,
        exactness=Exactness.FLOATING_CONSTRUCTION,
        derivation=("euclidean_distance(a,b) <= tolerance.numeric_equality",),
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.collinear",
        "1.0.0",
        "Checked-grid collinearity with engineering distance",
        "point-set[3]",
        "PredicateBatch",
        Exactness.EXACT_PREDICATE,
        tolerance_fields=("collinearity",),
    )
)
def collinear(
    a: Any,
    b: Any,
    c: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    points, shape = _points2(a, b, c)
    qa, qb, qc = (frame.quantize(point) for point in points)
    ab = qb - qa
    ac = qc - qa
    cross = ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]
    baseline = np.linalg.norm(ab.astype(np.float64), axis=1)
    degenerate = baseline == 0
    distance = np.full(len(baseline), np.nan, dtype=np.float64)
    valid = ~degenerate
    distance[valid] = np.abs(cross[valid].astype(np.float64)) / baseline[valid] * frame.grid_size
    truth = np.where(
        degenerate,
        TruthValue.INDETERMINATE,
        np.where(distance <= tolerance.collinearity, TruthValue.TRUE, TruthValue.FALSE),
    )
    diagnostics = ()
    if np.any(degenerate):
        diagnostics = (
            Diagnostic(
                code="DEGENERATE_BASELINE",
                message="Collinearity is indeterminate for coincident baseline points.",
                severity=DiagnosticSeverity.INFO,
            ),
        )
    return _predicate_result(
        truth,
        distance,
        shape,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
        frame=frame,
        exactness=Exactness.EXACT_PREDICATE,
        derivation=("exact int64 cross product, converted to perpendicular grid distance",),
        diagnostics=diagnostics,
    )


def _vector_angle_predicate(
    p0: Any,
    p1: Any,
    q0: Any,
    q1: Any,
    *,
    frame: CoordinateFrame,
    angular_tolerance: float,
    perpendicular_mode: bool,
    distance_unit: str,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    points, shape = _points2(p0, p1, q0, q1)
    qp0, qp1, qq0, qq1 = (frame.quantize(point) for point in points)
    u = qp1 - qp0
    v = qq1 - qq0
    norm_product = np.linalg.norm(u.astype(np.float64), axis=1) * np.linalg.norm(
        v.astype(np.float64), axis=1
    )
    degenerate = norm_product == 0
    if perpendicular_mode:
        numerator = np.abs(np.sum(u * v, axis=1).astype(np.float64))
        derivation = "asin(|dot(u,v)|/(|u||v|)) <= perpendicular angular tolerance"
    else:
        numerator = np.abs((u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]).astype(np.float64))
        derivation = "asin(|cross(u,v)|/(|u||v|)) <= parallel angular tolerance"
    ratio = np.zeros_like(norm_product)
    np.divide(numerator, norm_product, out=ratio, where=~degenerate)
    deviation = np.arcsin(np.clip(ratio, 0.0, 1.0))
    deviation[degenerate] = np.nan
    truth = np.where(
        degenerate,
        TruthValue.INDETERMINATE,
        np.where(deviation <= angular_tolerance, TruthValue.TRUE, TruthValue.FALSE),
    )
    diagnostics = ()
    if np.any(degenerate):
        diagnostics = (
            Diagnostic(
                code="ZERO_LENGTH_VECTOR",
                message="Angular relation is indeterminate for a zero-length vector.",
                severity=DiagnosticSeverity.INFO,
            ),
        )
    return _predicate_result(
        truth,
        deviation,
        shape,
        distance_unit="radian",
        snapshot_id=snapshot_id,
        frame=frame,
        exactness=Exactness.GRID_SNAPPED,
        derivation=(derivation,),
        diagnostics=diagnostics,
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.parallel",
        "1.0.0",
        "Checked-grid parallel direction predicate",
        "segment-pair",
        "PredicateBatch",
        Exactness.GRID_SNAPPED,
        tolerance_fields=("parallel_angle",),
    )
)
def parallel(
    p0: Any,
    p1: Any,
    q0: Any,
    q1: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    return _vector_angle_predicate(
        p0,
        p1,
        q0,
        q1,
        frame=frame,
        angular_tolerance=tolerance.parallel_angle,
        perpendicular_mode=False,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.perpendicular",
        "1.0.0",
        "Checked-grid perpendicular direction predicate",
        "segment-pair",
        "PredicateBatch",
        Exactness.GRID_SNAPPED,
        tolerance_fields=("perpendicular_angle",),
    )
)
def perpendicular(
    p0: Any,
    p1: Any,
    q0: Any,
    q1: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    return _vector_angle_predicate(
        p0,
        p1,
        q0,
        q1,
        frame=frame,
        angular_tolerance=tolerance.perpendicular_angle,
        perpendicular_mode=True,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.point_on_segment",
        "1.0.0",
        "Bounded projection and distance point-on-segment predicate",
        "point-segment",
        "PredicateBatch",
        Exactness.GRID_SNAPPED,
        tolerance_fields=("endpoint_snap", "collinearity"),
    )
)
def point_on_segment(
    point: Any,
    start: Any,
    end: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    points, shape = _points2(point, start, end)
    p, a, b = (frame.quantize(value) for value in points)
    ab = b - a
    ap = p - a
    length_squared = np.sum(ab * ab, axis=1)
    degenerate = length_squared == 0
    t = np.zeros(len(ab), dtype=np.float64)
    np.divide(np.sum(ap * ab, axis=1), length_squared, out=t, where=~degenerate)
    projected = a.astype(np.float64) + np.clip(t, 0.0, 1.0)[:, None] * ab
    distance = np.linalg.norm(p - projected, axis=1) * frame.grid_size
    param_slack = np.zeros_like(t)
    lengths = np.sqrt(length_squared.astype(np.float64)) * frame.grid_size
    np.divide(tolerance.endpoint_snap, lengths, out=param_slack, where=~degenerate)
    within = (t >= -param_slack) & (t <= 1.0 + param_slack)
    truth = np.where(
        degenerate,
        TruthValue.INDETERMINATE,
        np.where(within & (distance <= tolerance.collinearity), TruthValue.TRUE, TruthValue.FALSE),
    )
    return _predicate_result(
        truth,
        distance,
        shape,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
        frame=frame,
        exactness=Exactness.GRID_SNAPPED,
        derivation=("bounded projection and perpendicular distance on the int64 local grid",),
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.closed",
        "1.0.0",
        "Endpoint closure predicate under explicit topology tolerance",
        "point-pair",
        "PredicateBatch",
        Exactness.GRID_SNAPPED,
        tolerance_fields=("topological_closure",),
    )
)
def closed(
    first: Any,
    last: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    points, shape = _points2(first, last)
    first_grid, last_grid = (frame.quantize(value) for value in points)
    distance = (
        np.linalg.norm((first_grid - last_grid).astype(np.float64), axis=1)
        * frame.grid_size
    )
    truth = np.where(distance <= tolerance.topological_closure, TruthValue.TRUE, TruthValue.FALSE)
    return _predicate_result(
        truth,
        distance,
        shape,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
        frame=frame,
        exactness=Exactness.GRID_SNAPPED,
        derivation=("int64-grid endpoint distance <= tolerance.topological_closure",),
    )


@operator_registry.operator(
    OperatorSpec(
        "precision.coplanar",
        "1.0.0",
        "Point-to-plane coplanarity predicate",
        "point-set[4]",
        "PredicateBatch",
        Exactness.FLOATING_CONSTRUCTION,
        tolerance_fields=("coplanarity", "numeric_equality"),
    )
)
def coplanar(
    a: Any,
    b: Any,
    c: Any,
    point: Any,
    *,
    frame: CoordinateFrame,
    tolerance: ToleranceProfile,
    snapshot_id: str,
) -> OpResult[PredicateBatch]:
    points, shape = _points3(a, b, c, point)
    pa, pb, pc, query = points
    normals = np.cross(pb - pa, pc - pa)
    normal_length = np.linalg.norm(normals, axis=1)
    degenerate = normal_length <= tolerance.numeric_equality
    distance = np.full(len(normal_length), np.nan, dtype=np.float64)
    np.divide(
        np.abs(np.sum((query - pa) * normals, axis=1)),
        normal_length,
        out=distance,
        where=~degenerate,
    )
    truth = np.where(
        degenerate,
        TruthValue.INDETERMINATE,
        np.where(distance <= tolerance.coplanarity, TruthValue.TRUE, TruthValue.FALSE),
    )
    return _predicate_result(
        truth,
        distance,
        shape,
        distance_unit=tolerance.linear_unit,
        snapshot_id=snapshot_id,
        frame=frame,
        exactness=Exactness.FLOATING_CONSTRUCTION,
        derivation=("absolute point-to-plane distance <= tolerance.coplanarity",),
    )
