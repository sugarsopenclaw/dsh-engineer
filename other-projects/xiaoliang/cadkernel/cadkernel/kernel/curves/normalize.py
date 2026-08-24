from __future__ import annotations

import math
from typing import Any

import numpy as np

from cadkernel.contracts import Exactness, OperatorSpec, operator_registry
from cadkernel.kernel.curves.models import ApproximationView, SourceCurve, SplineDefinition


def _arc_segment_count(
    radius: float,
    sweep: float,
    chord_error: float,
    max_segment_length: float,
) -> int:
    arc_length = abs(radius * sweep)
    by_length = max(1, int(math.ceil(arc_length / max_segment_length)))
    if radius <= chord_error:
        by_error = max(1, int(math.ceil(abs(sweep) / math.pi)))
    else:
        max_angle = 2.0 * math.acos(max(-1.0, min(1.0, 1.0 - chord_error / radius)))
        by_error = max(1, int(math.ceil(abs(sweep) / max(max_angle, 1e-12))))
    return max(by_length, by_error)


def _angle_sweep(start_angle: float, end_angle: float, ccw: bool) -> float:
    tau = 2.0 * math.pi
    if ccw:
        return (end_angle - start_angle) % tau or tau
    return -((start_angle - end_angle) % tau or tau)


@operator_registry.operator(
    OperatorSpec("curve.approximate_arc", "1.0.0", "Bounded analytic arc approximation", "SourceCurve+arc-parameters", "ApproximationView", Exactness.APPROXIMATED_CURVE, requires_coordinate_frame=False)
)
def approximate_arc(
    source: SourceCurve,
    *,
    center: tuple[float, float, float],
    radius: float,
    start_angle: float,
    end_angle: float,
    ccw: bool = True,
    chord_error: float,
    max_segment_length: float,
) -> ApproximationView:
    if radius <= 0:
        raise ValueError("Arc radius must be positive")
    sweep = _angle_sweep(start_angle, end_angle, ccw)
    segment_count = _arc_segment_count(radius, sweep, chord_error, max_segment_length)
    angles = np.linspace(start_angle, start_angle + sweep, segment_count + 1, dtype=np.float64)
    coordinates = np.column_stack(
        (
            center[0] + radius * np.cos(angles),
            center[1] + radius * np.sin(angles),
            np.full_like(angles, center[2]),
        )
    )
    measured = radius * (1.0 - math.cos(abs(sweep) / segment_count / 2.0))
    return ApproximationView(
        source=source,
        coordinates=coordinates,
        chord_error=chord_error,
        measured_chord_error=measured,
        max_segment_length=max_segment_length,
    )


@operator_registry.operator(
    OperatorSpec("curve.approximate_circle", "1.0.0", "Bounded analytic circle approximation", "SourceCurve+circle-parameters", "ApproximationView", Exactness.APPROXIMATED_CURVE, requires_coordinate_frame=False)
)
def approximate_circle(
    source: SourceCurve,
    *,
    center: tuple[float, float, float],
    radius: float,
    chord_error: float,
    max_segment_length: float,
) -> ApproximationView:
    return approximate_arc(
        source,
        center=center,
        radius=radius,
        start_angle=0.0,
        end_angle=2.0 * math.pi,
        ccw=True,
        chord_error=chord_error,
        max_segment_length=max_segment_length,
    )


@operator_registry.operator(
    OperatorSpec("curve.bulge_to_arc", "1.0.0", "Construct an analytic arc from a bulge segment", "point-pair+bulge", "ArcParameters", Exactness.FLOATING_CONSTRUCTION, requires_coordinate_frame=False)
)
def bulge_to_arc(
    start: Any,
    end: Any,
    bulge: float,
) -> tuple[tuple[float, float, float], float, float, float, bool]:
    p0 = np.asarray(start, dtype=np.float64)
    p1 = np.asarray(end, dtype=np.float64)
    if p0.shape != (3,) or p1.shape != (3,):
        raise ValueError("Bulge endpoints must be 3D points")
    chord_vector = p1[:2] - p0[:2]
    chord = float(np.linalg.norm(chord_vector))
    if chord == 0 or abs(bulge) < 1e-15:
        raise ValueError("A bulge arc requires distinct endpoints and non-zero bulge")
    midpoint = (p0[:2] + p1[:2]) / 2.0
    left_normal = np.asarray((-chord_vector[1], chord_vector[0])) / chord
    center_offset = chord * (1.0 - bulge * bulge) / (4.0 * bulge)
    center_xy = midpoint + left_normal * center_offset
    radius = chord * (1.0 + bulge * bulge) / (4.0 * abs(bulge))
    start_angle = math.atan2(p0[1] - center_xy[1], p0[0] - center_xy[0])
    end_angle = math.atan2(p1[1] - center_xy[1], p1[0] - center_xy[0])
    center = (float(center_xy[0]), float(center_xy[1]), float((p0[2] + p1[2]) / 2.0))
    return center, radius, start_angle, end_angle, bulge > 0


