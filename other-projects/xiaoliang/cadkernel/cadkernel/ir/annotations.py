from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from cadkernel._serialization import freeze_array
from cadkernel.ir.entities import _unicode_array


@dataclass(frozen=True, slots=True)
class AnnotationTargetRef:
    """One authored or inferred target carried by an annotation record.

    A target point and a referenced source object are deliberately independent:
    LEADER/MULTILEADER commonly author an arrow point without an object handle,
    while associative HATCH paths commonly author handles without target points.
    """

    ref_kind: str
    occurrence_id: str | None = None
    source_handle: str | None = None
    point: tuple[float, float, float] | None = None
    authored: bool = True

    def __post_init__(self) -> None:
        if not self.ref_kind:
            raise ValueError("AnnotationTargetRef requires ref_kind")
        if self.point is not None:
            point = tuple(float(value) for value in self.point)
            if len(point) != 3 or not np.isfinite(point).all():
                raise ValueError("Annotation target point must be a finite Point3")
            object.__setattr__(self, "point", point)
        if not any((self.occurrence_id, self.source_handle, self.point is not None)):
            raise ValueError("AnnotationTargetRef requires a point or source reference")


@dataclass(frozen=True, slots=True)
class AnnotationRecord:
    occurrence_id: str
    definition_id: str
    annotation_kind: str
    source_type: str
    measured_value: float | None = None
    text_override: str | None = None
    measurement_scale: float | None = None
    definition_points: tuple[tuple[float, float, float], ...] = ()
    anchor_point: tuple[float, float, float] | None = None
    text_bounds: tuple[float, float, float, float] | None = None
    target_refs: tuple[AnnotationTargetRef, ...] = ()
    boundary_refs: tuple[str, ...] = ()
    pattern_name: str | None = None
    is_solid_fill: bool | None = None
    bounds: tuple[float, float, float, float] | None = None
    diagnostic_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.occurrence_id or not self.definition_id:
            raise ValueError("AnnotationRecord requires occurrence and definition ids")
        if not self.annotation_kind or not self.source_type:
            raise ValueError("AnnotationRecord requires kind and source_type")
        if self.measured_value is not None and not np.isfinite(self.measured_value):
            raise ValueError("measured_value must be finite when present")
        if self.measurement_scale is not None and not np.isfinite(self.measurement_scale):
            raise ValueError("measurement_scale must be finite when present")
        for point in self.definition_points:
            if len(point) != 3 or not np.isfinite(point).all():
                raise ValueError("definition_points must contain finite Point3 values")
        if self.anchor_point is not None:
            if len(self.anchor_point) != 3 or not np.isfinite(self.anchor_point).all():
                raise ValueError("anchor_point must be a finite Point3")
        for name in ("text_bounds", "bounds"):
            value = getattr(self, name)
            if value is None:
                continue
            if len(value) != 4 or not np.isfinite(value).all():
                raise ValueError(f"{name} must be finite AABB2 bounds")
            if value[2] < value[0] or value[3] < value[1]:
                raise ValueError(f"{name} must be ordered")


