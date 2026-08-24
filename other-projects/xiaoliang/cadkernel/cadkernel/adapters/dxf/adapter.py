from __future__ import annotations

import json
import math
import unicodedata
from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import ezdxf
import numpy as np
from ezdxf import bbox as ezdxf_bbox
from ezdxf.entities import DXFGraphic, Insert
from ezdxf.path import from_hatch

from cadkernel._ids import sha256_file, stable_id, stable_text_id
from cadkernel._serialization import stable_json_dumps
from cadkernel.adapters.dxf.dwg import ConversionProvenance
from cadkernel.adapters.dxf.transform import TransformClass, classify_transform
from cadkernel.contracts import Diagnostic, DiagnosticSeverity, PrecisionModel, ToleranceProfile
from cadkernel.ir import (
    AnnotationRecord,
    AnnotationStore,
    AnnotationTargetRef,
    CoordinateFrame,
    CoordinateOverflowError,
    DrawingSnapshot,
    EntityDefinitionTable,
    EntityOccurrenceTable,
    GeometryKind,
    GeometryRecord,
    GeometryStore,
    TextStore,
)
from cadkernel.kernel.curves import (
    ApproximationView,
    SourceCurve,
    approximate_arc,
    approximate_bulged_polyline,
    approximate_circle,
    approximate_ellipse,
)


