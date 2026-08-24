from __future__ import annotations

import numpy as np
import shapely

from cadpatterns.candidates import (
    DetectionBatch,
    DetectionContext,
    face_occurrence_ids,
    make_candidate,
    member,
    physical_face_polygon,
    proof_grade_for_topology,
    topology_is_unsupported,
    unsupported_candidate,
)
from cadpatterns.contracts import (
    DetectorSpec,
    ReferenceKind,
    ScopeType,
    TraceEvent,
    detector_registry,
)
from cadpatterns.ontology import GENERIC_SHEET_BOUNDARY_CANDIDATE


SHEET_BOUNDARY_SPEC = DetectorSpec(
    detector_id="sheet_boundary.peripheral_face",
    version="1.0.0",
    pattern_type=GENERIC_SHEET_BOUNDARY_CANDIDATE,
    summary="Select rectangular peripheral faces that contain stable drawing content",
)


def _face_scope(context: DetectionContext, face_id: str):
    return next(
        scope
        for scope in context.scopes.of_type(ScopeType.ENCLOSURE)
        if scope.source_ref == face_id
    )


def _safe_ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator > 0.0 else 0.0


def _internal_rows(
    context: DetectionContext,
    bounds: tuple[float, float, float, float],
    boundary_occurrences: tuple[str, ...],
) -> np.ndarray:
    min_x, min_y, max_x, max_y = bounds
    geometry = context.snapshot.geometry
    excluded = set(boundary_occurrences)

    def is_internal(row: int) -> bool:
        row_min_x, row_min_y, row_max_x, row_max_y = geometry.bounds[row]
        return (
            row_min_x >= min_x
            and row_min_y >= min_y
            and row_max_x <= max_x
            and row_max_y <= max_y
        )

    return np.asarray(
        [
            row
            for row, occurrence_id in enumerate(geometry.occurrence_ids)
            if str(occurrence_id) not in excluded
            and is_internal(row)
        ],
        dtype=np.int64,
    )


def _whitespace_stability(
    context: DetectionContext,
    bounds: tuple[float, float, float, float],
    internal_rows: np.ndarray,
) -> float:
    if not len(internal_rows):
        return 0.0
    min_x, min_y, max_x, max_y = bounds
    content = context.snapshot.geometry.bounds[internal_rows]
    content_min_x, content_min_y, content_max_x, content_max_y = content.T
    margins = np.asarray(
        (
            float(np.min(content_min_x)) - min_x,
            float(np.min(content_min_y)) - min_y,
            max_x - float(np.max(content_max_x)),
            max_y - float(np.max(content_max_y)),
        ),
        dtype=np.float64,
    )
    span = max(max_x - min_x, max_y - min_y)
    spread = float(np.max(margins) - np.min(margins))
    return max(0.0, min(1.0, 1.0 - _safe_ratio(spread, span)))


@detector_registry.detector(SHEET_BOUNDARY_SPEC)
def detect_sheet_boundaries(context: DetectionContext) -> DetectionBatch:
    drawing_scope = context.scopes.of_type(ScopeType.DRAWING)[0]
    if topology_is_unsupported(context):
        return DetectionBatch(
            instances=(
                unsupported_candidate(
                    context,
                    SHEET_BOUNDARY_SPEC,
                    pattern_type=GENERIC_SHEET_BOUNDARY_CANDIDATE,
                    scope_id=drawing_scope.scope_id,
                    reason="sheet-boundary detection requires accepted DCEL topology",
                ),
            )
        )
    drawing_min_x, drawing_min_y, drawing_max_x, drawing_max_y = drawing_scope.bounds
    drawing_area = (drawing_max_x - drawing_min_x) * (drawing_max_y - drawing_min_y)
    geometry_count = len(context.snapshot.geometry)
    proof_grade, assumptions = proof_grade_for_topology(context)
    instances = []
    for face in context.topology.dcel.faces:
        polygon = physical_face_polygon(context, face.face_id)
        if polygon is None:
            continue
        bounds = tuple(float(value) for value in shapely.bounds(polygon))
        min_x, min_y, max_x, max_y = bounds
        envelope_area = (max_x - min_x) * (max_y - min_y)
        rectangularity = _safe_ratio(float(polygon.area), envelope_area)
        peripherality = _safe_ratio(envelope_area, drawing_area)
        boundary_occurrences = face_occurrence_ids(context, face.face_id)
        internal_rows = _internal_rows(context, bounds, boundary_occurrences)
        available_internal = max(geometry_count - len(boundary_occurrences), 0)
        internal_coverage = _safe_ratio(float(len(internal_rows)), float(available_internal))
        whitespace_stability = _whitespace_stability(context, bounds, internal_rows)
        if (
            rectangularity < context.profile.sheet_min_rectangularity
            or peripherality < context.profile.sheet_min_peripherality
            or internal_coverage < context.profile.sheet_min_internal_coverage
            or whitespace_stability < context.profile.sheet_min_whitespace_stability
        ):
            continue
        scope = _face_scope(context, face.face_id)
        instances.append(
            make_candidate(
                context,
                SHEET_BOUNDARY_SPEC,
                pattern_type=GENERIC_SHEET_BOUNDARY_CANDIDATE,
                scope_id=scope.scope_id,
                members=(
                    member(context, "bounded_face", ReferenceKind.FACE, face.face_id),
                    *(
                        member(
                            context,
                            "boundary_source",
                            ReferenceKind.OCCURRENCE,
                            occurrence_id,
                        )
                        for occurrence_id in boundary_occurrences
                    ),
                ),
                proof_grade=proof_grade,
                score=min(
                    rectangularity,
                    peripherality,
                    internal_coverage,
                    whitespace_stability,
                ),
                features=(
                    ("detection_method", "peripheral_face"),
                    ("face_id", face.face_id),
                    ("internal_coverage", internal_coverage),
                    ("peripherality", peripherality),
                    ("rectangularity", rectangularity),
                    ("whitespace_stability", whitespace_stability),
                ),
                bounds=bounds,
                assumptions=assumptions,
            )
        )
    return DetectionBatch(
        instances=tuple(instances),
        trace=(
            TraceEvent.create(
                "detector",
                SHEET_BOUNDARY_SPEC.detector_id,
                "peripheral rectangular faces evaluated as sheet-boundary candidates",
                (("candidate_count", len(instances)),),
            ),
        ),
    )
