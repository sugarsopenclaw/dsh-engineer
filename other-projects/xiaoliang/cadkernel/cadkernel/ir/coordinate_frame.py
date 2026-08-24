from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from cadkernel._ids import stable_id
from cadkernel._serialization import stable_json_dumps, stable_json_loads
from cadkernel.contracts import PrecisionModel


class CoordinateOverflowError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class CoordinateFrame:
    origin: tuple[float, float, float]
    grid_size: float
    bounds: tuple[float, float, float, float]
    max_grid_delta: int
    precision_model_id: str

    @property
    def frame_id(self) -> str:
        return stable_id("coordinate-frame", self, length=64)

    @classmethod
    def from_bounds(
        cls,
        bounds: tuple[float, float, float, float],
        precision_model: PrecisionModel,
        *,
        origin_z: float = 0.0,
    ) -> "CoordinateFrame":
        min_x, min_y, max_x, max_y = (float(item) for item in bounds)
        values = np.asarray((min_x, min_y, max_x, max_y), dtype=np.float64)
        if not np.isfinite(values).all():
            raise ValueError("CoordinateFrame bounds must be finite")
        if max_x < min_x or max_y < min_y:
            raise ValueError("CoordinateFrame bounds are not ordered")
        span = max(max_x - min_x, max_y - min_y)
        if span > precision_model.max_region_span:
            raise CoordinateOverflowError(
                f"Region span {span:g} exceeds precision-model limit "
                f"{precision_model.max_region_span:g}"
            )
        midpoint_x = min_x + (max_x - min_x) / 2.0
        midpoint_y = min_y + (max_y - min_y) / 2.0
        # The rebase origin must itself lie on the precision grid. A half-grid
        # origin combined with half-even rounding can otherwise move opposite
        # endpoints in opposite directions and change an orientation sign.
        origin_x = float(np.rint(midpoint_x / precision_model.grid_size) * precision_model.grid_size)
        origin_y = float(np.rint(midpoint_y / precision_model.grid_size) * precision_model.grid_size)
        # ``quantize()`` is public and predicates may receive any point admitted
        # by the frame, not only the four coordinates used to construct it.  The
        # stored limit therefore bounds an individual rebased coordinate.  Two
        # admitted coordinates can differ by ``2*m`` and orient2d subtracts two
        # products, giving the conservative bound ``8*m^2``.
        scaled_bounds = (values.reshape((2, 2)) - np.asarray((origin_x, origin_y))) / precision_model.grid_size
        max_grid_delta = int(np.ceil(float(np.max(np.abs(scaled_bounds))))) + 1
        cross_bound = 8 * max_grid_delta * max_grid_delta
        safe_limit = int(np.iinfo(np.int64).max * precision_model.overflow_safety_factor)
        if cross_bound > safe_limit:
            raise CoordinateOverflowError(
                "int64 orient2d would overflow: "
                f"8*{max_grid_delta}^2={cross_bound} > {safe_limit}"
            )
        return cls(
            origin=(origin_x, origin_y, float(origin_z)),
            grid_size=precision_model.grid_size,
            bounds=(min_x, min_y, max_x, max_y),
            max_grid_delta=max_grid_delta,
            precision_model_id=precision_model.model_id,
        )

    def quantize(self, coordinates: Any) -> np.ndarray:
        points = np.asarray(coordinates, dtype=np.float64)
        if points.ndim == 0 or points.shape[-1] not in (2, 3):
            raise ValueError("Coordinates must have a final dimension of 2 or 3")
        if not np.isfinite(points).all():
            raise ValueError("Coordinates must be finite")
        origin = np.asarray(self.origin[: points.shape[-1]], dtype=np.float64)
        scaled = np.rint((points - origin) / self.grid_size)
        max_abs = float(np.max(np.abs(scaled), initial=0.0))
        if max_abs > self.max_grid_delta:
            raise CoordinateOverflowError(
                f"Coordinate lies outside frame (grid magnitude {max_abs:g})"
            )
        result = scaled.astype(np.int64)
        result.setflags(write=False)
        return result

    def dequantize(self, grid_coordinates: Any) -> np.ndarray:
        grid = np.asarray(grid_coordinates, dtype=np.int64)
        if grid.ndim == 0 or grid.shape[-1] not in (2, 3):
            raise ValueError("Grid coordinates must have a final dimension of 2 or 3")
        origin = np.asarray(self.origin[: grid.shape[-1]], dtype=np.float64)
        result = grid.astype(np.float64) * self.grid_size + origin
        result.setflags(write=False)
        return result

    def to_json(self) -> str:
        return stable_json_dumps(self)

    @classmethod
    def from_json(cls, payload: str) -> "CoordinateFrame":
        value = stable_json_loads(payload)
        return cls(
            origin=tuple(float(item) for item in value["origin"]),
            grid_size=float(value["grid_size"]),
            bounds=tuple(float(item) for item in value["bounds"]),
            max_grid_delta=int(value["max_grid_delta"]),
            precision_model_id=str(value["precision_model_id"]),
        )
