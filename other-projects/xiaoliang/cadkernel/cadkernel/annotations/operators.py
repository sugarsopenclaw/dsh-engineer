from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import shapely

from cadkernel.contracts import (
    Decision,
    EvidenceRef,
    Exactness,
    OperatorSpec,
    OpResult,
    ToleranceProfile,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import AnnotationStore, AnnotationTargetRef, DrawingSnapshot


@dataclass(frozen=True, slots=True)
class AnnotationQueryHit:
    occurrence_id: str
    definition_id: str
    annotation_kind: str
    source_type: str
    measured_value: float | None
    text_override: str | None
    measurement_scale: float | None
    definition_points: tuple[tuple[float, float, float], ...]
    anchor_point: tuple[float, float, float] | None
    text_bounds: tuple[float, float, float, float] | None
    target_refs: tuple[AnnotationTargetRef, ...]
    boundary_refs: tuple[str, ...]
    pattern_name: str | None
    is_solid_fill: bool | None
    bounds: tuple[float, float, float, float] | None
    diagnostic_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AnnotationQueryBatch:
    query_bounds: tuple[float, float, float, float]
    candidate_count: int
    hits: tuple[AnnotationQueryHit, ...]


@dataclass(frozen=True, slots=True)
class ResolvedAnnotationTarget:
    annotation_occurrence_id: str
    association_kind: str
    target_occurrence_id: str | None
    target_source_handle: str | None
    target_point: tuple[float, float, float] | None
    distance: float | None
    exactness: Exactness


@dataclass(frozen=True, slots=True)
class ResolvedTargetBatch:
    annotation_occurrence_ids: tuple[str, ...]
    targets: tuple[ResolvedAnnotationTarget, ...]


def _optional_point(values: np.ndarray) -> tuple[float, float, float] | None:
    if np.isnan(values).all():
        return None
    return tuple(float(value) for value in values)


def _optional_bounds(values: np.ndarray) -> tuple[float, float, float, float] | None:
    if np.isnan(values).all():
        return None
    return tuple(float(value) for value in values)


def _hit(store: AnnotationStore, row: int) -> AnnotationQueryHit:
    definition_start = int(store.definition_point_offsets[row])
    definition_end = int(store.definition_point_offsets[row + 1])
    boundary_start = int(store.boundary_ref_offsets[row])
    boundary_end = int(store.boundary_ref_offsets[row + 1])
    diagnostic_start = int(store.diagnostic_offsets[row])
    diagnostic_end = int(store.diagnostic_offsets[row + 1])
    return AnnotationQueryHit(
        occurrence_id=str(store.occurrence_ids[row]),
        definition_id=str(store.definition_ids[row]),
        annotation_kind=str(store.annotation_kinds[row]),
        source_type=str(store.source_types[row]),
        measured_value=(
            float(store.measured_values[row]) if store.measured_value_present[row] else None
        ),
        text_override=(
            str(store.text_overrides[row]) if store.text_override_present[row] else None
        ),
        measurement_scale=(
            float(store.measurement_scales[row])
            if store.measurement_scale_present[row]
            else None
        ),
        definition_points=tuple(
            tuple(float(value) for value in point)
            for point in store.definition_points[definition_start:definition_end]
        ),
        anchor_point=_optional_point(store.anchor_points[row]),
        text_bounds=_optional_bounds(store.text_bounds[row]),
        target_refs=store.target_refs_at(row),
        boundary_refs=tuple(
            str(value) for value in store.boundary_refs[boundary_start:boundary_end]
        ),
        pattern_name=(str(store.pattern_names[row]) if store.pattern_name_present[row] else None),
        is_solid_fill=(
            bool(store.solid_fill_values[row]) if store.solid_fill_present[row] else None
        ),
        bounds=_optional_bounds(store.bounds[row]),
        diagnostic_codes=tuple(
            str(value) for value in store.diagnostic_codes[diagnostic_start:diagnostic_end]
        ),
    )


@operator_registry.operator(
    OperatorSpec(
        "annotation.query_region",
        "1.0.0",
        "Query structured annotations by conservative bounds and kind",
        "DrawingSnapshot+bounds",
        "AnnotationQueryBatch",
        Exactness.EXACT,
    )
)
def query_region(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
    bounds: tuple[float, float, float, float],
    *,
    kinds: tuple[str, ...] | list[str] | set[str] | None = None,
    limit: int | None = None,
) -> OpResult[AnnotationQueryBatch]:
    if limit is not None and (limit < 1 or limit > 10_000):
        raise ValueError("limit must be in [1, 10000]")
    min_x, min_y, max_x, max_y = (float(value) for value in bounds)
    if max_x < min_x or max_y < min_y:
        raise ValueError("Annotation query bounds are not ordered")
    normalized_kinds = tuple(sorted({str(kind).casefold() for kind in kinds or ()}))
    where = (
        "r.min_x <= ? AND r.max_x >= ? AND r.min_y <= ? AND r.max_y >= ?"
    )
    parameters: list[object] = [max_x, min_x, max_y, min_y]
    if normalized_kinds:
        where += " AND a.annotation_kind IN (" + ",".join("?" for _ in normalized_kinds) + ")"
        parameters.extend(normalized_kinds)
    connection = sqlite3.connect(Path(snapshot_path) / "snapshot.sqlite3")
    try:
        rows = list(
            connection.execute(
                "SELECT a.row_index FROM annotation_rtree r "
                "JOIN annotations a ON a.row_index=r.annotation_row "
                f"WHERE {where} ORDER BY a.occurrence_id",
                parameters,
            )
        )
    finally:
        connection.close()
    accepted: list[int] = []
    for (row_value,) in rows:
        row = int(row_value)
        stored = snapshot.annotations.bounds[row]
        if (
            stored[0] <= max_x
            and stored[2] >= min_x
            and stored[1] <= max_y
            and stored[3] >= min_y
        ):
            accepted.append(row)
    if limit is not None:
        accepted = accepted[:limit]
    hits = tuple(_hit(snapshot.annotations, row) for row in accepted)
    evidence = tuple(
        EvidenceRef(
            snapshot_id=snapshot.snapshot_id,
            occurrence_id=hit.occurrence_id,
            definition_entity_id=hit.definition_id,
        )
        for hit in hits
    )
    return successful_result(
        AnnotationQueryBatch(
            query_bounds=(min_x, min_y, max_x, max_y),
            candidate_count=len(rows),
            hits=hits,
        ),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.EXACT,
        evidence=evidence,
        derivation=(
            "SQLite annotation R*Tree broad phase",
            "float64 annotation-bounds intersection filter",
        ),
    )


def _geometry_objects(snapshot: DrawingSnapshot) -> np.ndarray:
    store = snapshot.geometry
    result = np.empty(len(store), dtype=object)
    for row in range(len(store)):
        start = int(store.coordinate_offsets[row])
        end = int(store.coordinate_offsets[row + 1])
        coordinates = store.coordinates[start:end, :2]
        result[row] = (
            shapely.Point(coordinates[0])
            if len(coordinates) == 1
            else shapely.LineString(coordinates)
        )
    return result


def _occurrence_position(snapshot: DrawingSnapshot, occurrence_id: str) -> int | None:
    positions = np.searchsorted(snapshot.occurrences.occurrence_ids, occurrence_id)
    if positions >= len(snapshot.occurrences):
        return None
    if str(snapshot.occurrences.occurrence_ids[positions]) != occurrence_id:
        return None
    return int(positions)


def _handle_targets(
    snapshot: DrawingSnapshot,
    annotation_occurrence_id: str,
    source_handle: str,
) -> tuple[str, ...]:
    definition_rows = np.flatnonzero(snapshot.definitions.source_handles == source_handle)
    if not len(definition_rows):
        return ()
    definition_ids = set(str(value) for value in snapshot.definitions.definition_ids[definition_rows])
    annotation_position = _occurrence_position(snapshot, annotation_occurrence_id)
    layout_name = (
        str(snapshot.occurrences.layout_names[annotation_position])
        if annotation_position is not None
        else None
    )
    candidates = [
        str(snapshot.occurrences.occurrence_ids[index])
        for index in range(len(snapshot.occurrences))
        if str(snapshot.occurrences.definition_ids[index]) in definition_ids
        and (
            layout_name is None
            or str(snapshot.occurrences.layout_names[index]) == layout_name
        )
    ]
    return tuple(sorted(candidates))


@operator_registry.operator(
    OperatorSpec(
        "annotation.resolve_targets",
        "1.0.0",
        "Resolve authored annotation references before tolerance-derived geometry targets",
        "DrawingSnapshot+annotation_ids",
        "ResolvedTargetBatch",
        Exactness.UNKNOWN,
        tolerance_fields=("endpoint_snap", "topological_closure"),
    )
)
def resolve_targets(
    snapshot: DrawingSnapshot,
    annotation_ids: Any,
    *,
    infer_geometry: bool = True,
    tolerance: float | None = None,
) -> OpResult[ResolvedTargetBatch]:
    positions = np.atleast_1d(snapshot.annotations.positions(annotation_ids))
    resolved_ids = tuple(str(value) for value in snapshot.annotations.occurrence_ids[positions])
    profile = ToleranceProfile.from_json(snapshot.tolerance_profile_json)
    radius = (
        max(profile.endpoint_snap, profile.topological_closure)
        if tolerance is None
        else float(tolerance)
    )
    if radius < 0:
        raise ValueError("target inference tolerance must be non-negative")

    geometry_objects: np.ndarray | None = None
    tree: shapely.STRtree | None = None
    eligible_rows = np.flatnonzero(~snapshot.geometry.annotation_derived)
    if infer_geometry and len(eligible_rows):
        geometry_objects = _geometry_objects(snapshot)
        tree = shapely.STRtree(geometry_objects[eligible_rows])

    targets: list[ResolvedAnnotationTarget] = []
    evidence: list[EvidenceRef] = []
    ambiguous = False
    used_inference = False
    for row, annotation_id in zip(positions, resolved_ids):
        row_index = int(row)
        evidence.append(
            EvidenceRef(
                snapshot_id=snapshot.snapshot_id,
                occurrence_id=annotation_id,
                definition_entity_id=str(snapshot.annotations.definition_ids[row_index]),
            )
        )
        for ref in snapshot.annotations.target_refs_at(row_index):
            explicit_occurrence_ids: tuple[str, ...] = ()
            if ref.occurrence_id:
                explicit_occurrence_ids = (ref.occurrence_id,)
            elif ref.source_handle:
                explicit_occurrence_ids = _handle_targets(
                    snapshot,
                    annotation_id,
                    ref.source_handle,
                )
            if explicit_occurrence_ids:
                for target_id in explicit_occurrence_ids:
                    targets.append(
                        ResolvedAnnotationTarget(
                            annotation_occurrence_id=annotation_id,
                            association_kind=ref.ref_kind,
                            target_occurrence_id=target_id,
                            target_source_handle=ref.source_handle,
                            target_point=ref.point,
                            distance=0.0,
                            exactness=Exactness.EXACT,
                        )
                    )
                    target_position = _occurrence_position(snapshot, target_id)
                    evidence.append(
                        EvidenceRef(
                            snapshot_id=snapshot.snapshot_id,
                            occurrence_id=target_id,
                            definition_entity_id=(
                                str(snapshot.occurrences.definition_ids[target_position])
                                if target_position is not None
                                else None
                            ),
                        )
                    )
            else:
                targets.append(
                    ResolvedAnnotationTarget(
                        annotation_occurrence_id=annotation_id,
                        association_kind=ref.ref_kind,
                        target_occurrence_id=None,
                        target_source_handle=ref.source_handle,
                        target_point=ref.point,
                        distance=None,
                        exactness=Exactness.EXACT,
                    )
                )

            if ref.point is None or tree is None or geometry_objects is None:
                continue
            point = shapely.Point(ref.point[:2])
            local_candidates = np.asarray(
                tree.query(point, predicate="dwithin", distance=radius),
                dtype=np.int64,
            )
            if not len(local_candidates):
                continue
            candidate_rows = eligible_rows[local_candidates]
            distances = np.asarray(
                shapely.distance(geometry_objects[candidate_rows], point),
                dtype=np.float64,
            )
            minimum = float(distances.min())
            tie_tolerance = max(profile.numeric_equality, np.finfo(np.float64).eps * 8)
            closest = candidate_rows[np.abs(distances - minimum) <= tie_tolerance]
            if len(closest) > 1:
                ambiguous = True
            for geometry_row in sorted(int(value) for value in closest):
                target_id = str(snapshot.geometry.occurrence_ids[geometry_row])
                targets.append(
                    ResolvedAnnotationTarget(
                        annotation_occurrence_id=annotation_id,
                        association_kind="geometric_inference",
                        target_occurrence_id=target_id,
                        target_source_handle=None,
                        target_point=ref.point,
                        distance=minimum,
                        exactness=Exactness.GRID_SNAPPED,
                    )
                )
                evidence.append(
                    EvidenceRef(
                        snapshot_id=snapshot.snapshot_id,
                        occurrence_id=target_id,
                        definition_entity_id=str(snapshot.geometry.definition_ids[geometry_row]),
                    )
                )
            used_inference = True

    targets.sort(
        key=lambda value: (
            value.annotation_occurrence_id,
            value.association_kind,
            value.target_occurrence_id or "",
            value.target_source_handle or "",
        )
    )
    unique_evidence = tuple(
        {
            (
                item.occurrence_id or "",
                item.definition_entity_id or "",
            ): item
            for item in evidence
        }[key]
        for key in sorted(
            {
                (item.occurrence_id or "", item.definition_entity_id or "")
                for item in evidence
            }
        )
    )
    return successful_result(
        ResolvedTargetBatch(resolved_ids, tuple(targets)),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED if used_inference else Exactness.EXACT,
        decision=Decision.AMBIGUOUS if ambiguous else Decision.COMPUTED,
        evidence=unique_evidence,
        assumptions=(
            f"geometric inference radius={radius:g} {snapshot.unit_status}",
        )
        if used_inference
        else (),
        derivation=(
            "authored object handles and arrow points are retained as exact source facts",
            "optional STRtree dwithin candidates are resolved by minimum geometry distance",
        ),
    )