ADAPTER_VERSION = "ezdxf-1.4.4/cadkernel-dxf-v1.2.0"
SUPPORTED_GEOMETRY_TYPES = frozenset(
    {
        "LINE",
        "LWPOLYLINE",
        "POLYLINE",
        "ARC",
        "CIRCLE",
        "ELLIPSE",
        "SPLINE",
        "TEXT",
        "MTEXT",
        "ATTRIB",
        "POINT",
        "DIMENSION",
        "LEADER",
        "MULTILEADER",
        "MLEADER",
        "HATCH",
        "SOLID",
    }
)
ANNOTATION_TYPES = frozenset(
    {"DIMENSION", "LEADER", "MULTILEADER", "MLEADER", "HATCH", "SOLID"}
)
TOPOLOGY_TYPES = frozenset(
    {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE"}
)
STRUCTURALLY_SUPPORTED_TYPES = SUPPORTED_GEOMETRY_TYPES | {"INSERT"}


@dataclass(frozen=True, slots=True)
class DxfSourceStatistics:
    total_source_entities: int
    parsed_source_entities: int
    geometry_supported_source_entities: int
    occurrence_count: int
    indexed_occurrence_count: int
    topology_eligible_occurrence_count: int
    approximation_count: int
    source_counts_by_type: tuple[tuple[str, int], ...]
    source_counts_by_layer: tuple[tuple[str, int], ...]
    top_level_counts_by_type: tuple[tuple[str, int], ...]
    top_level_counts_by_layer: tuple[tuple[str, int], ...]
    modelspace_counts_by_type: tuple[tuple[str, int], ...]
    modelspace_counts_by_layer: tuple[tuple[str, int], ...]
    unsupported_by_type: tuple[tuple[str, int], ...]
    transform_failures: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DxfAdapterResult:
    snapshot: DrawingSnapshot
    statistics: DxfSourceStatistics
    effective_precision_model: PrecisionModel
    diagnostics: tuple[Diagnostic, ...] = ()


@dataclass(slots=True)
class _BuildState:
    file_id: str
    drawing_title: str
    tolerance: ToleranceProfile
    definition_rows: dict[str, tuple[str, str, str, str, str, str, str]]
    occurrence_rows: dict[str, tuple[str, str, str, str, str, tuple[np.ndarray, ...]]]
    geometry_records: list[GeometryRecord]
    text_rows: list[tuple[str, str, str, str, str, str, str, str, str, str, tuple[float, float, float]]]
    annotation_records: list[AnnotationRecord]
    dimension_scales: dict[str, float]
    diagnostics: list[Diagnostic]
    transform_failures: list[str]
    approximation_count: int = 0
    unbounded_spline_error_count: int = 0


def _source_handle(entity: DXFGraphic, fallback: str) -> str:
    handle = getattr(entity.dxf, "handle", None)
    return str(handle) if handle else fallback


def _matrix_array(insert: Insert) -> np.ndarray:
    return np.asarray(list(insert.matrix44()), dtype=np.float64).reshape((4, 4))


def _vec3(value: Any) -> tuple[float, float, float]:
    sequence = tuple(float(item) for item in value)
    if len(sequence) == 2:
        return (sequence[0], sequence[1], 0.0)
    return (sequence[0], sequence[1], sequence[2])


def _ocs_point(entity: DXFGraphic, value: Any) -> tuple[float, float, float]:
    return _vec3(entity.ocs().to_wcs(value))


def _entity_anchor_point(entity: DXFGraphic) -> tuple[float, float, float]:
    """Return the entity's stored anchor in WCS.

    DXF does not use one coordinate convention for every entity carrying an
    extrusion vector.  TEXT and ATTRIB store group 10 in OCS, while MTEXT and
    POINT store their insertion/location points in WCS.  Keeping that dispatch
    explicit prevents a non-default normal from rotating an already-world-space
    point a second time.
    """

    kind = entity.dxftype()
    if kind == "POINT":
        return _vec3(entity.dxf.location)
    value = getattr(entity.dxf, "insert", (0.0, 0.0, 0.0))
    if kind == "MTEXT":
        return _vec3(value)
    return _ocs_point(entity, value)


def _plain_text(entity: DXFGraphic) -> tuple[str, str, str]:
    raw = str(getattr(entity.dxf, "text", ""))
    if entity.dxftype() == "MTEXT":
        raw = str(getattr(entity, "text", raw))
        try:
            plain = str(entity.plain_text())
        except (AttributeError, ValueError):
            plain = raw
    else:
        plain = raw
    plain = " ".join(plain.replace("\x00", "").split())
    normalized = unicodedata.normalize("NFKC", plain).casefold()
    return raw, normalized, plain


def _path_json(path: tuple[str, ...]) -> str:
    return json.dumps(path, ensure_ascii=False, separators=(",", ":"))


def _unit_status(doc: Any) -> str:
    units = int(doc.header.get("$INSUNITS", 0) or 0)
    names = {
        0: "unitless",
        1: "inch",
        2: "foot",
        4: "millimetre",
        5: "centimetre",
        6: "metre",
        10: "yard",
        14: "decimetre",
    }
    return names.get(units, f"insunits:{units}")


def _nice_grid_size(required: float) -> float:
    exponent = math.floor(math.log10(required))
    scale = 10.0**exponent
    mantissa = required / scale
    for candidate in (1.0, 2.0, 5.0, 10.0):
        if mantissa <= candidate:
            return candidate * scale
    return 10.0 * scale


def _frame_with_explicit_downgrade(
    bounds: tuple[float, float, float, float],
    precision: PrecisionModel,
) -> tuple[CoordinateFrame, PrecisionModel, Diagnostic | None]:
    try:
        return CoordinateFrame.from_bounds(bounds, precision), precision, None
    except CoordinateOverflowError as error:
        span = max(bounds[2] - bounds[0], bounds[3] - bounds[1])
        # Keep this conservative adapter-side estimate aligned with
        # CoordinateFrame's checked ``8*m^2`` orient2d bound.  The frame still
        # performs the authoritative validation after the nice-grid rounding.
        safe_delta = math.sqrt(
            np.iinfo(np.int64).max * precision.overflow_safety_factor / 8.0
        )
        required_grid = span / safe_delta * (1.0 + 1e-12)
        effective_grid = _nice_grid_size(max(required_grid, precision.grid_size))
        grid_changed = effective_grid > precision.grid_size
        effective = PrecisionModel(
            grid_size=effective_grid,
            max_region_span=max(span * 1.01, precision.max_region_span),
            overflow_safety_factor=precision.overflow_safety_factor,
            integer_dtype=precision.integer_dtype,
            rounding=precision.rounding,
            model_name=(
                f"{precision.model_name}-downgraded-{effective_grid:g}"
                if grid_changed
                else f"{precision.model_name}-expanded-region-{span:g}"
            ),
        )
        frame = CoordinateFrame.from_bounds(bounds, effective)
        diagnostic = Diagnostic(
            code=(
                "PRECISION_GRID_DOWNGRADED"
                if grid_changed
                else "PRECISION_REGION_EXPANDED"
            ),
            message=(
                (
                    f"Requested grid {precision.grid_size:g} could not safely cover the full drawing; "
                    f"effective grid is {effective_grid:g}."
                )
                if grid_changed
                else (
                    f"Drawing span {span:g} exceeded configured max_region_span "
                    f"{precision.max_region_span:g}; the explicit effective region was expanded "
                    "without changing grid size."
                )
            ),
            severity=DiagnosticSeverity.WARNING,
            details=(("reason", str(error)),),
        )
        return frame, effective, diagnostic


def _definition_identity(
    state: _BuildState,
    entity: DXFGraphic,
    *,
    layout_id: str,
    block_definition_path: tuple[str, ...],
    fallback_handle: str,
) -> str:
    handle = _source_handle(entity, fallback_handle)
    definition_id = stable_text_id(
        "definition-entity",
        state.file_id,
        layout_id,
        str(len(block_definition_path)),
        *block_definition_path,
        handle,
        length=32,
    )
    if definition_id not in state.definition_rows:
        state.definition_rows[definition_id] = (
            definition_id,
            state.file_id,
            layout_id,
            _path_json(block_definition_path),
            handle,
            entity.dxftype(),
            str(getattr(entity.dxf, "layer", "")),
        )
    return definition_id


def _add_occurrence(
    state: _BuildState,
    *,
    definition_id: str,
    layout_name: str,
    instance_path: tuple[str, ...],
    transform_chain: tuple[np.ndarray, ...],
) -> str:
    occurrence_id = stable_text_id(
        "entity-occurrence",
        definition_id,
        str(len(instance_path)),
        *instance_path,
        length=32,
    )
    if transform_chain:
        classification = classify_transform(transform_chain[-1]).kind.value
    else:
        classification = TransformClass.RIGID.value
    state.occurrence_rows[occurrence_id] = (
        occurrence_id,
        definition_id,
        layout_name,
        _path_json(instance_path),
        classification,
        transform_chain,
    )
    return occurrence_id


def _topology_eligible(coordinates: np.ndarray, tolerance: ToleranceProfile) -> bool:
    return bool(np.ptp(coordinates[:, 2]) <= tolerance.coplanarity)


def _enforce_max_segment_length(
    coordinates: np.ndarray,
    maximum: float,
) -> np.ndarray:
    """Subdivide a flattened curve without changing its geometric trace."""

    if len(coordinates) < 2:
        return coordinates
    pieces: list[np.ndarray] = []
    for index, (start, end) in enumerate(zip(coordinates[:-1], coordinates[1:])):
        segment_count = max(
            1, int(math.ceil(float(np.linalg.norm(end - start)) / maximum))
        )
        piece = np.linspace(start, end, segment_count + 1, dtype=np.float64)
        pieces.append(piece if index == 0 else piece[1:])
    return np.concatenate(pieces, axis=0)


def _curve_record(
    state: _BuildState,
    entity: DXFGraphic,
    *,
    occurrence_id: str,
    definition_id: str,
) -> GeometryRecord | None:
    kind = entity.dxftype()
    layer = str(getattr(entity.dxf, "layer", ""))
    del layer  # Layer lives in the definition table, not geometry hot columns.
    if kind == "LINE":
        start = _vec3(entity.dxf.start)
        end = _vec3(entity.dxf.end)
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.LINE,
            (start, end),
            kind,
            topology_eligible=abs(start[2] - end[2]) <= state.tolerance.coplanarity,
        )
    if kind == "LWPOLYLINE":
        points = list(entity.get_points("xyseb"))
        elevation = float(getattr(entity.dxf, "elevation", 0.0) or 0.0)
        ocs_coordinates = np.asarray(
            [(point[0], point[1], elevation) for point in points], dtype=np.float64
        )
        coordinates = np.asarray(
            [_ocs_point(entity, point) for point in ocs_coordinates], dtype=np.float64
        )
        bulges = np.asarray([float(point[4]) for point in points], dtype=np.float64)
        closed = bool(entity.closed)
        if np.any(np.abs(bulges) > 1e-15):
            source = SourceCurve(
                occurrence_id,
                definition_id,
                kind,
                tuple(map(tuple, coordinates)),
                parameters=(("closed", closed),),
            )
            view = approximate_bulged_polyline(
                source,
                points=ocs_coordinates,
                bulges=bulges,
                closed=closed,
                chord_error=state.tolerance.curve_chord_error,
                max_segment_length=state.tolerance.max_curve_segment_length,
            )
            coordinates = np.asarray(
                [_ocs_point(entity, point) for point in view.coordinates], dtype=np.float64
            )
            approximation_error = view.measured_chord_error
            state.approximation_count += 1
        else:
            approximation_error = 0.0
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.POLYLINE,
            tuple(map(tuple, coordinates)),
            kind,
            closed=closed,
            bulges=tuple(float(item) for item in bulges),
            topology_eligible=_topology_eligible(coordinates, state.tolerance),
            approximation_error=approximation_error,
        )
    if kind == "POLYLINE":
        if bool(getattr(entity, "is_poly_face_mesh", False)) or bool(
            getattr(entity, "is_polygon_mesh", False)
        ):
            raise ValueError(
                f"POLYLINE mode {entity.get_mode()} requires face/mesh decomposition"
            )
        vertices = list(entity.vertices)
        if not vertices:
            raise ValueError("POLYLINE has no vertices")
        coordinates = np.asarray(
            [_vec3(point) for point in entity.points_in_wcs()], dtype=np.float64
        )
        bulges = np.asarray(
            [float(vertex.dxf.get("bulge", 0.0) or 0.0) for vertex in vertices],
            dtype=np.float64,
        )
        closed = bool(entity.is_closed)
        approximation_error = 0.0
        if bool(getattr(entity, "is_2d_polyline", False)) and np.any(
            np.abs(bulges) > 1e-15
        ):
            elevation = float(entity.dxf.elevation.z)
            ocs_coordinates = np.asarray(
                [
                    (
                        float(vertex.dxf.location.x),
                        float(vertex.dxf.location.y),
                        elevation,
                    )
                    for vertex in vertices
                ],
                dtype=np.float64,
            )
            source = SourceCurve(
                occurrence_id,
                definition_id,
                kind,
                tuple(map(tuple, coordinates)),
                parameters=(("closed", closed),),
            )
            view = approximate_bulged_polyline(
                source,
                points=ocs_coordinates,
                bulges=bulges,
                closed=closed,
                chord_error=state.tolerance.curve_chord_error,
                max_segment_length=state.tolerance.max_curve_segment_length,
            )
            coordinates = np.asarray(
                [_vec3(point) for point in entity.ocs().points_to_wcs(view.coordinates)],
                dtype=np.float64,
            )
            approximation_error = view.measured_chord_error
            state.approximation_count += 1
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.POLYLINE,
            tuple(map(tuple, coordinates)),
            kind,
            closed=closed,
            bulges=tuple(float(item) for item in bulges),
            topology_eligible=_topology_eligible(coordinates, state.tolerance),
            approximation_error=approximation_error,
        )
    if kind in {"ARC", "CIRCLE", "ELLIPSE"}:
        center = _vec3(entity.dxf.center)
        if kind in {"ARC", "CIRCLE"}:
            center_ocs = center
            center = _ocs_point(entity, center_ocs)
        source = SourceCurve(occurrence_id, definition_id, kind, (center,))
        if kind == "ARC":
            view = approximate_arc(
                source,
                center=center_ocs,
                radius=float(entity.dxf.radius),
                start_angle=math.radians(float(entity.dxf.start_angle)),
                end_angle=math.radians(float(entity.dxf.end_angle)),
                chord_error=state.tolerance.curve_chord_error,
                max_segment_length=state.tolerance.max_curve_segment_length,
            )
            geometry_kind = GeometryKind.ARC
            closed = False
            coordinates = np.asarray(
                [_ocs_point(entity, point) for point in view.coordinates], dtype=np.float64
            )
            parameters = (
                center[0], center[1], center[2], float(entity.dxf.radius),
                math.radians(float(entity.dxf.start_angle)), math.radians(float(entity.dxf.end_angle)),
            )
        elif kind == "CIRCLE":
            view = approximate_circle(
                source,
                center=center_ocs,
                radius=float(entity.dxf.radius),
                chord_error=state.tolerance.curve_chord_error,
                max_segment_length=state.tolerance.max_curve_segment_length,
            )
            geometry_kind = GeometryKind.CIRCLE
            closed = True
            coordinates = np.asarray(
                [_ocs_point(entity, point) for point in view.coordinates], dtype=np.float64
            )
            parameters = (center[0], center[1], center[2], float(entity.dxf.radius))
        else:
            major_axis = _vec3(entity.dxf.major_axis)
            view = approximate_ellipse(
                source,
                center=center,
                major_axis=major_axis,
                normal=_vec3(entity.dxf.extrusion),
                ratio=float(entity.dxf.ratio),
                start_parameter=float(entity.dxf.start_param),
                end_parameter=float(entity.dxf.end_param),
                chord_error=state.tolerance.curve_chord_error,
                max_segment_length=state.tolerance.max_curve_segment_length,
            )
            geometry_kind = GeometryKind.ELLIPSE
            coordinates = view.coordinates
            sweep = (float(entity.dxf.end_param) - float(entity.dxf.start_param)) % (2 * math.pi)
            closed = math.isclose(sweep, 0.0, abs_tol=1e-12)
            parameters = (
                center[0], center[1], center[2], major_axis[0], major_axis[1], major_axis[2],
                float(entity.dxf.ratio), float(entity.dxf.start_param), float(entity.dxf.end_param),
            )
        state.approximation_count += 1
        return GeometryRecord(
            occurrence_id,
            definition_id,
            geometry_kind,
            tuple(map(tuple, coordinates)),
            kind,
            closed=closed,
            parameters=parameters,
            topology_eligible=_topology_eligible(coordinates, state.tolerance),
            approximation_error=view.measured_chord_error,
        )
    if kind == "SPLINE":
        control_points = tuple(_vec3(point) for point in entity.control_points)
        fit_points = tuple(_vec3(point) for point in entity.fit_points)
        source_points = control_points or fit_points
        source = SourceCurve(
            occurrence_id,
            definition_id,
            kind,
            source_points,
            parameters=(("degree", int(entity.dxf.degree)),),
            knots=tuple(float(item) for item in entity.knots),
            weights=tuple(float(item) for item in entity.weights),
        )
        flattened = np.asarray(
            [
                _vec3(point)
                for point in entity.flattening(
                    distance=state.tolerance.curve_chord_error,
                    segments=4,
                )
            ],
            dtype=np.float64,
        )
        flattened = _enforce_max_segment_length(
            flattened, state.tolerance.max_curve_segment_length
        )
        # ezdxf's adaptive flattening enforces a midpoint-deviation policy but
        # does not expose a mathematically verified global error bound.  Do not
        # mislabel the requested tolerance as a measured error.  ``inf`` is the
        # explicit contract value for an approximation whose bound is unknown.
        view = ApproximationView(
            source,
            flattened,
            state.tolerance.curve_chord_error,
            math.inf,
            state.tolerance.max_curve_segment_length,
            approximation_version="ezdxf-flatten-1.4.4-v1",
        )
        state.approximation_count += 1
        state.unbounded_spline_error_count += 1
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.SPLINE,
            tuple(map(tuple, view.coordinates)),
            kind,
            closed=bool(getattr(entity, "closed", False)),
            topology_eligible=_topology_eligible(view.coordinates, state.tolerance),
            approximation_error=view.measured_chord_error,
        )
    if kind in {"TEXT", "MTEXT", "ATTRIB"}:
        position = _entity_anchor_point(entity)
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.TEXT,
            (position,),
            kind,
            topology_eligible=False,
        )
    if kind == "POINT":
        position = _entity_anchor_point(entity)
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.POINT,
            (position,),
            kind,
            topology_eligible=False,
        )
    if kind == "SOLID":
        coordinates = np.asarray(
            [_vec3(point) for point in entity.wcs_vertices(close=False)],
            dtype=np.float64,
        )
        if len(coordinates) < 3:
            raise ValueError("SOLID requires at least three distinct vertices")
        return GeometryRecord(
            occurrence_id,
            definition_id,
            GeometryKind.SOLID,
            tuple(map(tuple, coordinates)),
            kind,
            closed=True,
            topology_eligible=False,
        )
    return None


