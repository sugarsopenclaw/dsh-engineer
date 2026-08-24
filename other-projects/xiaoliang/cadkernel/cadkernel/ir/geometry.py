from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Any

import numpy as np

from cadkernel._serialization import freeze_array
from cadkernel.ir.entities import _unicode_array


class GeometryKind(IntEnum):
    LINE = 1
    POLYLINE = 2
    ARC = 3
    CIRCLE = 4
    ELLIPSE = 5
    SPLINE = 6
    TEXT = 7
    POINT = 8
    HATCH_BOUNDARY = 9
    SOLID = 10
    UNSUPPORTED = 255


@dataclass(frozen=True, slots=True)
class GeometryRecord:
    occurrence_id: str
    definition_id: str
    kind: GeometryKind
    coordinates: tuple[tuple[float, float, float], ...]
    source_type: str
    closed: bool = False
    parameters: tuple[float, ...] = ()
    bulges: tuple[float, ...] = ()
    topology_eligible: bool = True
    approximation_error: float = 0.0
    annotation_derived: bool = False


@dataclass(frozen=True, slots=True, eq=False)
class GeometryStore:
    occurrence_ids: np.ndarray
    definition_ids: np.ndarray
    kinds: np.ndarray
    coordinate_offsets: np.ndarray
    coordinates: np.ndarray
    grid_coordinates: np.ndarray
    closed: np.ndarray
    parameters: np.ndarray
    bulge_offsets: np.ndarray
    bulges: np.ndarray
    source_types: np.ndarray
    topology_eligible: np.ndarray
    annotation_derived: np.ndarray
    approximation_errors: np.ndarray
    bounds: np.ndarray

    def __post_init__(self) -> None:
        object.__setattr__(self, "occurrence_ids", _unicode_array(self.occurrence_ids))
        object.__setattr__(self, "definition_ids", _unicode_array(self.definition_ids))
        object.__setattr__(self, "source_types", _unicode_array(self.source_types))
        row_count = len(self.occurrence_ids)
        if len(self.definition_ids) != row_count or len(self.source_types) != row_count:
            raise ValueError("GeometryStore identity columns must have equal length")
        kinds = freeze_array(self.kinds, dtype=np.uint8, ndim=1)
        offsets = freeze_array(self.coordinate_offsets, dtype=np.int64, ndim=1)
        coordinates = freeze_array(self.coordinates, dtype=np.float64, ndim=2)
        grid_coordinates = freeze_array(self.grid_coordinates, dtype=np.int64, ndim=2)
        closed = freeze_array(self.closed, dtype=np.bool_, ndim=1)
        parameters = freeze_array(self.parameters, dtype=np.float64, ndim=2)
        bulge_offsets = freeze_array(self.bulge_offsets, dtype=np.int64, ndim=1)
        bulges = freeze_array(self.bulges, dtype=np.float64, ndim=1)
        topology_eligible = freeze_array(self.topology_eligible, dtype=np.bool_, ndim=1)
        annotation_derived = freeze_array(self.annotation_derived, dtype=np.bool_, ndim=1)
        approximation_errors = freeze_array(self.approximation_errors, dtype=np.float64, ndim=1)
        bounds = freeze_array(self.bounds, dtype=np.float64, ndim=2)
        if kinds.shape != (row_count,):
            raise ValueError("kinds must have one value per geometry")
        if offsets.shape != (row_count + 1,) or offsets[0] != 0 or offsets[-1] != len(coordinates):
            raise ValueError("Invalid coordinate offsets")
        if coordinates.shape[1:] != (3,) or grid_coordinates.shape != (len(coordinates), 2):
            raise ValueError("Coordinates must be float64[N,3] and grid coordinates int64[N,2]")
        if np.any(offsets[1:] <= offsets[:-1]):
            raise ValueError("Each geometry must contain at least one coordinate")
        if (
            closed.shape != (row_count,)
            or topology_eligible.shape != (row_count,)
            or annotation_derived.shape != (row_count,)
        ):
            raise ValueError("Geometry flags must have one value per geometry")
        if parameters.shape != (row_count, 12):
            raise ValueError("parameters must have shape (N, 12)")
        if bulge_offsets.shape != (row_count + 1,) or bulge_offsets[0] != 0 or bulge_offsets[-1] != len(bulges):
            raise ValueError("Invalid bulge offsets")
        if approximation_errors.shape != (row_count,) or bounds.shape != (row_count, 4):
            raise ValueError("Invalid approximation or bounds columns")
        for name, value in (
            ("kinds", kinds),
            ("coordinate_offsets", offsets),
            ("coordinates", coordinates),
            ("grid_coordinates", grid_coordinates),
            ("closed", closed),
            ("parameters", parameters),
            ("bulge_offsets", bulge_offsets),
            ("bulges", bulges),
            ("topology_eligible", topology_eligible),
            ("annotation_derived", annotation_derived),
            ("approximation_errors", approximation_errors),
            ("bounds", bounds),
        ):
            object.__setattr__(self, name, value)

    def __len__(self) -> int:
        return len(self.occurrence_ids)

    def positions(self, occurrence_ids: Any) -> np.ndarray:
        requested = np.asarray(occurrence_ids, dtype=self.occurrence_ids.dtype)
        if requested.size == 0:
            positions = np.empty(requested.shape, dtype=np.int64)
            positions.setflags(write=False)
            return positions
        flat_requested = requested.reshape(-1)
        positions = np.searchsorted(self.occurrence_ids, flat_requested)
        safe = np.minimum(positions, max(len(self.occurrence_ids) - 1, 0))
        if len(self.occurrence_ids) == 0:
            raise KeyError(f"Unknown occurrence ids: {flat_requested.tolist()!r}")
        missing_mask = (positions >= len(self.occurrence_ids)) | (
            self.occurrence_ids[safe] != flat_requested
        )
        if np.any(missing_mask):
            missing = flat_requested[missing_mask]
            raise KeyError(f"Unknown occurrence ids: {missing.tolist()!r}")
        positions = positions.reshape(requested.shape)
        positions.setflags(write=False)
        return positions

    @classmethod
    def empty(cls) -> "GeometryStore":
        empty_text = np.asarray([], dtype="<U1")
        return cls(
            occurrence_ids=empty_text,
            definition_ids=empty_text,
            kinds=np.asarray([], dtype=np.uint8),
            coordinate_offsets=np.asarray([0], dtype=np.int64),
            coordinates=np.empty((0, 3), dtype=np.float64),
            grid_coordinates=np.empty((0, 2), dtype=np.int64),
            closed=np.asarray([], dtype=np.bool_),
            parameters=np.empty((0, 12), dtype=np.float64),
            bulge_offsets=np.asarray([0], dtype=np.int64),
            bulges=np.asarray([], dtype=np.float64),
            source_types=empty_text,
            topology_eligible=np.asarray([], dtype=np.bool_),
            annotation_derived=np.asarray([], dtype=np.bool_),
            approximation_errors=np.asarray([], dtype=np.float64),
            bounds=np.empty((0, 4), dtype=np.float64),
        )

    @classmethod
    def from_records(cls, records: list[GeometryRecord], *, quantize: Any) -> "GeometryStore":
        ordered = sorted(records, key=lambda record: record.occurrence_id)
        coords: list[tuple[float, float, float]] = []
        offsets = [0]
        bulges: list[float] = []
        bulge_offsets = [0]
        parameters = np.full((len(ordered), 12), np.nan, dtype=np.float64)
        bounds = np.empty((len(ordered), 4), dtype=np.float64)
        for index, record in enumerate(ordered):
            if not record.coordinates:
                raise ValueError(f"Geometry {record.occurrence_id} has no coordinates")
            record_coords = np.asarray(record.coordinates, dtype=np.float64)
            if record_coords.shape[1] != 3 or not np.isfinite(record_coords).all():
                raise ValueError(f"Invalid coordinates for {record.occurrence_id}")
            if record.closed and not np.array_equal(record_coords[0], record_coords[-1]):
                record_coords = np.concatenate((record_coords, record_coords[:1]), axis=0)
            coords.extend(tuple(float(value) for value in point) for point in record_coords)
            offsets.append(len(coords))
            bulges.extend(float(value) for value in record.bulges)
            bulge_offsets.append(len(bulges))
            parameters[index, : min(12, len(record.parameters))] = record.parameters[:12]
            bounds[index] = (
                float(record_coords[:, 0].min()),
                float(record_coords[:, 1].min()),
                float(record_coords[:, 0].max()),
                float(record_coords[:, 1].max()),
            )
        coordinate_array = np.asarray(coords, dtype=np.float64).reshape((-1, 3))
        grid_array = quantize(coordinate_array[:, :2]) if len(coordinate_array) else np.empty((0, 2), np.int64)
        return cls(
            occurrence_ids=[record.occurrence_id for record in ordered],
            definition_ids=[record.definition_id for record in ordered],
            kinds=[int(record.kind) for record in ordered],
            coordinate_offsets=offsets,
            coordinates=coordinate_array,
            grid_coordinates=grid_array,
            closed=[record.closed for record in ordered],
            parameters=parameters,
            bulge_offsets=bulge_offsets,
            bulges=bulges,
            source_types=[record.source_type for record in ordered],
            topology_eligible=[record.topology_eligible for record in ordered],
            annotation_derived=[record.annotation_derived for record in ordered],
            approximation_errors=[record.approximation_error for record in ordered],
            bounds=bounds,
        )
