from __future__ import annotations

import sqlite3
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely

from cadkernel._serialization import stable_json_loads
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    EvidenceRef,
    Exactness,
    OperatorSpec,
    OpResult,
    OpStatus,
    ToleranceProfile,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot


@dataclass(frozen=True, slots=True)
class SpatialQueryBatch:
    occurrence_ids: tuple[str, ...]
    geometry_rows: tuple[int, ...]
    candidate_count: int
    query_bounds: tuple[float, float, float, float]
    layer_names: tuple[str, ...] = ()
    source_types: tuple[str, ...] = ()
    block_names: tuple[str, ...] = ()
    bounds: tuple[tuple[float, float, float, float], ...] = ()


@dataclass(frozen=True, slots=True)
class TextSearchHit:
    occurrence_id: str
    score: float
    plain_text: str
    layer_name: str
    block_name: str
    layout_name: str
    anchor_point: tuple[float, float, float]
    bounds: tuple[float, float, float, float]
    source_type: str
    matched_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TextSearchBatch:
    query: str
    hits: tuple[TextSearchHit, ...]


@dataclass(frozen=True, slots=True)
class EndpointHit:
    endpoint_id: str
    occurrence_id: str
    endpoint_ordinal: int
    grid_coordinate: tuple[int, int]
    distance: float


@dataclass(frozen=True, slots=True)
class EndpointHitBatch:
    point: tuple[float, float]
    radius: float
    hits: tuple[EndpointHit, ...]


@dataclass(frozen=True, slots=True)
class FaceQueryHit:
    face_id: str
    depth: int
    hole_count: int
    area: float
    representative_point: tuple[float, float]
    bounds: tuple[float, float, float, float]
    boundary_occurrence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class FaceQueryBatch:
    query_bounds: tuple[float, float, float, float]
    candidate_count: int
    hits: tuple[FaceQueryHit, ...]


@dataclass(frozen=True, slots=True)
class PointInFaceHit:
    face: FaceQueryHit
    relation: str


@dataclass(frozen=True, slots=True)
class PointInFaceBatch:
    point: tuple[float, float]
    candidate_count: int
    hits: tuple[PointInFaceHit, ...]


