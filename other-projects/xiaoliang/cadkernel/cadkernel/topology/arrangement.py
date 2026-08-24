from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely

from cadkernel._ids import digest_arrays, digest_strings, stable_id
from cadkernel._serialization import freeze_array
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    Exactness,
    OperatorSpec,
    OpResult,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot
from cadkernel.repair import EndpointTable, SnapPlan


def _text_array(values: Any) -> np.ndarray:
    array = np.asarray(values)
    if array.ndim != 1:
        raise ValueError(f"Expected a 1D text column, got shape {array.shape!r}")
    if array.dtype.kind != "U":
        items = [str(item) for item in array.tolist()]
        width = max((len(item) for item in items), default=1)
        array = np.asarray(items, dtype=f"<U{width}")
    elif not array.flags.c_contiguous:
        array = np.ascontiguousarray(array)
    array.setflags(write=False)
    return array


@dataclass(frozen=True, slots=True)
class SupportingFragment:
    source_occurrence_id: str
    source_definition_id: str
    parameter_start: float
    parameter_end: float
    follows_source_direction: bool


@dataclass(frozen=True, slots=True, eq=False)
class Arrangement:
    snapshot_id: str
    arrangement_id: str
    graph_id: str | None
    vertices_grid: np.ndarray
    edge_vertices: np.ndarray
    support_offsets: np.ndarray
    support_occurrence_ids: np.ndarray
    support_definition_ids: np.ndarray
    support_parameter_ranges: np.ndarray
    support_directions: np.ndarray
    source_geometry_rows: np.ndarray

    def __post_init__(self) -> None:
        vertices = freeze_array(self.vertices_grid, dtype=np.int64, ndim=2)
        edges = freeze_array(self.edge_vertices, dtype=np.int64, ndim=2)
        offsets = freeze_array(self.support_offsets, dtype=np.int64, ndim=1)
        occurrence_ids = _text_array(self.support_occurrence_ids)
        definition_ids = _text_array(self.support_definition_ids)
        ranges = freeze_array(self.support_parameter_ranges, dtype=np.float64, ndim=2)
        directions = freeze_array(self.support_directions, dtype=np.bool_, ndim=1)
        source_rows = freeze_array(self.source_geometry_rows, dtype=np.int64, ndim=1)
        if vertices.shape[1:] != (2,) or edges.shape[1:] != (2,):
            raise ValueError("Arrangement vertices and edges must be Nx2 arrays")
        if len(edges) and (edges.min() < 0 or edges.max() >= len(vertices)):
            raise ValueError("Arrangement edge references an unknown vertex")
        if offsets.shape != (len(edges) + 1,) or offsets[0] != 0:
            raise ValueError("Invalid supporting-fragment offsets")
        support_count = int(offsets[-1])
        if (
            len(occurrence_ids) != support_count
            or len(definition_ids) != support_count
            or ranges.shape != (support_count, 2)
            or directions.shape != (support_count,)
        ):
            raise ValueError("Supporting-fragment columns disagree")
        object.__setattr__(self, "vertices_grid", vertices)
        object.__setattr__(self, "edge_vertices", edges)
        object.__setattr__(self, "support_offsets", offsets)
        object.__setattr__(self, "support_occurrence_ids", occurrence_ids)
        object.__setattr__(self, "support_definition_ids", definition_ids)
        object.__setattr__(self, "support_parameter_ranges", ranges)
        object.__setattr__(self, "support_directions", directions)
        object.__setattr__(self, "source_geometry_rows", source_rows)

    def supporting_source_fragments(self, edge_index: int) -> tuple[SupportingFragment, ...]:
        start = int(self.support_offsets[edge_index])
        end = int(self.support_offsets[edge_index + 1])
        return tuple(
            SupportingFragment(
                source_occurrence_id=str(self.support_occurrence_ids[index]),
                source_definition_id=str(self.support_definition_ids[index]),
                parameter_start=float(self.support_parameter_ranges[index, 0]),
                parameter_end=float(self.support_parameter_ranges[index, 1]),
                follows_source_direction=bool(self.support_directions[index]),
            )
            for index in range(start, end)
        )