@operator_registry.operator(
    OperatorSpec("curve.approximate_bulged_polyline", "1.0.0", "Bounded polyline bulge expansion", "SourceCurve+bulges", "ApproximationView", Exactness.APPROXIMATED_CURVE, requires_coordinate_frame=False)
)
def approximate_bulged_polyline(
    source: SourceCurve,
    *,
    points: Any,
    bulges: Any,
    closed: bool,
    chord_error: float,
    max_segment_length: float,
) -> ApproximationView:
    vertices = np.asarray(points, dtype=np.float64)
    bulge_values = np.asarray(bulges, dtype=np.float64)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or len(vertices) < 2:
        raise ValueError("Polyline vertices must have shape (N>=2, 3)")
    segment_count = len(vertices) if closed else len(vertices) - 1
    if len(bulge_values) not in (segment_count, len(vertices)):
        raise ValueError("Bulge count must cover every polyline segment")
    pieces: list[np.ndarray] = []
    measured_error = 0.0
    for index in range(segment_count):
        start = vertices[index]
        end = vertices[(index + 1) % len(vertices)]
        bulge = float(bulge_values[index])
        if abs(bulge) < 1e-15:
            segment_length = float(np.linalg.norm(end[:2] - start[:2]))
            subdivisions = max(1, int(math.ceil(segment_length / max_segment_length)))
            piece = np.linspace(start, end, subdivisions + 1, dtype=np.float64)
        else:
            center, radius, start_angle, end_angle, ccw = bulge_to_arc(start, end, bulge)
            arc_source = SourceCurve(
                occurrence_id=source.occurrence_id,
                definition_id=source.definition_id,
                curve_type="BULGE_ARC",
                control_points=(tuple(start), tuple(end)),
                parameters=(("bulge", bulge),),
            )
            view = approximate_arc(
                arc_source,
                center=center,
                radius=radius,
                start_angle=start_angle,
                end_angle=end_angle,
                ccw=ccw,
                chord_error=chord_error,
                max_segment_length=max_segment_length,
            )
            piece = view.coordinates
            measured_error = max(measured_error, view.measured_chord_error)
        pieces.append(piece if index == 0 else piece[1:])
    coordinates = np.concatenate(pieces, axis=0)
    return ApproximationView(
        source=source,
        coordinates=coordinates,
        chord_error=chord_error,
        measured_chord_error=measured_error,
        max_segment_length=max_segment_length,
    )


@operator_registry.operator(
    OperatorSpec("curve.approximate_ellipse", "1.0.0", "Bounded analytic ellipse approximation", "SourceCurve+ellipse-parameters", "ApproximationView", Exactness.APPROXIMATED_CURVE, requires_coordinate_frame=False)
)
def approximate_ellipse(
    source: SourceCurve,
    *,
    center: tuple[float, float, float],
    major_axis: tuple[float, float, float],
    normal: tuple[float, float, float] = (0.0, 0.0, 1.0),
    ratio: float,
    start_parameter: float,
    end_parameter: float,
    chord_error: float,
    max_segment_length: float,
) -> ApproximationView:
    major = np.asarray(major_axis, dtype=np.float64)
    normal_array = np.asarray(normal, dtype=np.float64)
    major_radius = float(np.linalg.norm(major))
    normal_length = float(np.linalg.norm(normal_array))
    if major_radius == 0 or normal_length == 0 or ratio <= 0:
        raise ValueError("Ellipse major axis, normal, and ratio must be positive")
    normal_unit = normal_array / normal_length
    minor_direction = np.cross(normal_unit, major / major_radius)
    minor_direction_length = float(np.linalg.norm(minor_direction))
    if minor_direction_length <= 1e-12:
        raise ValueError("Ellipse major axis must not be parallel to its normal")
    minor = minor_direction / minor_direction_length * major_radius * ratio
    sweep = (end_parameter - start_parameter) % (2.0 * math.pi) or 2.0 * math.pi
    # The largest radius is a safe curvature/length bound for segmentation.
    max_radius = max(major_radius, major_radius * ratio)
    segment_count = _arc_segment_count(max_radius, sweep, chord_error, max_segment_length)
    parameters = np.linspace(start_parameter, start_parameter + sweep, segment_count + 1)
    center_array = np.asarray(center, dtype=np.float64)
    coordinates = (
        center_array
        + np.cos(parameters)[:, None] * major
        + np.sin(parameters)[:, None] * minor
    )
    measured = max_radius * (1.0 - math.cos(sweep / segment_count / 2.0))
    return ApproximationView(
        source=source,
        coordinates=coordinates,
        chord_error=chord_error,
        measured_chord_error=measured,
        max_segment_length=max_segment_length,
    )