def _add_text(
    state: _BuildState,
    entity: DXFGraphic,
    *,
    occurrence_id: str,
    layout_name: str,
    block_name: str,
    attribute_tag: str = "",
    attribute_value: str = "",
) -> None:
    raw, normalized, plain = _plain_text(entity)
    point = _entity_anchor_point(entity)
    state.text_rows.append(
        (
            occurrence_id,
            raw,
            normalized,
            plain,
            attribute_tag,
            attribute_value,
            str(getattr(entity.dxf, "layer", "")),
            block_name,
            layout_name,
            state.drawing_title,
            point,
        )
    )


def _dimension_kind(entity: DXFGraphic) -> str:
    base_type = int(entity.dxf.get("dimtype", 0) or 0) & 0x0F
    return {
        0: "linear",
        1: "aligned",
        2: "angular",
        3: "diametric",
        4: "radial",
        5: "angular",
        6: "ordinate",
    }.get(base_type, "dimension")


def _dimension_points(entity: DXFGraphic) -> tuple[tuple[float, float, float], ...]:
    names = ("defpoint", "defpoint2", "defpoint3", "defpoint4", "defpoint5")
    return tuple(_vec3(entity.dxf.get(name)) for name in names if entity.dxf.hasattr(name))


def _text_geometry_bounds(entities: list[DXFGraphic]) -> tuple[float, float, float, float] | None:
    text_entities = [entity for entity in entities if entity.dxftype() in {"TEXT", "MTEXT", "ATTRIB"}]
    if not text_entities:
        return None
    try:
        box = ezdxf_bbox.extents(text_entities, fast=True)
    except (AttributeError, TypeError, ValueError, ZeroDivisionError, OverflowError):
        return None
    if not box.has_data:
        return None
    return (
        float(box.extmin.x),
        float(box.extmin.y),
        float(box.extmax.x),
        float(box.extmax.y),
    )


