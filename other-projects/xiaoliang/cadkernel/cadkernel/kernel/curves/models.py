from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cadkernel._serialization import freeze_array, stable_json_dumps


@dataclass(frozen=True, slots=True)
class SourceCurve:
    occurrence_id: str
    definition_id: str
    curve_type: str
    control_points: tuple[tuple[float, float, float], ...]
    parameters: tuple[tuple[str, float | int | bool | str], ...] = ()
    knots: tuple[float, ...] = ()
    weights: tuple[float, ...] = ()

    @property
    def parameter_map(self) -> dict[str, float | int | bool | str]:
        return dict(self.parameters)


@dataclass(frozen=True, slots=True)
class SplineDefinition:
    source: SourceCurve
    degree: int
    knots: tuple[float, ...]
    weights: tuple[float, ...] = ()
    periodic: bool = False
    closed: bool = False

    def __post_init__(self) -> None:
        point_count = len(self.source.control_points)
        if self.degree < 1 or self.degree >= point_count:
            raise ValueError("Spline degree must be between 1 and control-point-count - 1")
        if len(self.knots) != point_count + self.degree + 1:
            raise ValueError("Invalid B-spline knot count")
        if self.weights and len(self.weights) != point_count:
            raise ValueError("Spline weights must match control points")
        if any(b < a for a, b in zip(self.knots, self.knots[1:])):
            raise ValueError("Spline knots must be non-decreasing")


@dataclass(frozen=True, slots=True, eq=False)
class ApproximationView:
    source: SourceCurve
    coordinates: np.ndarray
    chord_error: float
    measured_chord_error: float
    max_segment_length: float
    approximation_version: str = "curve-flatten-v1"

    def __post_init__(self) -> None:
        coordinates = freeze_array(self.coordinates, dtype=np.float64, ndim=2)
        if coordinates.shape[1] != 3 or len(coordinates) < 2:
            raise ValueError("Curve approximation requires float64[N>=2,3] coordinates")
        if not np.isfinite(coordinates).all():
            raise ValueError("Curve approximation coordinates must be finite")
        if self.chord_error <= 0 or self.max_segment_length <= 0:
            raise ValueError("Approximation limits must be positive")
        if self.measured_chord_error < 0:
            raise ValueError("measured_chord_error must be non-negative")
        object.__setattr__(self, "coordinates", coordinates)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ApproximationView) and stable_json_dumps(self) == stable_json_dumps(other)

