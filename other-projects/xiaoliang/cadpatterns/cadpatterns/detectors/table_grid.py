from __future__ import annotations

import numpy as np
import shapely

from cadpatterns.candidates import (
    DetectionBatch,
    DetectionContext,
    make_candidate,
    member,
    physical_face_polygon,
    proof_grade_for_topology,
    topology_is_unsupported,
    unsupported_candidate,
)
from cadpatterns.contracts import (
    DetectorSpec,
    ProofGrade,
    ReferenceKind,
    ScopeType,
    TraceEvent,
    detector_registry,
)
from cadpatterns.ontology import GENERIC_TABLE_GRID


STRICT_GRID_SPEC = DetectorSpec(
    detector_id="table.strict_grid",
    version="1.0.0",
    pattern_type=GENERIC_TABLE_GRID,
    summary="Find complete orthogonal line lattices whose DCEL cell adjacency is consistent",
)


def _cluster_coordinates(values: list[float], tolerance: float) -> tuple[float, ...]:
    if not values:
        return ()
    groups: list[list[float]] = []
    for value in sorted(values):
        if not groups or value - groups[-1][-1] > tolerance:
            groups.append([value])
        else:
            groups[-1].append(value)
    return tuple(
        float(np.median(np.asarray(group, dtype=np.float64))) for group in groups
    )


def _scope_orthogonal_facts(context: DetectionContext, scope):
    arrangement = context.topology.arrangement
    frame = context.snapshot.coordinate_frame
    physical_vertices = frame.dequantize(arrangement.vertices_grid)
    local_vertices = np.asarray(
        [
            scope.local_frame.to_local((float(point[0]), float(point[1])))
            for point in physical_vertices
        ],
        dtype=np.float64,
    )
    allowed = set(scope.occurrence_ids)
    vertical: list[float] = []
    horizontal: list[float] = []
    source_ids: set[str] = set()
    for edge_index, edge in enumerate(arrangement.edge_vertices):
        start = int(arrangement.support_offsets[edge_index])
        end = int(arrangement.support_offsets[edge_index + 1])
        supporting = tuple(
            str(value) for value in arrangement.support_occurrence_ids[start:end]
        )
        if not allowed.intersection(supporting):
            continue
        left, right = local_vertices[edge]
        delta = right - left
        length = float(np.linalg.norm(delta))
        if length <= 0.0:
            continue
        if abs(float(delta[0])) / length <= context.profile.orthogonal_ratio:
            vertical.append(float((left[0] + right[0]) / 2.0))
            source_ids.update(supporting)
        elif abs(float(delta[1])) / length <= context.profile.orthogonal_ratio:
            horizontal.append(float((left[1] + right[1]) / 2.0))
            source_ids.update(supporting)
    tolerance = context.profile.grid_coordinate_merge_ratio
    return (
        _cluster_coordinates(vertical, tolerance),
        _cluster_coordinates(horizontal, tolerance),
        tuple(sorted(source_ids)),
        tolerance,
    )


def _face_bounds(context: DetectionContext, scope):
    values = []
    for face in context.topology.dcel.faces:
        polygon = physical_face_polygon(context, face.face_id)
        if polygon is None:
            continue
        coordinates = shapely.get_coordinates(polygon)
        local = np.asarray(
            [
                scope.local_frame.to_local((float(point[0]), float(point[1])))
                for point in coordinates
            ],
            dtype=np.float64,
        )
        values.append(
            (
                face,
                (
                    float(np.min(local[:, 0])),
                    float(np.min(local[:, 1])),
                    float(np.max(local[:, 0])),
                    float(np.max(local[:, 1])),
                ),
            )
        )
    return tuple(values)


def _matching_face(
    face_bounds,
    expected: tuple[float, float, float, float],
    tolerance: float,
):
    expected_min_x, expected_min_y, expected_max_x, expected_max_y = expected
    choices = []
    for face, bounds in face_bounds:
        min_x, min_y, max_x, max_y = bounds
        error = max(
            abs(min_x - expected_min_x),
            abs(min_y - expected_min_y),
            abs(max_x - expected_max_x),
            abs(max_y - expected_max_y),
        )
        if error <= tolerance:
            choices.append((error, face.face_id, face))
    return min(choices)[-1] if choices else None


def _cell_faces(
    context: DetectionContext,
    scope,
    x_coordinates: tuple[float, ...],
    y_coordinates: tuple[float, ...],
    tolerance: float,
):
    face_bounds = _face_bounds(context, scope)
    rows = len(y_coordinates) - 1
    columns = len(x_coordinates) - 1
    cells = []
    for row in range(rows):
        for column in range(columns):
            expected = (
                x_coordinates[column],
                y_coordinates[row],
                x_coordinates[column + 1],
                y_coordinates[row + 1],
            )
            face = _matching_face(face_bounds, expected, tolerance)
            if face is None:
                return ()
            cells.append(face)
    return tuple(cells)