def _orientation(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    ab = b - a
    ac = c - a
    return ab[..., 0] * ac[..., 1] - ab[..., 1] * ac[..., 0]


def _on_segment(a: np.ndarray, b: np.ndarray, point: np.ndarray) -> np.ndarray:
    return (
        (np.minimum(a[..., 0], b[..., 0]) <= point[..., 0])
        & (point[..., 0] <= np.maximum(a[..., 0], b[..., 0]))
        & (np.minimum(a[..., 1], b[..., 1]) <= point[..., 1])
        & (point[..., 1] <= np.maximum(a[..., 1], b[..., 1]))
    )


def _segments_intersect(
    starts: np.ndarray,
    ends: np.ndarray,
    edge_start: np.ndarray,
    edge_end: np.ndarray,
) -> np.ndarray:
    o1 = _orientation(starts, ends, edge_start)
    o2 = _orientation(starts, ends, edge_end)
    o3 = _orientation(edge_start, edge_end, starts)
    o4 = _orientation(edge_start, edge_end, ends)
    proper = ((o1 > 0) != (o2 > 0)) & ((o3 > 0) != (o4 > 0))
    return (
        proper
        | ((o1 == 0) & _on_segment(starts, ends, edge_start))
        | ((o2 == 0) & _on_segment(starts, ends, edge_end))
        | ((o3 == 0) & _on_segment(edge_start, edge_end, starts))
        | ((o4 == 0) & _on_segment(edge_start, edge_end, ends))
    )


def _point_in_ring(point: np.ndarray, ring: np.ndarray) -> bool:
    starts = ring[:-1]
    ends = ring[1:]
    upward = (starts[:, 1] <= point[1]) & (ends[:, 1] > point[1])
    downward = (starts[:, 1] > point[1]) & (ends[:, 1] <= point[1])
    orientations = _orientation(starts, ends, point)
    winding = int(np.count_nonzero(upward & (orientations > 0))) - int(
        np.count_nonzero(downward & (orientations < 0))
    )
    return winding != 0


def _exact_grid_intersects_box(
    snapshot: DrawingSnapshot,
    geometry_row: int,
    grid_box: tuple[int, int, int, int],
) -> bool:
    geometry = snapshot.geometry
    start = int(geometry.coordinate_offsets[geometry_row])
    end = int(geometry.coordinate_offsets[geometry_row + 1])
    points = geometry.grid_coordinates[start:end]
    min_x, min_y, max_x, max_y = grid_box
    inside = (
        (points[:, 0] >= min_x)
        & (points[:, 0] <= max_x)
        & (points[:, 1] >= min_y)
        & (points[:, 1] <= max_y)
    )
    if np.any(inside):
        return True
    if len(points) < 2:
        return False
    starts = points[:-1]
    ends = points[1:]
    box_points = np.asarray(
        [[min_x, min_y], [max_x, min_y], [max_x, max_y], [min_x, max_y], [min_x, min_y]],
        dtype=np.int64,
    )
    for edge_start, edge_end in zip(box_points[:-1], box_points[1:]):
        if np.any(_segments_intersect(starts, ends, edge_start, edge_end)):
            return True
    if geometry.closed[geometry_row] and _point_in_ring(box_points[0], points):
        return True
    return False


def _spatial_projections(
    snapshot: DrawingSnapshot,
    geometry_rows: tuple[int, ...],
) -> tuple[
    tuple[str, ...],
    tuple[str, ...],
    tuple[str, ...],
    tuple[tuple[float, float, float, float], ...],
]:
    if not geometry_rows:
        return (), (), (), ()
    rows = np.asarray(geometry_rows, dtype=np.int64)
    definition_positions = np.searchsorted(
        snapshot.definitions.definition_ids,
        snapshot.geometry.definition_ids[rows],
    )
    layer_names = tuple(
        str(value) for value in snapshot.definitions.layers[definition_positions]
    )
    block_names: list[str] = []
    for value in snapshot.definitions.block_definition_paths[definition_positions]:
        path = stable_json_loads(str(value))
        block_names.append(str(path[-1]) if path else "")
    source_types = tuple(str(value) for value in snapshot.geometry.source_types[rows])
    projected_bounds = tuple(
        tuple(float(value) for value in row)
        for row in snapshot.geometry.bounds[rows]
    )
    return layer_names, source_types, tuple(block_names), projected_bounds


@operator_registry.operator(
    OperatorSpec("spatial_index.query_region", "1.1.0", "Conservative RTree region query with exact checked-grid filter", "DrawingSnapshot+bounds", "SpatialQueryBatch", Exactness.EXACT_PREDICATE)
)
def query_region(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
    bounds: tuple[float, float, float, float],
    *,
    limit: int | None = None,
) -> OpResult[SpatialQueryBatch]:
    if limit is not None and (limit < 1 or limit > 10_000):
        raise ValueError("limit must be in [1, 10000]")
    min_x, min_y, max_x, max_y = (float(item) for item in bounds)
    if max_x < min_x or max_y < min_y:
        raise ValueError("Query bounds are not ordered")
    frame_min_x, frame_min_y, frame_max_x, frame_max_y = snapshot.coordinate_frame.bounds
    frame_margin = snapshot.coordinate_frame.grid_size / 2.0
    if (
        max_x < frame_min_x - frame_margin
        or min_x > frame_max_x + frame_margin
        or max_y < frame_min_y - frame_margin
        or min_y > frame_max_y + frame_margin
    ):
        return successful_result(
            SpatialQueryBatch((), (), 0, (min_x, min_y, max_x, max_y)),
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            exactness=Exactness.EXACT_PREDICATE,
            derivation=("query bounds are disjoint from the coordinate frame",),
        )
    clipped = (
        max(min_x, frame_min_x),
        max(min_y, frame_min_y),
        min(max_x, frame_max_x),
        min(max_y, frame_max_y),
    )
    grid_corners = snapshot.coordinate_frame.quantize(
        [[clipped[0], clipped[1]], [clipped[2], clipped[3]]]
    )
    grid_box = (
        int(grid_corners[:, 0].min()),
        int(grid_corners[:, 1].min()),
        int(grid_corners[:, 0].max()),
        int(grid_corners[:, 1].max()),
    )
    # R*Tree stores source floating bounds, while the authoritative narrow
    # predicate works on quantized grid geometry.  Build the broad-phase box
    # from the quantized query cell and expand by half a grid cell so an entity
    # rounded onto the boundary cannot be lost before exact filtering.
    dequantized = snapshot.coordinate_frame.dequantize(
        [[grid_box[0], grid_box[1]], [grid_box[2], grid_box[3]]]
    )
    half_grid = snapshot.coordinate_frame.grid_size / 2.0
    broad_bounds = (
        float(np.nextafter(dequantized[0, 0] - half_grid, -np.inf)),
        float(np.nextafter(dequantized[0, 1] - half_grid, -np.inf)),
        float(np.nextafter(dequantized[1, 0] + half_grid, np.inf)),
        float(np.nextafter(dequantized[1, 1] + half_grid, np.inf)),
    )
    connection = sqlite3.connect(Path(snapshot_path) / "snapshot.sqlite3")
    try:
        candidates = list(
            connection.execute(
                """SELECT r.rtree_id - 1 AS geometry_row
                   FROM entity_rtree r
                   WHERE r.min_x <= ? AND r.max_x >= ? AND r.min_y <= ? AND r.max_y >= ?
                   ORDER BY r.rtree_id""",
                (broad_bounds[2], broad_bounds[0], broad_bounds[3], broad_bounds[1]),
            )
        )
    finally:
        connection.close()
    if not candidates:
        return successful_result(
            SpatialQueryBatch((), (), 0, (min_x, min_y, max_x, max_y)),
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            exactness=Exactness.EXACT_PREDICATE,
            derivation=("conservative SQLite R*Tree broad phase returned no candidates",),
        )
    accepted = [
        (int(candidate[0]), str(snapshot.geometry.occurrence_ids[int(candidate[0])]))
        for candidate in candidates
        if _exact_grid_intersects_box(snapshot, int(candidate[0]), grid_box)
    ]
    if limit is not None:
        accepted = accepted[:limit]
    geometry_rows = tuple(item[0] for item in accepted)
    layer_names, source_types, block_names, projected_bounds = _spatial_projections(
        snapshot,
        geometry_rows,
    )
    return successful_result(
        SpatialQueryBatch(
            occurrence_ids=tuple(item[1] for item in accepted),
            geometry_rows=geometry_rows,
            candidate_count=len(candidates),
            query_bounds=(min_x, min_y, max_x, max_y),
            layer_names=layer_names,
            source_types=source_types,
            block_names=block_names,
            bounds=projected_bounds,
        ),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.EXACT_PREDICATE,
        derivation=(
            "half-grid-conservative SQLite R*Tree broad phase",
            "int64 grid segment/rectangle exact filter",
        ),
    )


def _literal_fts_query(query: str) -> str:
    normalized = unicodedata.normalize("NFKC", query).casefold()
    tokens = [token for token in normalized.split() if token]
    if not tokens:
        raise ValueError("Text query must contain a non-whitespace token")
    return " AND ".join(f'"{token.replace(chr(34), chr(34) * 2)}"' for token in tokens)


_TEXT_SEARCH_FIELDS = (
    "raw_text",
    "normalized_text",
    "plain_text",
    "block_attribute_tag",
    "block_attribute_value",
    "layer_name",
    "block_name",
    "layout_name",
    "drawing_title",
)


def _filter_values(values: object | None, *, upper: bool = False) -> tuple[str, ...]:
    if values is None:
        return ()
    if isinstance(values, str):
        items = (values,)
    else:
        items = tuple(str(value) for value in values)  # type: ignore[arg-type]
    normalized = (value.upper() if upper else value for value in items)
    return tuple(sorted(set(normalized)))


@operator_registry.operator(
    OperatorSpec("text_index.search", "1.1.0", "Ranked normalized FTS5 text search with structural filters", "DrawingSnapshot+query", "TextSearchBatch", Exactness.EXACT)
)
def search_text(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
    query: str,
    *,
    limit: int = 50,
    layer_in: object | None = None,
    layer_not_in: object | None = None,
    source_type_in: object | None = None,
    field_in: object | None = None,
) -> OpResult[TextSearchBatch]:
    if limit < 1 or limit > 10_000:
        raise ValueError("limit must be in [1, 10000]")
    included_layers = _filter_values(layer_in)
    excluded_layers = _filter_values(layer_not_in)
    included_source_types = _filter_values(source_type_in, upper=True)
    included_fields = _filter_values(field_in)
    unknown_fields = tuple(sorted(set(included_fields) - set(_TEXT_SEARCH_FIELDS)))
    if unknown_fields:
        raise ValueError("Unknown text search fields: " + ", ".join(unknown_fields))
    match_expression = _literal_fts_query(query)
    if included_fields:
        match_expression = "{" + " ".join(included_fields) + "} : (" + match_expression + ")"
    predicates = ["text_fts MATCH ?"]
    parameters: list[object] = [match_expression]
    if included_layers:
        predicates.append("f.layer_name IN (" + ",".join("?" for _ in included_layers) + ")")
        parameters.extend(included_layers)
    if excluded_layers:
        predicates.append("f.layer_name NOT IN (" + ",".join("?" for _ in excluded_layers) + ")")
        parameters.extend(excluded_layers)
    if included_source_types:
        predicates.append("UPPER(g.source_type) IN (" + ",".join("?" for _ in included_source_types) + ")")
        parameters.extend(included_source_types)
    parameters.append(limit)
    connection = sqlite3.connect(Path(snapshot_path) / "snapshot.sqlite3")
    try:
        rows = list(
            connection.execute(
                "SELECT f.rowid,f.occurrence_id,bm25(text_fts) AS score,"
                "f.plain_text,f.layer_name,f.block_name,f.layout_name,g.source_type,"
                + ",".join(
                    f"highlight(text_fts,{index},char(1),char(2))"
                    for index in range(1, 10)
                )
                + " FROM text_fts f "
                "JOIN occurrences o ON o.occurrence_id=f.occurrence_id "
                "JOIN geometry_entities g ON g.occurrence_row=o.row_index "
                "WHERE "
                + " AND ".join(predicates)
                + " ORDER BY score,f.occurrence_id LIMIT ?",
                parameters,
            )
        )
    finally:
        connection.close()
    hits_list: list[TextSearchHit] = []
    for row in rows:
        text_row = int(row[0])
        occurrence_id = str(row[1])
        geometry_row = int(snapshot.geometry.positions([occurrence_id])[0])
        anchor = tuple(float(value) for value in snapshot.texts.points[text_row])
        bounds_value = tuple(float(value) for value in snapshot.geometry.bounds[geometry_row])
        matched_fields = tuple(
            field
            for field, highlighted in zip(_TEXT_SEARCH_FIELDS, row[8:17])
            if "\x01" in str(highlighted)
        )
        hits_list.append(
            TextSearchHit(
                occurrence_id=occurrence_id,
                score=float(row[2]),
                plain_text=str(row[3]),
                layer_name=str(row[4]),
                block_name=str(row[5]),
                layout_name=str(row[6]),
                anchor_point=anchor,
                bounds=bounds_value,
                source_type=str(row[7]),
                matched_fields=matched_fields,
            )
        )
    hits = tuple(hits_list)
    return successful_result(
        TextSearchBatch(query=query, hits=hits),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.EXACT,
        derivation=(
            "SQLite FTS5 unicode61 ranked search",
            "column highlights retain the exact matched field set",
            "layer and source-type predicates are applied before LIMIT",
        ),
    )


@operator_registry.operator(
    OperatorSpec("endpoint_index.query_radius", "1.0.0", "Endpoint grid radius query with exact distance filter", "DrawingSnapshot+point", "EndpointHitBatch", Exactness.GRID_SNAPPED, tolerance_fields=("endpoint_snap",))
)
def query_endpoints(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
    point: tuple[float, float],
    *,
    radius: float | None = None,
    limit: int | None = None,
) -> OpResult[EndpointHitBatch]:
    if limit is not None and (limit < 1 or limit > 10_000):
        raise ValueError("limit must be in [1, 10000]")
    tolerance = ToleranceProfile.from_json(snapshot.tolerance_profile_json)
    query_radius = tolerance.endpoint_snap if radius is None else float(radius)
    if query_radius < 0:
        raise ValueError("Endpoint radius must be non-negative")
    if len(snapshot.geometry) == 0:
        return successful_result(
            EndpointHitBatch(tuple(float(item) for item in point), query_radius, ()),
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            exactness=Exactness.GRID_SNAPPED,
            derivation=("empty endpoint index",),
        )
    grid_point = snapshot.coordinate_frame.quantize([point])[0]
    radius_grid = int(np.ceil(query_radius / snapshot.coordinate_frame.grid_size))
    connection = sqlite3.connect(Path(snapshot_path) / "snapshot.sqlite3")
    try:
        cell_width = int(connection.execute("SELECT value FROM metadata WHERE key='endpoint_cell_width'").fetchone()[0])
        min_cell_x = int((grid_point[0] - radius_grid) // cell_width)
        max_cell_x = int((grid_point[0] + radius_grid) // cell_width)
        min_cell_y = int((grid_point[1] - radius_grid) // cell_width)
        max_cell_y = int((grid_point[1] + radius_grid) // cell_width)
        rows = list(
            connection.execute(
                """SELECT geometry_row,endpoint_ordinal,grid_x,grid_y
                   FROM endpoint_grid
                   WHERE cell_x BETWEEN ? AND ? AND cell_y BETWEEN ? AND ?
                   ORDER BY geometry_row,endpoint_ordinal""",
                (min_cell_x, max_cell_x, min_cell_y, max_cell_y),
            )
        )
    finally:
        connection.close()
    hits: list[EndpointHit] = []
    for geometry_row, ordinal, grid_x, grid_y in rows:
        delta = np.asarray((int(grid_x), int(grid_y)), dtype=np.int64) - grid_point
        distance = float(np.linalg.norm(delta.astype(np.float64)) * snapshot.coordinate_frame.grid_size)
        if distance <= query_radius:
            occurrence_id = str(snapshot.geometry.occurrence_ids[int(geometry_row)])
            hits.append(
                EndpointHit(
                    f"{occurrence_id}:{int(ordinal)}",
                    occurrence_id,
                    int(ordinal),
                    (int(grid_x), int(grid_y)),
                    distance,
                )
            )
            if limit is not None and len(hits) >= limit:
                break
    return successful_result(
        EndpointHitBatch(tuple(float(item) for item in point), query_radius, tuple(hits)),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED,
        derivation=("endpoint grid cell broad phase", "exact Euclidean grid-radius filter"),
    )


@operator_registry.operator(
    OperatorSpec("topology.query_faces", "1.1.0", "Validated face-index query with ambiguity gate", "DrawingSnapshot+bounds", "FaceQueryBatch", Exactness.FLOATING_CONSTRUCTION)
)
def query_faces(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
    bounds: tuple[float, float, float, float],
    *,
    limit: int | None = None,
) -> OpResult[FaceQueryBatch]:
    if limit is not None and (limit < 1 or limit > 10_000):
        raise ValueError("limit must be in [1, 10000]")
    min_x, min_y, max_x, max_y = (float(item) for item in bounds)
    if max_x < min_x or max_y < min_y:
        raise ValueError("Face query bounds are not ordered")
    database = Path(snapshot_path) / "snapshot.sqlite3"
    connection = sqlite3.connect(database)
    try:
        validation_row = connection.execute(
            "SELECT decision,validation_diagnostics_json FROM derived_artifacts "
            "WHERE operator_id='topology.compile' ORDER BY artifact_id LIMIT 1"
        ).fetchone()
    finally:
        connection.close()
    empty_value = FaceQueryBatch((min_x, min_y, max_x, max_y), 0, ())
    if validation_row is None:
        return OpResult(
            status=OpStatus.UNSUPPORTED,
            value=empty_value,
            decision=Decision.UNSUPPORTED,
            exactness=Exactness.UNKNOWN,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            diagnostics=(
                Diagnostic(
                    code="FACE_INDEX_UNAVAILABLE",
                    message="The snapshot has no compiled topology artifact.",
                    severity=DiagnosticSeverity.WARNING,
                ),
            ),
            derivation=("face query requires a persisted topology.compile artifact",),
        )
    artifact_decision = str(validation_row[0])
    validation_diagnostics = tuple(
        Diagnostic.from_dict(item)
        if isinstance(item, dict)
        else Diagnostic(
            code="DCEL_VALIDATION_FAILED",
            message=str(item),
            severity=DiagnosticSeverity.ERROR,
        )
        for item in stable_json_loads(str(validation_row[1]))
    )
    if artifact_decision != "computed":
        if not validation_diagnostics:
            validation_diagnostics = (
                Diagnostic(
                    code="TOPOLOGY_ARTIFACT_NON_QUERYABLE",
                    message=(
                        f"Topology artifact decision is {artifact_decision!r}; "
                        "face conclusions are not queryable."
                    ),
                    severity=DiagnosticSeverity.ERROR,
                ),
            )
        return OpResult(
            status=OpStatus.AMBIGUOUS,
            value=empty_value,
            decision=Decision.AMBIGUOUS,
            exactness=Exactness.FLOATING_CONSTRUCTION,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            diagnostics=validation_diagnostics,
            derivation=(
                "the aggregate topology compilation decision gates the query before loading candidate geometry",
            ),
        )
    connection = sqlite3.connect(database)
    try:
        candidates = list(
            connection.execute(
                """SELECT f.face_id,f.depth,f.hole_count,f.area,f.geometry_wkb,f.boundary_json
                   FROM face_rtree r JOIN faces f ON f.row_index=r.face_row
                   WHERE r.min_x <= ? AND r.max_x >= ? AND r.min_y <= ? AND r.max_y >= ?
                   ORDER BY f.face_id""",
                (max_x, min_x, max_y, min_y),
            )
        )
    finally:
        connection.close()
    # A degenerate box collapses to an invalid polygon, and GEOS predicates on
    # invalid geometry are undefined behavior; use the matching valid geometry.
    if min_x == max_x and min_y == max_y:
        query_geometry = shapely.points(min_x, min_y)
    elif min_x == max_x or min_y == max_y:
        query_geometry = shapely.linestrings([(min_x, min_y), (max_x, max_y)])
    else:
        query_geometry = shapely.box(min_x, min_y, max_x, max_y)
    try:
        if candidates:
            geometries = shapely.from_wkb([bytes(row[4]) for row in candidates])
            accepted = shapely.intersects(geometries, query_geometry)
        else:
            geometries = np.asarray([], dtype=object)
            accepted = np.asarray([], dtype=np.bool_)
    except (shapely.errors.GEOSException, ValueError, TypeError) as error:
        return OpResult(
            status=OpStatus.FAILED,
            value=empty_value,
            decision=Decision.REJECTED,
            exactness=Exactness.UNKNOWN,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            diagnostics=(
                Diagnostic(
                    code="FACE_GEOMETRY_INVALID",
                    message=f"Validated face index could not be queried safely: {error}",
                    severity=DiagnosticSeverity.ERROR,
                ),
            ),
            derivation=("validated artifact contained unreadable or invalid face geometry",),
        )
    hits_list: list[FaceQueryHit] = []
    for row, geometry, keep in zip(candidates, geometries, accepted):
        if not keep:
            continue
        point = shapely.point_on_surface(geometry)
        point_coordinates = shapely.get_coordinates(point)[0]
        geometry_bounds = tuple(float(value) for value in shapely.bounds(geometry))
        boundary = stable_json_loads(str(row[5]))
        hits_list.append(
            FaceQueryHit(
                face_id=str(row[0]),
                depth=int(row[1]),
                hole_count=int(row[2]),
                area=float(row[3]),
                representative_point=(
                    float(point_coordinates[0]),
                    float(point_coordinates[1]),
                ),
                bounds=geometry_bounds,
                boundary_occurrence_ids=tuple(
                    str(value) for value in boundary["boundary_occurrence_ids"]
                ),
            )
        )
    hits = tuple(hits_list)
    if limit is not None:
        hits = hits[:limit]
    value = FaceQueryBatch((min_x, min_y, max_x, max_y), len(candidates), hits)
    return successful_result(
        value,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.FLOATING_CONSTRUCTION,
        derivation=("SQLite face R*Tree broad phase", "validated DCEL polygon intersection filter"),
    )


def _grid_ring_relation(point: np.ndarray, ring: np.ndarray) -> str:
    starts = ring[:-1]
    ends = ring[1:]
    orientations = _orientation(starts, ends, point)
    if np.any((orientations == 0) & _on_segment(starts, ends, point)):
        return "boundary"
    return "inside" if _point_in_ring(point, ring) else "outside"


@operator_registry.operator(
    OperatorSpec(
        "topology.point_in_face",
        "1.0.0",
        "Checked-grid point classification against validated persisted faces",
        "DrawingSnapshot+point",
        "PointInFaceBatch",
        Exactness.GRID_SNAPPED,
    )
)
def point_in_face(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
    point: tuple[float, float],
    *,
    limit: int | None = None,
) -> OpResult[PointInFaceBatch]:
    query_point = (float(point[0]), float(point[1]))
    face_result = query_faces(
        snapshot_path,
        snapshot,
        (query_point[0], query_point[1], query_point[0], query_point[1]),
        limit=limit,
    )
    face_value = face_result.value
    candidate_count = face_value.candidate_count if face_value is not None else 0
    empty = PointInFaceBatch(query_point, candidate_count, ())
    if face_result.status is not OpStatus.SUCCESS or face_value is None:
        return OpResult(
            status=face_result.status,
            value=empty,
            decision=face_result.decision,
            exactness=face_result.exactness,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            evidence=face_result.evidence,
            assumptions=face_result.assumptions,
            diagnostics=face_result.diagnostics,
            derivation=face_result.derivation + ("point classification stopped at face-query gate",),
        )
    if not face_value.hits:
        return successful_result(
            empty,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            exactness=Exactness.GRID_SNAPPED,
            derivation=("validated face query returned no point candidates",),
        )

    face_ids = tuple(hit.face_id for hit in face_value.hits)
    connection = sqlite3.connect(Path(snapshot_path) / "snapshot.sqlite3")
    try:
        rows = list(
            connection.execute(
                "SELECT face_id,geometry_wkb FROM faces WHERE face_id IN ("
                + ",".join("?" for _ in face_ids)
                + ") ORDER BY face_id",
                face_ids,
            )
        )
    finally:
        connection.close()
    hit_by_id = {hit.face_id: hit for hit in face_value.hits}
    grid_point = snapshot.coordinate_frame.quantize([query_point])[0]
    result_hits: list[PointInFaceHit] = []
    for face_id, geometry_wkb in rows:
        geometry = shapely.from_wkb(bytes(geometry_wkb))
        outer_coordinates = shapely.get_coordinates(shapely.get_exterior_ring(geometry))[:, :2]
        outer_grid = snapshot.coordinate_frame.quantize(outer_coordinates)
        outer_relation = _grid_ring_relation(grid_point, outer_grid)
        relation = outer_relation
        if outer_relation == "inside":
            for index in range(int(shapely.get_num_interior_rings(geometry))):
                hole_coordinates = shapely.get_coordinates(
                    shapely.get_interior_ring(geometry, index)
                )[:, :2]
                hole_grid = snapshot.coordinate_frame.quantize(hole_coordinates)
                hole_relation = _grid_ring_relation(grid_point, hole_grid)
                if hole_relation == "boundary":
                    relation = "boundary"
                    break
                if hole_relation == "inside":
                    relation = "outside"
                    break
        if relation in {"inside", "boundary"}:
            result_hits.append(PointInFaceHit(hit_by_id[str(face_id)], relation))
    result_hits.sort(key=lambda item: item.face.face_id)
    evidence: list[EvidenceRef] = []
    for result_hit in result_hits:
        for occurrence_id in result_hit.face.boundary_occurrence_ids:
            try:
                geometry_row = int(snapshot.geometry.positions([occurrence_id])[0])
            except KeyError:
                continue
            evidence.append(
                EvidenceRef(
                    snapshot_id=snapshot.snapshot_id,
                    occurrence_id=occurrence_id,
                    definition_entity_id=str(snapshot.geometry.definition_ids[geometry_row]),
                )
            )
    return successful_result(
        PointInFaceBatch(query_point, candidate_count, tuple(result_hits)),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED,
        evidence=tuple(evidence),
        derivation=(
            "validated face R*Tree candidate gate",
            "int64 winding-number point-in-ring predicate for shell and holes",
        ),
    )