def _basis_matrix(parameters: np.ndarray, knots: np.ndarray, degree: int, count: int) -> np.ndarray:
    # Cox-de Boor dynamic program, vectorized across all parameter samples.
    work = np.zeros((len(parameters), count + degree), dtype=np.float64)
    for index in range(count + degree):
        work[:, index] = (parameters >= knots[index]) & (parameters < knots[index + 1])
    for order in range(1, degree + 1):
        next_work = np.zeros_like(work)
        for index in range(count + degree - order):
            left_denominator = knots[index + order] - knots[index]
            right_denominator = knots[index + order + 1] - knots[index + 1]
            if left_denominator > 0:
                next_work[:, index] += (
                    (parameters - knots[index]) / left_denominator * work[:, index]
                )
            if right_denominator > 0:
                next_work[:, index] += (
                    (knots[index + order + 1] - parameters)
                    / right_denominator
                    * work[:, index + 1]
                )
        work = next_work
    basis = work[:, :count]
    end_mask = np.isclose(parameters, knots[-1], rtol=0.0, atol=1e-14)
    basis[end_mask] = 0.0
    basis[end_mask, -1] = 1.0
    return basis


def _evaluate_spline(definition: SplineDefinition, parameters: np.ndarray) -> np.ndarray:
    controls = np.asarray(definition.source.control_points, dtype=np.float64)
    knots = np.asarray(definition.knots, dtype=np.float64)
    basis = _basis_matrix(parameters, knots, definition.degree, len(controls))
    if definition.weights:
        weights = np.asarray(definition.weights, dtype=np.float64)
        weighted = basis * weights[None, :]
        denominator = weighted.sum(axis=1)
        if np.any(denominator == 0):
            raise ValueError("Rational spline has a zero homogeneous denominator")
        return weighted @ controls / denominator[:, None]
    return basis @ controls


def _point_to_segments(points: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> np.ndarray:
    vectors = ends - starts
    denominator = np.sum(vectors * vectors, axis=1)
    parameters = np.zeros(len(points), dtype=np.float64)
    np.divide(
        np.sum((points - starts) * vectors, axis=1),
        denominator,
        out=parameters,
        where=denominator > 0,
    )
    projections = starts + np.clip(parameters, 0.0, 1.0)[:, None] * vectors
    return np.linalg.norm(points - projections, axis=1)


@operator_registry.operator(
    OperatorSpec("curve.approximate_spline", "1.0.0", "Adaptive spline approximation with observed midpoint deviation", "SplineDefinition", "ApproximationView", Exactness.APPROXIMATED_CURVE, requires_coordinate_frame=False)
)
def approximate_spline(
    definition: SplineDefinition,
    *,
    chord_error: float,
    max_segment_length: float,
    maximum_segments: int = 65_536,
) -> ApproximationView:
    controls = np.asarray(definition.source.control_points, dtype=np.float64)
    control_length = float(np.linalg.norm(np.diff(controls, axis=0), axis=1).sum())
    segment_count = max(8, int(math.ceil(control_length / max_segment_length)))
    parameter_start = float(definition.knots[definition.degree])
    parameter_end = float(definition.knots[-definition.degree - 1])
    measured = math.inf
    coordinates = np.empty((0, 3), dtype=np.float64)
    while segment_count <= maximum_segments:
        parameters = np.linspace(parameter_start, parameter_end, segment_count + 1)
        coordinates = _evaluate_spline(definition, parameters)
        midpoint_parameters = (parameters[:-1] + parameters[1:]) / 2.0
        midpoints = _evaluate_spline(definition, midpoint_parameters)
        errors = _point_to_segments(midpoints, coordinates[:-1], coordinates[1:])
        lengths = np.linalg.norm(np.diff(coordinates, axis=0), axis=1)
        measured = float(errors.max(initial=0.0))
        if measured <= chord_error and float(lengths.max(initial=0.0)) <= max_segment_length:
            break
        segment_count *= 2
    if segment_count > maximum_segments:
        raise ValueError("Spline approximation exceeded maximum_segments before meeting tolerances")
    return ApproximationView(
        source=definition.source,
        coordinates=coordinates,
        chord_error=chord_error,
        measured_chord_error=measured,
        max_segment_length=max_segment_length,
    )