def _working_grid(
    snapshot: DrawingSnapshot,
    endpoints: EndpointTable | None,
    plan: SnapPlan | None,
) -> np.ndarray:
    grid = snapshot.geometry.grid_coordinates.copy()
    if endpoints is None or plan is None:
        return grid
    plan._assert_same_endpoints(endpoints)
    positions = endpoints.geometry_rows
    coordinate_indices = np.where(
        endpoints.ordinals == 0,
        snapshot.geometry.coordinate_offsets[positions],
        snapshot.geometry.coordinate_offsets[positions + 1] - 1,
    )
    grid[coordinate_indices] = plan.snapped_grid(endpoints)
    return grid


def _source_lines(
    snapshot: DrawingSnapshot,
    grid: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    geometry = snapshot.geometry
    counts = np.diff(geometry.coordinate_offsets)
    eligible = (
        geometry.topology_eligible
        & ~geometry.annotation_derived
        & (counts >= 2)
    )
    rows = np.flatnonzero(eligible)
    coordinate_owners = np.repeat(np.arange(len(geometry), dtype=np.int64), counts)
    selected_mask = eligible[coordinate_owners]
    selected_coordinates = grid[selected_mask].astype(np.float64)
    selected_owners = coordinate_owners[selected_mask]
    row_to_source = np.full(len(geometry), -1, dtype=np.int64)
    row_to_source[rows] = np.arange(len(rows), dtype=np.int64)
    line_indices = row_to_source[selected_owners]
    lines = shapely.linestrings(selected_coordinates, indices=line_indices)
    return np.asarray(lines, dtype=object), rows


@dataclass(frozen=True, slots=True)
class _NodedFragments:
    edge_segments: np.ndarray
    fragment_edge_indices: np.ndarray
    fragment_segments: np.ndarray
    fragment_canonical_directions: np.ndarray
    support_tolerance: float
    topology_stable: bool
    diagnostics: tuple[Diagnostic, ...]


def _node_integer_segments_once(segments: np.ndarray) -> np.ndarray:
    """Node canonical integer segments once and return canonical integer pieces."""

    if len(segments) == 0:
        return segments
    noded = shapely.node(
        shapely.multilinestrings(shapely.linestrings(segments.astype(np.float64)))
    )
    parts = shapely.get_parts(noded)
    coordinates, owners = shapely.get_coordinates(parts, return_index=True)
    if len(coordinates) < 2:
        return np.empty((0, 2, 2), dtype=np.int64)
    valid = owners[:-1] == owners[1:]
    starts = np.rint(coordinates[:-1][valid]).astype(np.int64)
    ends = np.rint(coordinates[1:][valid]).astype(np.int64)
    nonzero = np.any(starts != ends, axis=1)
    starts = starts[nonzero]
    ends = ends[nonzero]
    swap = (starts[:, 0] > ends[:, 0]) | (
        (starts[:, 0] == ends[:, 0]) & (starts[:, 1] > ends[:, 1])
    )
    rows = np.column_stack(
        (
            np.where(swap[:, None], ends, starts),
            np.where(swap[:, None], starts, ends),
        )
    )
    return np.unique(rows, axis=0).reshape((-1, 2, 2))


def _noded_edges(lines: np.ndarray) -> _NodedFragments:
    if len(lines) == 0:
        return _NodedFragments(
            np.empty((0, 2, 2), dtype=np.int64),
            np.empty(0, dtype=np.int64),
            np.empty((0, 2, 2), dtype=np.float64),
            np.empty(0, dtype=np.bool_),
            1e-6,
            True,
            (),
        )
    noded = shapely.node(shapely.multilinestrings(lines))
    parts = shapely.get_parts(noded)
    coordinates, owners = shapely.get_coordinates(parts, return_index=True)
    if len(coordinates) < 2:
        return _NodedFragments(
            np.empty((0, 2, 2), dtype=np.int64),
            np.empty(0, dtype=np.int64),
            np.empty((0, 2, 2), dtype=np.float64),
            np.empty(0, dtype=np.bool_),
            1e-6,
            True,
            (),
        )
    valid = owners[:-1] == owners[1:]
    starts_float = coordinates[:-1][valid]
    ends_float = coordinates[1:][valid]
    starts = np.rint(starts_float).astype(np.int64)
    ends = np.rint(ends_float).astype(np.int64)
    nonzero = np.any(starts != ends, axis=1)
    starts = starts[nonzero]
    ends = ends[nonzero]
    starts_float = starts_float[nonzero]
    ends_float = ends_float[nonzero]
    rounded = np.any(np.abs(starts_float - starts) > 1e-10) or np.any(
        np.abs(ends_float - ends) > 1e-10
    )
    swap = (starts[:, 0] > ends[:, 0]) | (
        (starts[:, 0] == ends[:, 0]) & (starts[:, 1] > ends[:, 1])
    )
    canonical_starts = np.where(swap[:, None], ends, starts)
    canonical_ends = np.where(swap[:, None], starts, ends)
    rows = np.column_stack((canonical_starts, canonical_ends))
    unique, fragment_edge_indices = np.unique(rows, axis=0, return_inverse=True)
    segments = unique.reshape((-1, 2, 2))
    diagnostics: tuple[Diagnostic, ...] = ()
    support_tolerance = 1e-6
    topology_stable = True
    if rounded:
        diagnostics = (
            Diagnostic(
                code="GEOS_INTERSECTION_GRID_ROUNDED",
                message="One or more rational GEOS intersection coordinates were snapped to the int64 grid.",
                severity=DiagnosticSeverity.INFO,
            ),
        )
        # Rounding rational intersections can create a new T/crossing or make a
        # previously distinct endpoint land in the interior of another edge.
        # A DCEL built from that unstabilized graph violates planar-embedding
        # invariants.  Re-node the canonical integer segments and use the fixed
        # point as the authoritative Arrangement.
        stabilized_segments = segments
        stabilization_passes = 0
        for stabilization_passes in range(1, 9):
            next_segments = _node_integer_segments_once(stabilized_segments)
            if np.array_equal(next_segments, stabilized_segments):
                break
            stabilized_segments = next_segments
        else:
            topology_stable = False
        if not np.array_equal(stabilized_segments, segments):
            previous_count = len(segments)
            segments = stabilized_segments
            # Final integer fragments are re-attributed to source grid lines.
            # A rounded point can be at most sqrt(.5^2 + .5^2) grid units from
            # its exact supporting line; the three-probe filter below still
            # requires both endpoints and the midpoint to agree.
            fragment_edge_indices = np.arange(len(segments), dtype=np.int64)
            starts_float = segments[:, 0].astype(np.float64)
            ends_float = segments[:, 1].astype(np.float64)
            swap = np.zeros(len(segments), dtype=np.bool_)
            support_tolerance = float(np.nextafter(np.sqrt(0.5), np.inf))
            diagnostics += (
                Diagnostic(
                    code="ARRANGEMENT_RENODED_AFTER_GRID_ROUNDING",
                    message=(
                        "Grid rounding changed planar incidence; canonical edges were "
                        f"re-noded from {previous_count} to {len(segments)} in "
                        f"{stabilization_passes} pass(es)."
                    ),
                    severity=DiagnosticSeverity.INFO,
                ),
            )
        if not topology_stable:
            diagnostics += (
                Diagnostic(
                    code="ARRANGEMENT_GRID_NODING_DID_NOT_CONVERGE",
                    message="Integer-grid noding did not reach a fixed point in eight passes.",
                    severity=DiagnosticSeverity.ERROR,
                ),
            )
    return _NodedFragments(
        edge_segments=segments,
        fragment_edge_indices=fragment_edge_indices.astype(np.int64, copy=False),
        fragment_segments=np.stack((starts_float, ends_float), axis=1),
        fragment_canonical_directions=~swap,
        support_tolerance=support_tolerance,
        topology_stable=topology_stable,
        diagnostics=diagnostics,
    )


def _can_use_direct_segments(lines: np.ndarray) -> bool:
    """True when source segments cannot gain vertices from global noding."""

    if len(lines) == 0:
        return True
    if not bool(np.all(shapely.is_simple(lines))):
        return False
    tree = shapely.STRtree(lines)
    pairs = tree.query(lines, predicate="intersects")
    if pairs.size == 0:
        return True
    # STRtree reports each geometry against itself. Any distinct source pair is
    # conservatively sent through GEOS noding, including endpoint-only contact.
    return not bool(np.any(pairs[0] < pairs[1]))


def _direct_segments_and_support(
    snapshot: DrawingSnapshot,
    source_lines: np.ndarray,
    source_rows: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Flatten already-disjoint source lines and retain exact support columns."""

    if len(source_lines) == 0:
        return (
            np.empty((0, 2, 2), dtype=np.int64),
            np.zeros(1, dtype=np.int64),
            np.asarray([], dtype="<U1"),
            np.asarray([], dtype="<U1"),
            np.empty((0, 2), dtype=np.float64),
            np.asarray([], dtype=np.bool_),
        )
    coordinates, owners = shapely.get_coordinates(source_lines, return_index=True)
    consecutive = owners[:-1] == owners[1:]
    starts = np.rint(coordinates[:-1][consecutive]).astype(np.int64)
    ends = np.rint(coordinates[1:][consecutive]).astype(np.int64)
    source_indices = owners[:-1][consecutive].astype(np.int64)
    nonzero = np.any(starts != ends, axis=1)
    starts = starts[nonzero]
    ends = ends[nonzero]
    source_indices = source_indices[nonzero]
    if not len(starts):
        return (
            np.empty((0, 2, 2), dtype=np.int64),
            np.zeros(1, dtype=np.int64),
            np.asarray([], dtype="<U1"),
            np.asarray([], dtype="<U1"),
            np.empty((0, 2), dtype=np.float64),
            np.asarray([], dtype=np.bool_),
        )
    swap = (starts[:, 0] > ends[:, 0]) | (
        (starts[:, 0] == ends[:, 0]) & (starts[:, 1] > ends[:, 1])
    )
    canonical_starts = np.where(swap[:, None], ends, starts)
    canonical_ends = np.where(swap[:, None], starts, ends)
    source_segments = np.column_stack((canonical_starts, canonical_ends))
    unique_flat, edge_indices = np.unique(source_segments, axis=0, return_inverse=True)
    edge_segments = unique_flat.reshape((-1, 2, 2))

    segment_lengths = np.linalg.norm((ends - starts).astype(np.float64), axis=1)
    total_lengths = np.bincount(
        source_indices,
        weights=segment_lengths,
        minlength=len(source_lines),
    )
    prefix = np.cumsum(segment_lengths) - segment_lengths
    first_segment = np.concatenate(
        (
            np.asarray((0,), dtype=np.int64),
            np.flatnonzero(source_indices[1:] != source_indices[:-1]) + 1,
        )
    )
    bases = np.zeros(len(source_lines), dtype=np.float64)
    bases[source_indices[first_segment]] = prefix[first_segment]
    safe_totals = np.maximum(total_lengths[source_indices], np.finfo(np.float64).tiny)
    parameter_start = (prefix - bases[source_indices]) / safe_totals
    parameter_end = (prefix + segment_lengths - bases[source_indices]) / safe_totals
    geometry_rows = source_rows[source_indices]
    occurrence_ids = snapshot.geometry.occurrence_ids[geometry_rows]
    definition_ids = snapshot.geometry.definition_ids[geometry_rows]
    order = np.lexsort(
        (
            parameter_end,
            parameter_start,
            definition_ids,
            occurrence_ids,
            edge_indices,
        )
    )
    edge_indices = edge_indices[order]
    counts = np.bincount(edge_indices, minlength=len(edge_segments))
    offsets = np.concatenate(
        (np.asarray((0,), dtype=np.int64), np.cumsum(counts, dtype=np.int64))
    )
    ranges = np.column_stack((parameter_start[order], parameter_end[order]))
    return (
        edge_segments,
        offsets,
        occurrence_ids[order],
        definition_ids[order],
        ranges,
        ~swap[order],
    )


def _support_columns(
    snapshot: DrawingSnapshot,
    source_lines: np.ndarray,
    source_rows: np.ndarray,
    edge_count: int,
    fragment_edge_indices: np.ndarray,
    fragment_segments: np.ndarray,
    fragment_canonical_directions: np.ndarray,
    attribution_tolerance: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, tuple[Diagnostic, ...]]:
    if edge_count == 0 or len(source_lines) == 0 or len(fragment_segments) == 0:
        return (
            np.zeros(edge_count + 1, dtype=np.int64),
            np.asarray([], dtype="<U1"),
            np.asarray([], dtype="<U1"),
            np.empty((0, 2), dtype=np.float64),
            np.asarray([], dtype=np.bool_),
            (),
        )
    fragment_lines = shapely.linestrings(fragment_segments)
    tree = shapely.STRtree(source_lines)
    pairs = tree.query(
        fragment_lines, predicate="dwithin", distance=attribution_tolerance
    )
    if pairs.size == 0:
        return (
            np.zeros(edge_count + 1, dtype=np.int64),
            np.asarray([], dtype="<U1"),
            np.asarray([], dtype="<U1"),
            np.empty((0, 2), dtype=np.float64),
            np.asarray([], dtype=np.bool_),
            (
                Diagnostic(
                    code="ARRANGEMENT_SUPPORT_MISSING",
                    message="No source fragments could be associated with derived edges.",
                ),
            ),
        )
    fragment_indices = pairs[0].astype(np.int64)
    source_indices = pairs[1].astype(np.int64)
    candidate_segments = fragment_segments[fragment_indices]
    starts = shapely.points(candidate_segments[:, 0])
    ends = shapely.points(candidate_segments[:, 1])
    midpoints = shapely.points(candidate_segments.mean(axis=1))
    candidate_sources = source_lines[source_indices]
    # GEOS noding can represent a rational intersection with a last-bit value
    # that makes a topological line/line intersection appear point-only. Three
    # distance probes establish that the complete straight fragment lies on the
    # source without consulting the later integer-grid rounding.
    supporting = (
        (shapely.distance(candidate_sources, starts) <= attribution_tolerance)
        & (shapely.distance(candidate_sources, ends) <= attribution_tolerance)
        & (shapely.distance(candidate_sources, midpoints) <= attribution_tolerance)
    )
    fragment_indices = fragment_indices[supporting]
    source_indices = source_indices[supporting]
    edge_indices = fragment_edge_indices[fragment_indices]
    source_geometry_rows = source_rows[source_indices]
    starts = shapely.points(fragment_segments[fragment_indices, 0])
    ends = shapely.points(fragment_segments[fragment_indices, 1])
    parameters_start = shapely.line_locate_point(
        source_lines[source_indices], starts, normalized=True
    )
    parameters_end = shapely.line_locate_point(
        source_lines[source_indices], ends, normalized=True
    )
    canonical_direction = fragment_canonical_directions[fragment_indices]
    canonical_start = np.where(
        canonical_direction, parameters_start, parameters_end
    )
    canonical_end = np.where(
        canonical_direction, parameters_end, parameters_start
    )
    occurrence_ids = snapshot.geometry.occurrence_ids[source_geometry_rows]
    definition_ids = snapshot.geometry.definition_ids[source_geometry_rows]
    order = np.lexsort(
        (
            np.maximum(parameters_start, parameters_end),
            np.minimum(parameters_start, parameters_end),
            definition_ids,
            occurrence_ids,
            edge_indices,
        )
    )
    edge_indices = edge_indices[order]
    occurrence_ids = occurrence_ids[order]
    definition_ids = definition_ids[order]
    starts_parameter = canonical_start[order]
    ends_parameter = canonical_end[order]
    counts = np.bincount(edge_indices, minlength=edge_count)
    offsets = np.concatenate(([0], np.cumsum(counts, dtype=np.int64)))
    ranges = np.column_stack(
        (np.minimum(starts_parameter, ends_parameter), np.maximum(starts_parameter, ends_parameter))
    )
    directions = starts_parameter <= ends_parameter
    unsupported_edges = np.flatnonzero(counts == 0)
    diagnostics = ()
    if len(unsupported_edges):
        diagnostics = (
            Diagnostic(
                code="ARRANGEMENT_EDGE_WITHOUT_SOURCE",
                message=f"{len(unsupported_edges)} derived edges have no supporting source fragment.",
                details=(("edge_indices", ",".join(map(str, unsupported_edges[:100]))),),
            ),
        )
    return offsets, occurrence_ids, definition_ids, ranges, directions, diagnostics


@operator_registry.operator(
    OperatorSpec("topology.build_arrangement", "1.1.0", "Noded planar arrangement with source-fragment support", "DrawingSnapshot+SnapPlan", "Arrangement", Exactness.FLOATING_CONSTRUCTION)
)
def build_arrangement(
    snapshot: DrawingSnapshot,
    *,
    endpoints: EndpointTable | None = None,
    snap_plan: SnapPlan | None = None,
) -> OpResult[Arrangement]:
    if snap_plan is not None and snap_plan.snapshot_id != snapshot.snapshot_id:
        raise ValueError("SnapPlan belongs to another snapshot")
    grid = _working_grid(snapshot, endpoints, snap_plan)
    source_lines, source_rows = _source_lines(snapshot, grid)
    direct = _can_use_direct_segments(source_lines)
    if direct:
        (
            edge_segments,
            support_offsets,
            support_occurrence_ids,
            support_definition_ids,
            support_ranges,
            support_directions,
        ) = _direct_segments_and_support(snapshot, source_lines, source_rows)
        noding_diagnostics: tuple[Diagnostic, ...] = ()
        support_diagnostics: tuple[Diagnostic, ...] = ()
    else:
        noded = _noded_edges(source_lines)
        edge_segments = noded.edge_segments
        fragment_edge_indices = noded.fragment_edge_indices
        noding_diagnostics = noded.diagnostics
    if len(edge_segments):
        vertices, inverse = np.unique(edge_segments.reshape((-1, 2)), axis=0, return_inverse=True)
        edge_vertices = inverse.reshape((-1, 2)).astype(np.int64)
        order = np.lexsort((edge_vertices[:, 1], edge_vertices[:, 0]))
        edge_vertices = edge_vertices[order]
        edge_segments = edge_segments[order]
        if not direct:
            old_to_new = np.empty(len(order), dtype=np.int64)
            old_to_new[order] = np.arange(len(order), dtype=np.int64)
            fragment_edge_indices = old_to_new[noded.fragment_edge_indices]
    else:
        vertices = np.empty((0, 2), dtype=np.int64)
        edge_vertices = np.empty((0, 2), dtype=np.int64)
    if not direct:
        (
            support_offsets,
            support_occurrence_ids,
            support_definition_ids,
            support_ranges,
            support_directions,
            support_diagnostics,
        ) = _support_columns(
            snapshot,
            source_lines,
            source_rows,
            len(edge_segments),
            fragment_edge_indices,
            noded.fragment_segments,
            noded.fragment_canonical_directions,
            noded.support_tolerance,
        )
    graph_id = snap_plan.graph_id if snap_plan is not None else None
    arrangement_id = stable_id(
        "arrangement",
        snapshot.snapshot_id,
        graph_id or "authored",
        digest_arrays(
            vertices,
            edge_vertices,
            support_offsets,
            support_ranges,
            support_directions,
            source_rows,
        ),
        digest_strings(
            value
            for pair in zip(support_occurrence_ids, support_definition_ids)
            for value in (str(pair[0]), str(pair[1]))
        ),
        length=64,
    )
    arrangement = Arrangement(
        snapshot_id=snapshot.snapshot_id,
        arrangement_id=arrangement_id,
        graph_id=graph_id,
        vertices_grid=vertices,
        edge_vertices=edge_vertices,
        support_offsets=support_offsets,
        support_occurrence_ids=support_occurrence_ids,
        support_definition_ids=support_definition_ids,
        support_parameter_ranges=support_ranges,
        support_directions=support_directions,
        source_geometry_rows=source_rows,
    )
    diagnostics = noding_diagnostics + support_diagnostics
    return successful_result(
        arrangement,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.FLOATING_CONSTRUCTION,
        decision=(
            Decision.AMBIGUOUS
            if support_diagnostics or (not direct and not noded.topology_stable)
            else Decision.COMPUTED
        ),
        diagnostics=diagnostics,
        derivation=(
            (
                "direct canonical source segments after STRtree proves no distinct-source intersections"
                if direct
                else "shapely.node over int64 grid coordinates represented exactly in float64"
            ),
            "GEOS output snapped back to the checked grid, re-noded to a fixed point, and canonically sorted",
            "STRtree bulk attribution retains every supporting source occurrence and normalized parameter range",
        ),
    )