def _combined_bounds(
    records: list[GeometryRecord],
    *,
    points: tuple[tuple[float, float, float], ...] = (),
    extra_bounds: tuple[float, float, float, float] | None = None,
) -> tuple[float, float, float, float] | None:
    xy: list[tuple[float, float]] = [
        (float(point[0]), float(point[1]))
        for record in records
        for point in record.coordinates
    ]
    xy.extend((float(point[0]), float(point[1])) for point in points)
    if extra_bounds is not None:
        xy.extend(
            (
                (float(extra_bounds[0]), float(extra_bounds[1])),
                (float(extra_bounds[2]), float(extra_bounds[3])),
            )
        )
    if not xy:
        return None
    values = np.asarray(xy, dtype=np.float64)
    return (
        float(values[:, 0].min()),
        float(values[:, 1].min()),
        float(values[:, 0].max()),
        float(values[:, 1].max()),
    )


def _dimension_scales(doc: Any) -> dict[str, float]:
    result: dict[str, float] = {}
    for style in doc.dimstyles:
        try:
            raw_scale = style.dxf.get("dimlfac", 1.0)
            scale = float(1.0 if raw_scale is None else raw_scale)
            if math.isfinite(scale):
                result[str(style.dxf.name)] = scale
        except (AttributeError, TypeError, ValueError):
            continue
    return result