def _adjacency_consistent(cells, rows: int, columns: int) -> bool:
    for row in range(rows):
        for column in range(columns):
            position = row * columns + column
            face = cells[position]
            adjacent = set(face.adjacent_face_ids)
            if column + 1 < columns and cells[position + 1].face_id not in adjacent:
                return False
            if row + 1 < rows and cells[position + columns].face_id not in adjacent:
                return False
    return True


def _cell_text(
    context: DetectionContext,
    scope,
    x_coordinates: tuple[float, ...],
    y_coordinates: tuple[float, ...],
):
    text_positions = {
        str(value): index
        for index, value in enumerate(context.snapshot.texts.occurrence_ids)
    }
    columns = len(x_coordinates) - 1
    rows = len(y_coordinates) - 1
    cells: dict[int, list[str]] = {}
    for occurrence_id in scope.text_occurrence_ids:
        text_index = text_positions.get(occurrence_id)
        if text_index is None:
            continue
        point = context.snapshot.texts.points[text_index]
        local_point = scope.local_frame.to_local((float(point[0]), float(point[1])))
        column = int(np.searchsorted(x_coordinates, local_point[0], side="right") - 1)
        row = int(np.searchsorted(y_coordinates, local_point[1], side="right") - 1)
        if 0 <= row < rows and 0 <= column < columns:
            cells.setdefault(row * columns + column, []).append(occurrence_id)
    return tuple(
        (position, tuple(sorted(values))) for position, values in sorted(cells.items())
    )


@detector_registry.detector(STRICT_GRID_SPEC)
def detect_strict_grids(context: DetectionContext) -> DetectionBatch:
    if topology_is_unsupported(context):
        drawing = context.scopes.of_type(ScopeType.DRAWING)[0]
        return DetectionBatch(
            instances=(
                unsupported_candidate(
                    context,
                    STRICT_GRID_SPEC,
                    pattern_type=GENERIC_TABLE_GRID,
                    scope_id=drawing.scope_id,
                    reason="strict cell proof is unavailable without accepted arrangement and DCEL facts",
                ),
            )
        )
    scopes = context.scopes.of_type(ScopeType.SPATIAL_CLUSTER)
    if not scopes:
        scopes = context.scopes.of_type(ScopeType.LAYOUT)
    if not scopes:
        scopes = context.scopes.of_type(ScopeType.DRAWING)
    proof_grade, assumptions = proof_grade_for_topology(context)
    minimum_cells = 2
    minimum_lines = minimum_cells + 1
    instances = []
    for scope in scopes:
        x_coordinates, y_coordinates, source_ids, tolerance = _scope_orthogonal_facts(
            context, scope
        )
        if len(x_coordinates) < minimum_lines or len(y_coordinates) < minimum_lines:
            continue
        rows = len(y_coordinates) - 1
        columns = len(x_coordinates) - 1
        if rows < minimum_cells or columns < minimum_cells:
            continue
        cells = _cell_faces(
            context,
            scope,
            x_coordinates,
            y_coordinates,
            max(
                tolerance,
                context.profile.cell_bounds_ratio,
                np.finfo(np.float64).eps,
            ),
        )
        if len(cells) != rows * columns or not _adjacency_consistent(cells, rows, columns):
            continue
        assigned_text = _cell_text(context, scope, x_coordinates, y_coordinates)
        members = [
            member(context, "grid_source", ReferenceKind.OCCURRENCE, value)
            for value in source_ids
        ]
        members.extend(
            member(context, "cell_face", ReferenceKind.FACE, face.face_id)
            for face in cells
        )
        members.extend(
            member(context, "cell_text", ReferenceKind.TEXT, occurrence_id)
            for _, values in assigned_text
            for occurrence_id in values
        )
        local_corners = (
            (x_coordinates[0], y_coordinates[0]),
            (x_coordinates[0], y_coordinates[-1]),
            (x_coordinates[-1], y_coordinates[0]),
            (x_coordinates[-1], y_coordinates[-1]),
        )
        world_corners = tuple(scope.local_frame.to_world(point) for point in local_corners)
        bounds = (
            min(point[0] for point in world_corners),
            min(point[1] for point in world_corners),
            max(point[0] for point in world_corners),
            max(point[1] for point in world_corners),
        )
        instances.append(
            make_candidate(
                context,
                STRICT_GRID_SPEC,
                pattern_type=GENERIC_TABLE_GRID,
                scope_id=scope.scope_id,
                members=tuple(members),
                proof_grade=proof_grade,
                score=1.0,
                features=(
                    ("cell_adjacency_consistent", True),
                    ("cells", tuple((index, face.face_id) for index, face in enumerate(cells))),
                    ("columns", columns),
                    ("detection_method", "strict_grid"),
                    ("inferred_grid_edges", ()),
                    ("rows", rows),
                    ("text_by_cell", assigned_text),
                    ("x_coordinates", x_coordinates),
                    ("y_coordinates", y_coordinates),
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
                STRICT_GRID_SPEC.detector_id,
                "orthogonal coordinate lattices checked against DCEL cells",
                (("candidate_count", len(instances)),),
            ),
        ),
    )