@dataclass(frozen=True, slots=True, eq=False)
class AnnotationStore:
    """Immutable struct-of-arrays store for authored annotation facts."""

    occurrence_ids: np.ndarray
    definition_ids: np.ndarray
    annotation_kinds: np.ndarray
    source_types: np.ndarray
    measured_values: np.ndarray
    measured_value_present: np.ndarray
    text_overrides: np.ndarray
    text_override_present: np.ndarray
    measurement_scales: np.ndarray
    measurement_scale_present: np.ndarray
    definition_point_offsets: np.ndarray
    definition_points: np.ndarray
    anchor_points: np.ndarray
    text_bounds: np.ndarray
    target_ref_offsets: np.ndarray
    target_ref_kinds: np.ndarray
    target_occurrence_ids: np.ndarray
    target_source_handles: np.ndarray
    target_points: np.ndarray
    target_authored: np.ndarray
    boundary_ref_offsets: np.ndarray
    boundary_refs: np.ndarray
    pattern_names: np.ndarray
    pattern_name_present: np.ndarray
    solid_fill_values: np.ndarray
    solid_fill_present: np.ndarray
    diagnostic_offsets: np.ndarray
    diagnostic_codes: np.ndarray
    bounds: np.ndarray

    def __post_init__(self) -> None:
        for name in (
            "occurrence_ids",
            "definition_ids",
            "annotation_kinds",
            "source_types",
            "text_overrides",
            "target_ref_kinds",
            "target_occurrence_ids",
            "target_source_handles",
            "boundary_refs",
            "pattern_names",
            "diagnostic_codes",
        ):
            object.__setattr__(self, name, _unicode_array(getattr(self, name)))
        row_count = len(self.occurrence_ids)
        if any(
            len(getattr(self, name)) != row_count
            for name in ("definition_ids", "annotation_kinds", "source_types", "text_overrides", "pattern_names")
        ):
            raise ValueError("AnnotationStore scalar text columns must have equal length")

        scalar_float = {
            "measured_values": freeze_array(self.measured_values, dtype=np.float64, ndim=1),
            "measurement_scales": freeze_array(self.measurement_scales, dtype=np.float64, ndim=1),
        }
        scalar_bool = {
            name: freeze_array(getattr(self, name), dtype=np.bool_, ndim=1)
            for name in (
                "measured_value_present",
                "text_override_present",
                "measurement_scale_present",
                "pattern_name_present",
                "solid_fill_values",
                "solid_fill_present",
            )
        }
        if any(array.shape != (row_count,) for array in (*scalar_float.values(), *scalar_bool.values())):
            raise ValueError("AnnotationStore scalar columns must have one value per annotation")

        definition_offsets = freeze_array(self.definition_point_offsets, dtype=np.int64, ndim=1)
        definition_points = freeze_array(self.definition_points, dtype=np.float64, ndim=2)
        anchor_points = freeze_array(self.anchor_points, dtype=np.float64, ndim=2)
        text_bounds = freeze_array(self.text_bounds, dtype=np.float64, ndim=2)
        bounds = freeze_array(self.bounds, dtype=np.float64, ndim=2)
        self._validate_offsets(definition_offsets, row_count, len(definition_points), "definition point")
        if definition_points.shape[1:] != (3,):
            raise ValueError("definition_points must have shape (N, 3)")
        if anchor_points.shape != (row_count, 3):
            raise ValueError("anchor_points must have shape (N, 3)")
        if text_bounds.shape != (row_count, 4) or bounds.shape != (row_count, 4):
            raise ValueError("Annotation bounds columns must have shape (N, 4)")

        target_offsets = freeze_array(self.target_ref_offsets, dtype=np.int64, ndim=1)
        target_points = freeze_array(self.target_points, dtype=np.float64, ndim=2)
        target_authored = freeze_array(self.target_authored, dtype=np.bool_, ndim=1)
        target_count = len(self.target_ref_kinds)
        self._validate_offsets(target_offsets, row_count, target_count, "target ref")
        if any(
            len(getattr(self, name)) != target_count
            for name in ("target_occurrence_ids", "target_source_handles")
        ):
            raise ValueError("Annotation target reference columns disagree")
        if target_points.shape != (target_count, 3) or target_authored.shape != (target_count,):
            raise ValueError("Annotation target point columns disagree")

        boundary_offsets = freeze_array(self.boundary_ref_offsets, dtype=np.int64, ndim=1)
        self._validate_offsets(boundary_offsets, row_count, len(self.boundary_refs), "boundary ref")
        diagnostic_offsets = freeze_array(self.diagnostic_offsets, dtype=np.int64, ndim=1)
        self._validate_offsets(diagnostic_offsets, row_count, len(self.diagnostic_codes), "diagnostic")

        for name, value in scalar_float.items():
            object.__setattr__(self, name, value)
        for name, value in scalar_bool.items():
            object.__setattr__(self, name, value)
        for name, value in (
            ("definition_point_offsets", definition_offsets),
            ("definition_points", definition_points),
            ("anchor_points", anchor_points),
            ("text_bounds", text_bounds),
            ("target_ref_offsets", target_offsets),
            ("target_points", target_points),
            ("target_authored", target_authored),
            ("boundary_ref_offsets", boundary_offsets),
            ("diagnostic_offsets", diagnostic_offsets),
            ("bounds", bounds),
        ):
            object.__setattr__(self, name, value)

    @staticmethod
    def _validate_offsets(
        offsets: np.ndarray,
        row_count: int,
        value_count: int,
        label: str,
    ) -> None:
        if (
            offsets.shape != (row_count + 1,)
            or offsets[0] != 0
            or offsets[-1] != value_count
            or np.any(offsets[1:] < offsets[:-1])
        ):
            raise ValueError(f"Invalid {label} offsets")

    def __len__(self) -> int:
        return len(self.occurrence_ids)

    def positions(self, occurrence_ids: Any) -> np.ndarray:
        requested = np.asarray(occurrence_ids, dtype=self.occurrence_ids.dtype)
        if requested.size == 0:
            result = np.empty(requested.shape, dtype=np.int64)
            result.setflags(write=False)
            return result
        if len(self) == 0:
            raise KeyError(f"Unknown annotation occurrence ids: {requested.reshape(-1).tolist()!r}")
        flat = requested.reshape(-1)
        positions = np.searchsorted(self.occurrence_ids, flat)
        safe = np.minimum(positions, len(self) - 1)
        missing = (positions >= len(self)) | (self.occurrence_ids[safe] != flat)
        if np.any(missing):
            raise KeyError(f"Unknown annotation occurrence ids: {flat[missing].tolist()!r}")
        result = positions.reshape(requested.shape)
        result.setflags(write=False)
        return result

    def target_refs_at(self, row: int) -> tuple[AnnotationTargetRef, ...]:
        start = int(self.target_ref_offsets[row])
        end = int(self.target_ref_offsets[row + 1])
        refs: list[AnnotationTargetRef] = []
        for index in range(start, end):
            point_values = self.target_points[index]
            point = None if np.isnan(point_values).all() else tuple(float(value) for value in point_values)
            occurrence_id = str(self.target_occurrence_ids[index]) or None
            source_handle = str(self.target_source_handles[index]) or None
            refs.append(
                AnnotationTargetRef(
                    ref_kind=str(self.target_ref_kinds[index]),
                    occurrence_id=occurrence_id,
                    source_handle=source_handle,
                    point=point,
                    authored=bool(self.target_authored[index]),
                )
            )
        return tuple(refs)

    @classmethod
    def empty(cls) -> "AnnotationStore":
        text = np.asarray([], dtype="<U1")
        return cls(
            occurrence_ids=text,
            definition_ids=text,
            annotation_kinds=text,
            source_types=text,
            measured_values=np.empty(0, dtype=np.float64),
            measured_value_present=np.empty(0, dtype=np.bool_),
            text_overrides=text,
            text_override_present=np.empty(0, dtype=np.bool_),
            measurement_scales=np.empty(0, dtype=np.float64),
            measurement_scale_present=np.empty(0, dtype=np.bool_),
            definition_point_offsets=np.asarray([0], dtype=np.int64),
            definition_points=np.empty((0, 3), dtype=np.float64),
            anchor_points=np.empty((0, 3), dtype=np.float64),
            text_bounds=np.empty((0, 4), dtype=np.float64),
            target_ref_offsets=np.asarray([0], dtype=np.int64),
            target_ref_kinds=text,
            target_occurrence_ids=text,
            target_source_handles=text,
            target_points=np.empty((0, 3), dtype=np.float64),
            target_authored=np.empty(0, dtype=np.bool_),
            boundary_ref_offsets=np.asarray([0], dtype=np.int64),
            boundary_refs=text,
            pattern_names=text,
            pattern_name_present=np.empty(0, dtype=np.bool_),
            solid_fill_values=np.empty(0, dtype=np.bool_),
            solid_fill_present=np.empty(0, dtype=np.bool_),
            diagnostic_offsets=np.asarray([0], dtype=np.int64),
            diagnostic_codes=text,
            bounds=np.empty((0, 4), dtype=np.float64),
        )

    @classmethod
    def from_records(cls, records: list[AnnotationRecord]) -> "AnnotationStore":
        ordered = sorted(records, key=lambda record: record.occurrence_id)
        if not ordered:
            return cls.empty()
        if len({record.occurrence_id for record in ordered}) != len(ordered):
            raise ValueError("Annotation occurrence ids must be unique")
        definition_points: list[tuple[float, float, float]] = []
        definition_offsets = [0]
        target_refs: list[AnnotationTargetRef] = []
        target_offsets = [0]
        boundary_refs: list[str] = []
        boundary_offsets = [0]
        diagnostics: list[str] = []
        diagnostic_offsets = [0]
        for record in ordered:
            definition_points.extend(record.definition_points)
            definition_offsets.append(len(definition_points))
            target_refs.extend(record.target_refs)
            target_offsets.append(len(target_refs))
            boundary_refs.extend(str(value) for value in record.boundary_refs)
            boundary_offsets.append(len(boundary_refs))
            diagnostics.extend(str(value) for value in record.diagnostic_codes)
            diagnostic_offsets.append(len(diagnostics))

        nan_point = (np.nan, np.nan, np.nan)
        nan_bounds = (np.nan, np.nan, np.nan, np.nan)
        return cls(
            occurrence_ids=[record.occurrence_id for record in ordered],
            definition_ids=[record.definition_id for record in ordered],
            annotation_kinds=[record.annotation_kind for record in ordered],
            source_types=[record.source_type for record in ordered],
            measured_values=[record.measured_value if record.measured_value is not None else np.nan for record in ordered],
            measured_value_present=[record.measured_value is not None for record in ordered],
            text_overrides=[record.text_override or "" for record in ordered],
            text_override_present=[record.text_override is not None for record in ordered],
            measurement_scales=[record.measurement_scale if record.measurement_scale is not None else np.nan for record in ordered],
            measurement_scale_present=[record.measurement_scale is not None for record in ordered],
            definition_point_offsets=definition_offsets,
            definition_points=np.asarray(definition_points, dtype=np.float64).reshape((-1, 3)),
            anchor_points=[record.anchor_point or nan_point for record in ordered],
            text_bounds=[record.text_bounds or nan_bounds for record in ordered],
            target_ref_offsets=target_offsets,
            target_ref_kinds=[ref.ref_kind for ref in target_refs],
            target_occurrence_ids=[ref.occurrence_id or "" for ref in target_refs],
            target_source_handles=[ref.source_handle or "" for ref in target_refs],
            target_points=np.asarray(
                [ref.point or nan_point for ref in target_refs],
                dtype=np.float64,
            ).reshape((-1, 3)),
            target_authored=[ref.authored for ref in target_refs],
            boundary_ref_offsets=boundary_offsets,
            boundary_refs=boundary_refs,
            pattern_names=[record.pattern_name or "" for record in ordered],
            pattern_name_present=[record.pattern_name is not None for record in ordered],
            solid_fill_values=[bool(record.is_solid_fill) for record in ordered],
            solid_fill_present=[record.is_solid_fill is not None for record in ordered],
            diagnostic_offsets=diagnostic_offsets,
            diagnostic_codes=diagnostics,
            bounds=[record.bounds or nan_bounds for record in ordered],
        )