class DxfAdapter:
    def __init__(self, *, max_block_depth: int = 32) -> None:
        if max_block_depth < 1:
            raise ValueError("max_block_depth must be positive")
        self.max_block_depth = max_block_depth

    @staticmethod
    def _derived_occurrence(
        state: _BuildState,
        *,
        definition_id: str,
        layout_name: str,
        instance_path: tuple[str, ...],
        transform_chain: tuple[np.ndarray, ...],
        ordinal: int,
        source_type: str,
    ) -> str:
        return _add_occurrence(
            state,
            definition_id=definition_id,
            layout_name=layout_name,
            instance_path=instance_path
            + (f"annotation-derived:{ordinal}:{source_type.casefold()}",),
            transform_chain=transform_chain,
        )

    def _append_annotation_virtuals(
        self,
        state: _BuildState,
        virtuals: list[DXFGraphic],
        *,
        definition_id: str,
        layout_name: str,
        instance_path: tuple[str, ...],
        transform_chain: tuple[np.ndarray, ...],
        block_name: str,
        source_handle: str,
    ) -> list[GeometryRecord]:
        records: list[GeometryRecord] = []
        for ordinal, virtual in enumerate(virtuals):
            occurrence_id = self._derived_occurrence(
                state,
                definition_id=definition_id,
                layout_name=layout_name,
                instance_path=instance_path,
                transform_chain=transform_chain,
                ordinal=ordinal,
                source_type=virtual.dxftype(),
            )
            try:
                record = _curve_record(
                    state,
                    virtual,
                    occurrence_id=occurrence_id,
                    definition_id=definition_id,
                )
                if record is None:
                    state.diagnostics.append(
                        Diagnostic(
                            code="ANNOTATION_VIRTUAL_GEOMETRY_UNSUPPORTED",
                            message=(
                                f"{source_handle} emitted unsupported virtual "
                                f"{virtual.dxftype()} geometry."
                            ),
                            details=(("occurrence_id", occurrence_id),),
                        )
                    )
                    continue
                record = replace(
                    record,
                    topology_eligible=False,
                    annotation_derived=True,
                )
                state.geometry_records.append(record)
                records.append(record)
                if virtual.dxftype() in {"TEXT", "MTEXT", "ATTRIB"}:
                    _add_text(
                        state,
                        virtual,
                        occurrence_id=occurrence_id,
                        layout_name=layout_name,
                        block_name=block_name,
                    )
            except (ValueError, TypeError, AttributeError, ZeroDivisionError, OverflowError) as error:
                state.diagnostics.append(
                    Diagnostic(
                        code="ANNOTATION_VIRTUAL_GEOMETRY_FAILED",
                        message=(
                            f"{source_handle} virtual {virtual.dxftype()} could not be "
                            f"normalized: {error}"
                        ),
                        details=(("occurrence_id", occurrence_id),),
                    )
                )
        return records

    def _append_hatch_boundaries(
        self,
        state: _BuildState,
        entity: DXFGraphic,
        *,
        definition_id: str,
        layout_name: str,
        instance_path: tuple[str, ...],
        transform_chain: tuple[np.ndarray, ...],
        source_handle: str,
    ) -> list[GeometryRecord]:
        records: list[GeometryRecord] = []
        try:
            paths = list(from_hatch(entity))
        except (ValueError, TypeError, AttributeError, ZeroDivisionError, OverflowError) as error:
            state.diagnostics.append(
                Diagnostic(
                    code="HATCH_BOUNDARY_UNAVAILABLE",
                    message=f"HATCH {source_handle} boundaries could not be read: {error}",
                )
            )
            return records
        for ordinal, path in enumerate(paths):
            try:
                coordinates = np.asarray(
                    [_vec3(point) for point in path.flattening(
                        distance=state.tolerance.curve_chord_error,
                        segments=4,
                    )],
                    dtype=np.float64,
                )
                if len(coordinates) < 2:
                    raise ValueError("boundary path has fewer than two points")
                coordinates = _enforce_max_segment_length(
                    coordinates,
                    state.tolerance.max_curve_segment_length,
                )
                occurrence_id = self._derived_occurrence(
                    state,
                    definition_id=definition_id,
                    layout_name=layout_name,
                    instance_path=instance_path,
                    transform_chain=transform_chain,
                    ordinal=ordinal,
                    source_type="HATCH_BOUNDARY",
                )
                approximation_error = math.inf if path.has_curves else 0.0
                if path.has_curves:
                    state.approximation_count += 1
                record = GeometryRecord(
                    occurrence_id=occurrence_id,
                    definition_id=definition_id,
                    kind=GeometryKind.HATCH_BOUNDARY,
                    coordinates=tuple(map(tuple, coordinates)),
                    source_type="HATCH",
                    closed=bool(path.is_closed),
                    topology_eligible=False,
                    approximation_error=approximation_error,
                    annotation_derived=True,
                )
                state.geometry_records.append(record)
                records.append(record)
            except (ValueError, TypeError, AttributeError, ZeroDivisionError, OverflowError) as error:
                state.diagnostics.append(
                    Diagnostic(
                        code="HATCH_BOUNDARY_FAILED",
                        message=(
                            f"HATCH {source_handle} boundary {ordinal} could not be "
                            f"normalized: {error}"
                        ),
                    )
                )
        return records

    def _visit_annotation(
        self,
        state: _BuildState,
        entity: DXFGraphic,
        *,
        source_entity: DXFGraphic,
        definition_id: str,
        occurrence_id: str,
        layout_name: str,
        instance_path: tuple[str, ...],
        transform_chain: tuple[np.ndarray, ...],
        block_name: str,
        fallback_handle: str,
    ) -> None:
        kind = entity.dxftype()
        source_handle = _source_handle(source_entity, fallback_handle)
        virtuals: list[DXFGraphic] = []
        records: list[GeometryRecord] = []
        diagnostic_codes: list[str] = []

        if kind == "SOLID":
            record = _curve_record(
                state,
                entity,
                occurrence_id=occurrence_id,
                definition_id=definition_id,
            )
            if record is not None:
                record = replace(
                    record,
                    topology_eligible=False,
                    annotation_derived=True,
                )
                state.geometry_records.append(record)
                records.append(record)
        elif kind == "HATCH":
            records.extend(
                self._append_hatch_boundaries(
                    state,
                    entity,
                    definition_id=definition_id,
                    layout_name=layout_name,
                    instance_path=instance_path,
                    transform_chain=transform_chain,
                    source_handle=source_handle,
                )
            )
            if not records:
                diagnostic_codes.append("HATCH_BOUNDARY_UNAVAILABLE")
        else:
            try:
                virtuals = list(entity.virtual_entities())
            except (ValueError, TypeError, AttributeError, ZeroDivisionError, OverflowError) as error:
                code = f"{kind}_VIRTUAL_GEOMETRY_UNAVAILABLE"
                diagnostic_codes.append(code)
                state.diagnostics.append(
                    Diagnostic(
                        code=code,
                        message=f"{kind} {source_handle} could not expose virtual geometry: {error}",
                    )
                )
            records.extend(
                self._append_annotation_virtuals(
                    state,
                    virtuals,
                    definition_id=definition_id,
                    layout_name=layout_name,
                    instance_path=instance_path,
                    transform_chain=transform_chain,
                    block_name=block_name,
                    source_handle=source_handle,
                )
            )

        annotation_kind = kind.casefold()
        measured_value: float | None = None
        text_override: str | None = None
        measurement_scale: float | None = None
        definition_points: tuple[tuple[float, float, float], ...] = ()
        anchor_point: tuple[float, float, float] | None = None
        target_refs: list[AnnotationTargetRef] = []
        boundary_refs: tuple[str, ...] = ()
        pattern_name: str | None = None
        is_solid_fill: bool | None = None

        if kind == "DIMENSION":
            annotation_kind = _dimension_kind(entity)
            definition_points = _dimension_points(entity)
            if entity.dxf.hasattr("text_midpoint"):
                anchor_point = _ocs_point(entity, entity.dxf.text_midpoint)
            elif definition_points:
                anchor_point = definition_points[0]
            try:
                value = float(entity.get_measurement())
                if not math.isfinite(value):
                    raise ValueError("measurement is not finite")
                measured_value = value
            except (ValueError, TypeError, AttributeError, ZeroDivisionError, OverflowError) as error:
                diagnostic_codes.append("DIMENSION_MEASUREMENT_UNAVAILABLE")
                state.diagnostics.append(
                    Diagnostic(
                        code="DIMENSION_MEASUREMENT_UNAVAILABLE",
                        message=f"DIMENSION {source_handle} has no reliable measurement: {error}",
                        details=(("occurrence_id", occurrence_id),),
                    )
                )
            if source_entity.dxf.hasattr("text"):
                authored_text = str(source_entity.dxf.text)
                if authored_text != "<>":
                    text_override = authored_text
            dimstyle = str(source_entity.dxf.get("dimstyle", ""))
            measurement_scale = state.dimension_scales.get(dimstyle)
            if measurement_scale is None:
                diagnostic_codes.append("DIMENSION_MEASUREMENT_SCALE_UNAVAILABLE")
        elif kind == "LEADER":
            definition_points = tuple(_vec3(point) for point in entity.vertices)
            if definition_points:
                target_refs.append(
                    AnnotationTargetRef(
                        ref_kind="authored_arrow_point",
                        point=definition_points[0],
                    )
                )
                anchor_point = definition_points[-1]
            annotation_handle = source_entity.dxf.get("annotation_handle", None)
            if annotation_handle:
                target_refs.append(
                    AnnotationTargetRef(
                        ref_kind="authored_annotation_handle",
                        source_handle=str(annotation_handle),
                    )
                )
        elif kind in {"MULTILEADER", "MLEADER"}:
            annotation_kind = "multileader"
            context = getattr(entity, "context", None)
            collected: list[tuple[float, float, float]] = []
            if context is None:
                diagnostic_codes.append("MULTILEADER_CONTEXT_UNAVAILABLE")
            else:
                for leader in getattr(context, "leaders", ()):
                    for line in getattr(leader, "lines", ()):
                        vertices = tuple(_vec3(point) for point in getattr(line, "vertices", ()))
                        collected.extend(vertices)
                        if vertices:
                            target_refs.append(
                                AnnotationTargetRef(
                                    ref_kind="authored_arrow_point",
                                    point=vertices[0],
                                )
                            )
                content = getattr(context, "mtext", None) or getattr(context, "block", None)
                insert = getattr(content, "insert", None)
                if insert is not None:
                    anchor_point = _vec3(insert)
                elif hasattr(context, "base_point"):
                    anchor_point = _vec3(context.base_point)
            definition_points = tuple(collected)
            if not target_refs:
                diagnostic_codes.append("MULTILEADER_TARGETS_UNAVAILABLE")
        elif kind == "HATCH":
            annotation_kind = "hatch"
            handles = sorted(
                {
                    str(handle)
                    for path in getattr(source_entity, "paths", ())
                    for handle in getattr(path, "source_boundary_objects", ())
                    if handle
                }
            )
            boundary_refs = tuple(handles)
            target_refs.extend(
                AnnotationTargetRef(
                    ref_kind="authored_boundary_handle",
                    source_handle=handle,
                )
                for handle in handles
            )
            pattern_name = str(entity.dxf.get("pattern_name", ""))
            is_solid_fill = bool(entity.dxf.get("solid_fill", 0))
        elif kind == "SOLID":
            annotation_kind = "solid"
            if records:
                definition_points = records[0].coordinates
                values = np.asarray(definition_points, dtype=np.float64)
                anchor_point = tuple(float(item) for item in values.mean(axis=0))
            is_solid_fill = True

        text_bounds = _text_geometry_bounds(virtuals)
        all_points = definition_points + (() if anchor_point is None else (anchor_point,))
        bounds = _combined_bounds(records, points=all_points, extra_bounds=text_bounds)
        if anchor_point is None and bounds is not None:
            anchor_point = (
                (bounds[0] + bounds[2]) / 2.0,
                (bounds[1] + bounds[3]) / 2.0,
                0.0,
            )
        state.annotation_records.append(
            AnnotationRecord(
                occurrence_id=occurrence_id,
                definition_id=definition_id,
                annotation_kind=annotation_kind,
                source_type=source_entity.dxftype(),
                measured_value=measured_value,
                text_override=text_override,
                measurement_scale=measurement_scale,
                definition_points=definition_points,
                anchor_point=anchor_point,
                text_bounds=text_bounds,
                target_refs=tuple(target_refs),
                boundary_refs=boundary_refs,
                pattern_name=pattern_name,
                is_solid_fill=is_solid_fill,
                bounds=bounds,
                diagnostic_codes=tuple(sorted(set(diagnostic_codes))),
            )
        )

    def build(
        self,
        source: str | Path,
        *,
        tolerance: ToleranceProfile | None = None,
        precision: PrecisionModel | None = None,
        conversion_provenance: ConversionProvenance | None = None,
        logical_source_path: str | Path | None = None,
    ) -> DxfAdapterResult:
        source_path = Path(source)
        if source_path.suffix.casefold() != ".dxf":
            raise ValueError("DxfAdapter accepts only .dxf; convert DWG explicitly first")
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        tolerance = tolerance or ToleranceProfile()
        precision = precision or PrecisionModel()
        dxf_sha = sha256_file(str(source_path))
        if conversion_provenance is not None:
            if conversion_provenance.output_sha256 != dxf_sha:
                raise ValueError(
                    "Conversion provenance output_sha256 does not match the DXF input"
                )
            if logical_source_path is None:
                raise ValueError(
                    "Conversion provenance requires the logical DWG source path"
                )
            logical_path = Path(logical_source_path)
            if not logical_path.is_file():
                raise FileNotFoundError(logical_path)
            logical_sha = sha256_file(str(logical_path))
            if logical_sha != conversion_provenance.source_sha256:
                raise ValueError(
                    "Conversion provenance source_sha256 does not match the logical DWG source"
                )
        source_sha = (
            conversion_provenance.source_sha256 if conversion_provenance is not None else dxf_sha
        )
        effective_adapter_version = ADAPTER_VERSION
        if conversion_provenance is not None:
            conversion_fingerprint = stable_id(
                "dxf-conversion",
                conversion_provenance,
                length=32,
            )
            effective_adapter_version = f"{ADAPTER_VERSION}/conversion:{conversion_fingerprint}"
        snapshot_source_path = Path(logical_source_path) if logical_source_path is not None else source_path
        doc = ezdxf.readfile(source_path)
        state = _BuildState(
            file_id=stable_text_id("source-file", source_sha, length=32),
            drawing_title=snapshot_source_path.stem,
            tolerance=tolerance,
            definition_rows={},
            occurrence_rows={},
            geometry_records=[],
            text_rows=[],
            annotation_records=[],
            dimension_scales=_dimension_scales(doc),
            diagnostics=[],
            transform_failures=[],
        )
        source_type_counts: Counter[str] = Counter()
        source_layer_counts: Counter[str] = Counter()
        top_type_counts: Counter[str] = Counter()
        top_layer_counts: Counter[str] = Counter()
        model_type_counts: Counter[str] = Counter()
        model_layer_counts: Counter[str] = Counter()

        # Register every authored definition, including unreachable blocks. Layout-
        # backing blocks are skipped because their entities are registered as layouts.
        for block in doc.blocks:
            if block.name.casefold().startswith(("*model_space", "*paper_space")):
                continue
            for index, entity in enumerate(block):
                self._register_source(
                    state,
                    entity,
                    layout_id="BLOCKS",
                    block_path=(block.name,),
                    fallback=f"BLOCK:{block.name}:{index}:{entity.dxftype()}",
                    type_counts=source_type_counts,
                    layer_counts=source_layer_counts,
                )

        for layout in doc.layouts:
            for index, entity in enumerate(layout):
                fallback = f"LAYOUT:{layout.name}:{index}:{entity.dxftype()}"
                definition_id = self._register_source(
                    state,
                    entity,
                    layout_id=layout.name,
                    block_path=(),
                    fallback=fallback,
                    type_counts=source_type_counts,
                    layer_counts=source_layer_counts,
                )
                top_type_counts[entity.dxftype()] += 1
                top_layer_counts[str(getattr(entity.dxf, "layer", ""))] += 1
                if layout.name.casefold() == "model":
                    model_type_counts[entity.dxftype()] += 1
                    model_layer_counts[str(getattr(entity.dxf, "layer", ""))] += 1
                path = (f"layout:{layout.name}", f"entity:{_source_handle(entity, fallback)}")
                if entity.dxftype() == "INSERT":
                    self._expand_insert(
                        state,
                        entity,
                        source_entity=entity,
                        layout_name=layout.name,
                        instance_path=path,
                        transform_chain=(),
                        active_blocks=(),
                        depth=0,
                        source_definition_id=definition_id,
                    )
                else:
                    occurrence_id = _add_occurrence(
                        state,
                        definition_id=definition_id,
                        layout_name=layout.name,
                        instance_path=path,
                        transform_chain=(),
                    )
                    self._visit_geometry_entity(
                        state,
                        entity,
                        source_entity=entity,
                        layout_name=layout.name,
                        instance_path=path,
                        transform_chain=(),
                        block_name="",
                        fallback_handle=fallback,
                        precreated=(definition_id, occurrence_id),
                    )

        bounds = self._bounds(state.geometry_records)
        frame, effective_precision, downgrade = _frame_with_explicit_downgrade(bounds, precision)
        if downgrade is not None:
            state.diagnostics.append(downgrade)
        geometry = GeometryStore.from_records(state.geometry_records, quantize=frame.quantize)
        if state.unbounded_spline_error_count:
            state.diagnostics.append(
                Diagnostic(
                    code="SPLINE_APPROXIMATION_ERROR_UNBOUNDED",
                    message=(
                        f"{state.unbounded_spline_error_count} spline occurrence(s) were flattened "
                        "without a verified global chord-error bound."
                    ),
                    severity=DiagnosticSeverity.WARNING,
                )
            )
        definitions = self._definition_table(state)
        occurrences = self._occurrence_table(state)
        texts = self._text_store(state)
        annotations = self._annotation_store(state)
        covered_dimension_definitions = set(
            str(value)
            for value in annotations.definition_ids[annotations.source_types == "DIMENSION"]
        )
        for definition_id, row in sorted(state.definition_rows.items()):
            if row[5] != "DIMENSION" or definition_id in covered_dimension_definitions:
                continue
            state.diagnostics.append(
                Diagnostic(
                    code="DIMENSION_DEFINITION_WITHOUT_OCCURRENCE",
                    message=(
                        f"DIMENSION definition {row[4]} has no materialized drawing occurrence; "
                        "its measurement was not guessed from definition-local coordinates."
                    ),
                    severity=DiagnosticSeverity.WARNING,
                    details=(
                        ("definition_id", definition_id),
                        ("source_handle", row[4]),
                    ),
                )
            )
        provenance = {
            "adapter": ADAPTER_VERSION,
            "ezdxf_version": ezdxf.__version__,
            "source_path": str(snapshot_source_path.resolve()),
            "source_sha256": source_sha,
            "dxf_sha256": dxf_sha,
            "conversion": conversion_provenance,
            "dxf_header_version": str(doc.dxfversion),
        }
        snapshot = DrawingSnapshot.create(
            source_path=str(snapshot_source_path.resolve()),
            source_file_sha256=source_sha,
            source_format="dwg->dxf" if conversion_provenance is not None else "dxf",
            adapter_version=effective_adapter_version,
            tolerance_profile_id=tolerance.profile_id,
            precision_model_id=effective_precision.model_id,
            tolerance_profile_json=tolerance.to_json(),
            precision_model_json=effective_precision.to_json(),
            coordinate_frame=frame,
            definitions=definitions,
            occurrences=occurrences,
            geometry=geometry,
            texts=texts,
            annotations=annotations,
            provenance_json=stable_json_dumps(provenance),
            unit_status=_unit_status(doc),
            diagnostics_json=stable_json_dumps(state.diagnostics),
        )
        unsupported = Counter(
            {
                entity_type: count
                for entity_type, count in source_type_counts.items()
                if entity_type not in STRUCTURALLY_SUPPORTED_TYPES
            }
        )
        geometry_supported = sum(
            count for entity_type, count in source_type_counts.items() if entity_type in SUPPORTED_GEOMETRY_TYPES
        )
        statistics = DxfSourceStatistics(
            total_source_entities=len(definitions),
            parsed_source_entities=len(definitions),
            geometry_supported_source_entities=geometry_supported,
            occurrence_count=len(occurrences),
            indexed_occurrence_count=len(geometry) + len(texts) + len(annotations),
            topology_eligible_occurrence_count=int(np.count_nonzero(geometry.topology_eligible)),
            approximation_count=state.approximation_count,
            source_counts_by_type=tuple(sorted(source_type_counts.items())),
            source_counts_by_layer=tuple(sorted(source_layer_counts.items())),
            top_level_counts_by_type=tuple(sorted(top_type_counts.items())),
            top_level_counts_by_layer=tuple(sorted(top_layer_counts.items())),
            modelspace_counts_by_type=tuple(sorted(model_type_counts.items())),
            modelspace_counts_by_layer=tuple(sorted(model_layer_counts.items())),
            unsupported_by_type=tuple(sorted(unsupported.items())),
            transform_failures=tuple(sorted(state.transform_failures)),
        )
        # No ezdxf entity is retained beyond this point.
        del doc
        return DxfAdapterResult(snapshot, statistics, effective_precision, tuple(state.diagnostics))

    @staticmethod
    def _register_source(
        state: _BuildState,
        entity: DXFGraphic,
        *,
        layout_id: str,
        block_path: tuple[str, ...],
        fallback: str,
        type_counts: Counter[str],
        layer_counts: Counter[str],
    ) -> str:
        before = len(state.definition_rows)
        definition_id = _definition_identity(
            state,
            entity,
            layout_id=layout_id,
            block_definition_path=block_path,
            fallback_handle=fallback,
        )
        if len(state.definition_rows) > before:
            type_counts[entity.dxftype()] += 1
            layer_counts[str(getattr(entity.dxf, "layer", ""))] += 1
        return definition_id

    def _expand_insert(
        self,
        state: _BuildState,
        insert: Insert,
        *,
        source_entity: Insert,
        layout_name: str,
        instance_path: tuple[str, ...],
        transform_chain: tuple[np.ndarray, ...],
        active_blocks: tuple[str, ...],
        depth: int,
        source_definition_id: str | None = None,
    ) -> None:
        block_name = str(source_entity.dxf.name)
        source_handle = _source_handle(source_entity, f"INSERT:{block_name}:{depth}")
        if depth >= self.max_block_depth:
            state.diagnostics.append(
                Diagnostic(
                    code="BLOCK_DEPTH_LIMIT",
                    message=f"Stopped expanding block {block_name!r} at depth {depth}.",
                    details=(("source_handle", source_handle),),
                )
            )
            return
        if block_name in active_blocks:
            state.diagnostics.append(
                Diagnostic(
                    code="CYCLIC_BLOCK_REFERENCE",
                    message=f"Stopped cyclic block path at {block_name!r}.",
                    details=(("source_handle", source_handle),),
                )
            )
            return
        instances = list(insert.multi_insert()) if insert.mcount > 1 else [insert]
        for grid_index, instance in enumerate(instances):
            grid_path = instance_path + (f"insert:{source_handle}:{block_name}:grid:{grid_index}",)
            try:
                matrix = _matrix_array(instance)
                classification = classify_transform(matrix)
                if classification.kind is TransformClass.SINGULAR:
                    state.transform_failures.append(f"{source_handle}:singular")
            except (ValueError, TypeError, ZeroDivisionError) as error:
                state.transform_failures.append(f"{source_handle}:{type(error).__name__}")
                state.diagnostics.append(
                    Diagnostic(
                        code="TRANSFORM_CLASSIFICATION_FAILED",
                        message=f"Could not classify INSERT {source_handle}: {error}",
                    )
                )
                continue
            chain = transform_chain + (matrix,)
            definition_id = source_definition_id or _definition_identity(
                state,
                source_entity,
                layout_id="BLOCKS" if depth else layout_name,
                block_definition_path=active_blocks[-1:] if depth else (),
                fallback_handle=f"INSERT:{block_name}:{depth}",
            )
            occurrence_id = _add_occurrence(
                state,
                definition_id=definition_id,
                layout_name=layout_name,
                instance_path=grid_path,
                transform_chain=chain,
            )
            del occurrence_id
            for attribute_index, attribute in enumerate(instance.attribs):
                fallback = f"ATTRIB:{source_handle}:{attribute_index}:{getattr(attribute.dxf, 'tag', '')}"
                attribute_definition = _definition_identity(
                    state,
                    attribute,
                    layout_id="BLOCKS" if depth else layout_name,
                    block_definition_path=(block_name,),
                    fallback_handle=fallback,
                )
                attribute_path = grid_path + (f"attrib:{getattr(attribute.dxf, 'tag', attribute_index)}",)
                attribute_occurrence = _add_occurrence(
                    state,
                    definition_id=attribute_definition,
                    layout_name=layout_name,
                    instance_path=attribute_path,
                    transform_chain=chain,
                )
                self._visit_geometry_entity(
                    state,
                    attribute,
                    source_entity=attribute,
                    layout_name=layout_name,
                    instance_path=attribute_path,
                    transform_chain=chain,
                    block_name=block_name,
                    fallback_handle=fallback,
                    precreated=(attribute_definition, attribute_occurrence),
                    attribute_tag=str(getattr(attribute.dxf, "tag", "")),
                    attribute_value=str(getattr(attribute.dxf, "text", "")),
                )

            block_layout = instance.block()
            if block_layout is None:
                state.diagnostics.append(
                    Diagnostic(
                        code="MISSING_BLOCK_DEFINITION",
                        message=f"INSERT {source_handle} references missing block {block_name!r}.",
                    )
                )
                continue
            # ATTDEF rows are intentionally not emitted by ezdxf virtual block
            # expansion; attached ATTRIB occurrences were handled above.
            originals = [entity for entity in block_layout if entity.dxftype() != "ATTDEF"]
            skipped: list[str] = []

            def on_skipped(entity: DXFGraphic, reason: str) -> None:
                skipped.append(f"{_source_handle(entity, entity.dxftype())}:{reason}")

            virtuals = list(instance.virtual_entities(skipped_entity_callback=on_skipped))
            for item in skipped:
                state.transform_failures.append(item)
            original_by_handle = {
                _source_handle(original, f"BLOCK:{block_name}:{index}"): original
                for index, original in enumerate(originals)
            }
            positional_sources: list[DXFGraphic] | None = None
            if not skipped and len(virtuals) == len(originals):
                compatible = True
                for original, virtual in zip(originals, virtuals):
                    source = getattr(virtual, "source_of_copy", None)
                    if source is not None:
                        compatible = _source_handle(source, "") == _source_handle(original, "")
                        if not compatible:
                            break
                        continue
                    source_block = getattr(virtual, "source_block_reference", None)
                    compatible = source_block is instance and (
                        virtual.dxftype() == original.dxftype()
                        or (
                            virtual.dxftype() == "ELLIPSE"
                            and original.dxftype() in {"ARC", "CIRCLE"}
                        )
                    )
                    if not compatible:
                        break
                if compatible:
                    positional_sources = originals
            for child_index, virtual in enumerate(virtuals):
                copied_from = getattr(virtual, "source_of_copy", None)
                copied_handle = _source_handle(copied_from, "") if copied_from is not None else ""
                original = original_by_handle.get(copied_handle)
                if original is None and positional_sources is not None:
                    original = positional_sources[child_index]
                    state.diagnostics.append(
                        Diagnostic(
                            code="VIRTUAL_SOURCE_POSITIONALLY_VERIFIED",
                            message=(
                                f"Resolved transformed {virtual.dxftype()} to source "
                                f"{original.dxftype()} after verifying a complete one-to-one "
                                "emission with no skipped or recursively exploded entities."
                            ),
                            severity=DiagnosticSeverity.INFO,
                            details=(("source_handle", _source_handle(original, "")),),
                        )
                    )
                if original is None:
                    state.diagnostics.append(
                        Diagnostic(
                            code="VIRTUAL_SOURCE_UNRESOLVED",
                            message=(
                                f"Could not resolve source entity for virtual {virtual.dxftype()} "
                                f"in {block_name!r}; positional source guessing is forbidden."
                            ),
                        )
                    )
                    continue
                child_handle = _source_handle(original, f"BLOCK:{block_name}:{child_index}:{original.dxftype()}")
                child_path = grid_path + (f"child:{child_handle}",)
                if virtual.dxftype() == "INSERT" and original.dxftype() == "INSERT":
                    self._expand_insert(
                        state,
                        virtual,
                        source_entity=original,
                        layout_name=layout_name,
                        instance_path=child_path,
                        transform_chain=chain,
                        active_blocks=active_blocks + (block_name,),
                        depth=depth + 1,
                    )
                else:
                    self._visit_geometry_entity(
                        state,
                        virtual,
                        source_entity=original,
                        layout_name=layout_name,
                        instance_path=child_path,
                        transform_chain=chain,
                        block_name=block_name,
                        fallback_handle=child_handle,
                    )

    def _visit_geometry_entity(
        self,
        state: _BuildState,
        entity: DXFGraphic,
        *,
        source_entity: DXFGraphic,
        layout_name: str,
        instance_path: tuple[str, ...],
        transform_chain: tuple[np.ndarray, ...],
        block_name: str,
        fallback_handle: str,
        precreated: tuple[str, str] | None = None,
        attribute_tag: str = "",
        attribute_value: str = "",
    ) -> None:
        if precreated is None:
            definition_id = _definition_identity(
                state,
                source_entity,
                layout_id="BLOCKS" if block_name else layout_name,
                block_definition_path=(block_name,) if block_name else (),
                fallback_handle=fallback_handle,
            )
            occurrence_id = _add_occurrence(
                state,
                definition_id=definition_id,
                layout_name=layout_name,
                instance_path=instance_path,
                transform_chain=transform_chain,
            )
        else:
            definition_id, occurrence_id = precreated
        try:
            if entity.dxftype() in ANNOTATION_TYPES:
                self._visit_annotation(
                    state,
                    entity,
                    source_entity=source_entity,
                    definition_id=definition_id,
                    occurrence_id=occurrence_id,
                    layout_name=layout_name,
                    instance_path=instance_path,
                    transform_chain=transform_chain,
                    block_name=block_name,
                    fallback_handle=fallback_handle,
                )
                return
            record = _curve_record(
                state,
                entity,
                occurrence_id=occurrence_id,
                definition_id=definition_id,
            )
            if record is not None:
                state.geometry_records.append(record)
            if entity.dxftype() in {"TEXT", "MTEXT", "ATTRIB"}:
                _add_text(
                    state,
                    entity,
                    occurrence_id=occurrence_id,
                    layout_name=layout_name,
                    block_name=block_name,
                    attribute_tag=attribute_tag,
                    attribute_value=attribute_value,
                )
        except (ValueError, TypeError, AttributeError, ZeroDivisionError, OverflowError) as error:
            state.diagnostics.append(
                Diagnostic(
                    code="ENTITY_GEOMETRY_FAILED",
                    message=f"{entity.dxftype()} {fallback_handle} could not be normalized: {error}",
                    details=(("occurrence_id", occurrence_id),),
                )
            )

    @staticmethod
    def _bounds(records: list[GeometryRecord]) -> tuple[float, float, float, float]:
        if not records:
            return (0.0, 0.0, 0.0, 0.0)
        minima = np.asarray(
            [
                (min(point[0] for point in record.coordinates), min(point[1] for point in record.coordinates))
                for record in records
            ]
        )
        maxima = np.asarray(
            [
                (max(point[0] for point in record.coordinates), max(point[1] for point in record.coordinates))
                for record in records
            ]
        )
        return (
            float(minima[:, 0].min()),
            float(minima[:, 1].min()),
            float(maxima[:, 0].max()),
            float(maxima[:, 1].max()),
        )

    @staticmethod
    def _definition_table(state: _BuildState) -> EntityDefinitionTable:
        rows = [state.definition_rows[key] for key in sorted(state.definition_rows)]
        columns = list(zip(*rows)) if rows else [[] for _ in range(7)]
        return EntityDefinitionTable(*columns)

    @staticmethod
    def _occurrence_table(state: _BuildState) -> EntityOccurrenceTable:
        rows = [state.occurrence_rows[key] for key in sorted(state.occurrence_rows)]
        if not rows:
            return EntityOccurrenceTable.empty()
        transform_offsets = [0]
        transforms: list[np.ndarray] = []
        for row in rows:
            transforms.extend(row[5])
            transform_offsets.append(len(transforms))
        return EntityOccurrenceTable(
            occurrence_ids=[row[0] for row in rows],
            definition_ids=[row[1] for row in rows],
            layout_names=[row[2] for row in rows],
            instance_paths=[row[3] for row in rows],
            transform_classes=[row[4] for row in rows],
            transform_offsets=transform_offsets,
            transforms=np.asarray(transforms, dtype=np.float64).reshape((-1, 4, 4)),
        )

    @staticmethod
    def _text_store(state: _BuildState) -> TextStore:
        rows = sorted(state.text_rows, key=lambda row: (row[0], row[4], row[1]))
        if not rows:
            return TextStore.empty()
        return TextStore(
            occurrence_ids=[row[0] for row in rows],
            raw_text=[row[1] for row in rows],
            normalized_text=[row[2] for row in rows],
            plain_text=[row[3] for row in rows],
            block_attribute_tag=[row[4] for row in rows],
            block_attribute_value=[row[5] for row in rows],
            layer_name=[row[6] for row in rows],
            block_name=[row[7] for row in rows],
            layout_name=[row[8] for row in rows],
            drawing_title=[row[9] for row in rows],
            points=[row[10] for row in rows],
        )

    @staticmethod
    def _annotation_store(state: _BuildState) -> AnnotationStore:
        return AnnotationStore.from_records(state.annotation_records)
