from __future__ import annotations

from dataclasses import dataclass, replace

import networkx as nx
import numpy as np
import shapely

from cadkernel._ids import digest_arrays, stable_id
from cadkernel._serialization import freeze_array
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    Exactness,
    OperatorSpec,
    OpResult,
    OpStatus,
    operator_registry,
)
from cadkernel.ir import DrawingSnapshot
from cadkernel.topology.arrangement import Arrangement


@dataclass(frozen=True, slots=True)
class DcelRing:
    ring_id: str
    half_edges: tuple[int, ...]
    vertex_indices: tuple[int, ...]
    signed_area_grid: float


@dataclass(frozen=True, slots=True)
class DcelFace:
    face_id: str
    outer_ring_id: str
    hole_ring_ids: tuple[str, ...]
    parent_face_id: str | None
    depth: int
    area_grid: float
    adjacent_face_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DcelValidation:
    valid: bool
    vertex_count: int
    edge_count: int
    face_count_including_unbounded: int
    connected_component_count: int
    euler_left: int
    euler_right: int
    twin_complete: bool
    next_complete: bool
    face_assignment_consistent: bool
    face_geometry_valid: bool
    invalid_face_count: int
    area_consistent: bool
    dcel_area_grid: float
    polygonized_area_grid: float
    diagnostics: tuple[str, ...]


@dataclass(frozen=True, slots=True, eq=False)
class Dcel:
    snapshot_id: str
    dcel_id: str
    arrangement_id: str
    vertices_grid: np.ndarray
    half_edge_origins: np.ndarray
    half_edge_destinations: np.ndarray
    half_edge_twins: np.ndarray
    half_edge_next: np.ndarray
    half_edge_edges: np.ndarray
    half_edge_faces: np.ndarray
    rings: tuple[DcelRing, ...]
    faces: tuple[DcelFace, ...]
    unbounded_ring_ids: tuple[str, ...]
    validation: DcelValidation

    def __post_init__(self) -> None:
        vertices = freeze_array(self.vertices_grid, dtype=np.int64, ndim=2)
        arrays = {
            name: freeze_array(getattr(self, name), dtype=np.int64, ndim=1)
            for name in (
                "half_edge_origins",
                "half_edge_destinations",
                "half_edge_twins",
                "half_edge_next",
                "half_edge_edges",
                "half_edge_faces",
            )
        }
        half_edge_count = len(arrays["half_edge_origins"])
        if any(len(array) != half_edge_count for array in arrays.values()):
            raise ValueError("DCEL half-edge columns disagree")
        object.__setattr__(self, "vertices_grid", vertices)
        for name, array in arrays.items():
            object.__setattr__(self, name, array)


def _half_edges(arrangement: Arrangement) -> tuple[np.ndarray, ...]:
    edges = arrangement.edge_vertices
    edge_count = len(edges)
    origins = np.concatenate((edges[:, 0], edges[:, 1])).astype(np.int64)
    destinations = np.concatenate((edges[:, 1], edges[:, 0])).astype(np.int64)
    twins = np.concatenate(
        (np.arange(edge_count, edge_count * 2), np.arange(edge_count))
    ).astype(np.int64)
    edge_indices = np.concatenate((np.arange(edge_count), np.arange(edge_count))).astype(np.int64)
    if edge_count == 0:
        return origins, destinations, twins, np.empty(0, np.int64), edge_indices
    directions = arrangement.vertices_grid[destinations] - arrangement.vertices_grid[origins]
    angles = np.arctan2(directions[:, 1], directions[:, 0])
    order = np.lexsort((destinations, angles, origins))
    sorted_origins = origins[order]
    positions = np.empty(len(order), dtype=np.int64)
    positions[order] = np.arange(len(order), dtype=np.int64)
    vertex_count = len(arrangement.vertices_grid)
    group_starts = np.searchsorted(sorted_origins, np.arange(vertex_count), side="left")
    group_ends = np.searchsorted(sorted_origins, np.arange(vertex_count), side="right")
    next_edges = np.empty(len(origins), dtype=np.int64)
    twin_positions = positions[twins]
    destination_starts = group_starts[destinations]
    destination_counts = group_ends[destinations] - destination_starts
    local_positions = twin_positions - destination_starts
    previous_positions = destination_starts + (local_positions - 1) % destination_counts
    next_edges[:] = order[previous_positions]
    return origins, destinations, twins, next_edges, edge_indices


def _walk_rings(
    arrangement: Arrangement,
    next_edges: np.ndarray,
    origins: np.ndarray,
) -> tuple[tuple[DcelRing, ...], np.ndarray]:
    visited = np.zeros(len(origins), dtype=np.bool_)
    ring_by_half_edge = np.full(len(origins), -1, dtype=np.int64)
    rings: list[DcelRing] = []
    if len(origins):
        vertex_degrees = np.bincount(origins, minlength=len(arrangement.vertices_grid))
        destinations = origins[next_edges]
        isolated = (vertex_degrees[origins] == 1) & (vertex_degrees[destinations] == 1)
        # An isolated undirected edge produces a two-half-edge zero-area walk.
        # Marking it here is equivalent to the generic walk and avoids allocating
        # a list, set, tuple, and np.roll for every disconnected source segment.
        visited[isolated] = True
    for first in range(len(origins)):
        if visited[first]:
            continue
        cycle: list[int] = []
        current = first
        local_seen: set[int] = set()
        while current not in local_seen and not visited[current]:
            local_seen.add(current)
            cycle.append(current)
            current = int(next_edges[current])
        if current != first:
            # Invalid next topology is preserved as a zero-area diagnostic ring.
            vertex_indices = tuple(int(origins[item]) for item in cycle)
            area = 0.0
        else:
            vertex_indices = tuple(int(origins[item]) for item in cycle)
            coordinates = arrangement.vertices_grid[np.asarray(vertex_indices, dtype=np.int64)]
            shifted = np.roll(coordinates, -1, axis=0)
            area = float(
                np.sum(coordinates[:, 0] * shifted[:, 1] - coordinates[:, 1] * shifted[:, 0])
                / 2.0
            )
        for half_edge in cycle:
            visited[half_edge] = True
        if len(vertex_indices) >= 3 and area != 0.0:
            ring_id = stable_id("dcel-ring", arrangement.arrangement_id, vertex_indices, area, length=64)
            ring_index = len(rings)
            rings.append(DcelRing(ring_id, tuple(cycle), vertex_indices, area))
            for half_edge in cycle:
                ring_by_half_edge[half_edge] = ring_index
    return tuple(rings), ring_by_half_edge


def _ring_polygon(arrangement: Arrangement, ring: DcelRing) -> shapely.Polygon | None:
    if len(ring.vertex_indices) < 3 or ring.signed_area_grid == 0:
        return None
    coordinates = arrangement.vertices_grid[np.asarray(ring.vertex_indices, dtype=np.int64)]
    polygon = shapely.Polygon(coordinates)
    expected_area = abs(ring.signed_area_grid)
    if (
        not polygon.is_empty
        and bool(shapely.is_valid(polygon))
        and polygon.area > 0
        and math_isclose(float(polygon.area), expected_area)
    ):
        return shapely.normalize(polygon)
    # A valid DCEL face walk may traverse a dangling spike out and back.  Such
    # a walk is not a valid Polygon coordinate ring even though its bounded
    # surface is unambiguous.  Polygonizing the ring's own edge multiset removes
    # only those zero-area excursions; multiple surfaces remain ambiguous.
    segments = np.stack((coordinates, np.roll(coordinates, -1, axis=0)), axis=1)
    parts = shapely.get_parts(shapely.polygonize(shapely.linestrings(segments)))
    if len(parts) != 1:
        return None
    normalized = shapely.normalize(parts[0])
    if (
        shapely.get_type_id(normalized) != 3
        or not bool(shapely.is_valid(normalized))
        or not math_isclose(float(normalized.area), expected_area)
    ):
        return None
    return normalized


def _face_polygon_from_rings(
    arrangement: Arrangement,
    ring_by_id: dict[str, DcelRing],
    face: DcelFace,
) -> shapely.Polygon | None:
    outer = _ring_polygon(arrangement, ring_by_id[face.outer_ring_id])
    if outer is None:
        return None
    holes: list[np.ndarray] = []
    for ring_id in face.hole_ring_ids:
        hole = _ring_polygon(arrangement, ring_by_id[ring_id])
        if hole is None:
            return None
        holes.append(shapely.get_coordinates(shapely.get_exterior_ring(hole)))
    polygon = shapely.Polygon(
        shapely.get_coordinates(shapely.get_exterior_ring(outer)),
        holes=holes,
    )
    if (
        polygon.is_empty
        or not bool(shapely.is_valid(polygon))
        or not math_isclose(float(polygon.area), face.area_grid)
    ):
        return None
    return shapely.normalize(polygon)


def face_polygon(
    arrangement: Arrangement,
    dcel: Dcel,
    face: DcelFace,
) -> shapely.Polygon | None:
    """Materialize a validated grid-space polygon for a DCEL face."""

    return _face_polygon_from_rings(
        arrangement,
        {ring.ring_id: ring for ring in dcel.rings},
        face,
    )


def _build_faces(
    arrangement: Arrangement,
    raw_rings: tuple[DcelRing, ...],
    origins: np.ndarray,
    destinations: np.ndarray,
    twins: np.ndarray,
) -> tuple[tuple[DcelRing, ...], tuple[DcelFace, ...], tuple[str, ...], np.ndarray]:
    if len(arrangement.edge_vertices):
        lines = shapely.linestrings(
            arrangement.vertices_grid[arrangement.edge_vertices].astype(np.float64)
        )
        polygon_array = shapely.get_parts(shapely.polygonize(lines))
    else:
        polygon_array = np.asarray([], dtype=object)
    polygons = [shapely.orient_polygons(polygon, exterior_cw=False) for polygon in polygon_array]
    polygons.sort(
        key=lambda polygon: bytes(
            shapely.to_wkb(polygon, byte_order=1, include_srid=False)
        )
    )

    vertex_lookup = {
        (int(coordinate[0]), int(coordinate[1])): index
        for index, coordinate in enumerate(arrangement.vertices_grid)
    }
    directed_half_edges = {
        (int(origin), int(destination)): index
        for index, (origin, destination) in enumerate(zip(origins, destinations))
    }

    def materialize_ring(linear_ring: object) -> DcelRing | None:
        coordinates = shapely.get_coordinates(linear_ring)
        if len(coordinates) < 4 or not np.allclose(
            coordinates, np.rint(coordinates), rtol=0.0, atol=1e-9
        ):
            return None
        grid = np.rint(coordinates[:-1]).astype(np.int64)
        try:
            vertices = tuple(vertex_lookup[(int(point[0]), int(point[1]))] for point in grid)
            half_edges = tuple(
                directed_half_edges[(vertices[index], vertices[(index + 1) % len(vertices)])]
                for index in range(len(vertices))
            )
        except KeyError:
            return None
        shifted = np.roll(grid, -1, axis=0)
        area = float(
            np.sum(grid[:, 0] * shifted[:, 1] - grid[:, 1] * shifted[:, 0]) / 2.0
        )
        if area == 0.0:
            return None
        ring_id = stable_id(
            "dcel-ring",
            arrangement.arrangement_id,
            vertices,
            area,
            length=64,
        )
        return DcelRing(ring_id, half_edges, vertices, area)

    entries: list[tuple[object, object, DcelRing, tuple[DcelRing, ...], str]] = []
    ring_by_id: dict[str, DcelRing] = {}
    for polygon in polygons:
        outer = materialize_ring(shapely.get_exterior_ring(polygon))
        holes = tuple(
            materialize_ring(shapely.get_interior_ring(polygon, index))
            for index in range(int(shapely.get_num_interior_rings(polygon)))
        )
        if outer is None or any(hole is None for hole in holes):
            continue
        typed_holes = tuple(hole for hole in holes if hole is not None)
        ring_by_id[outer.ring_id] = outer
        for hole in typed_holes:
            ring_by_id[hole.ring_id] = hole
        face_id = stable_id(
            "dcel-face",
            arrangement.arrangement_id,
            outer.ring_id,
            tuple(hole.ring_id for hole in typed_holes),
            length=64,
        )
        shell = shapely.Polygon(shapely.get_coordinates(shapely.get_exterior_ring(polygon)))
        entries.append((polygon, shell, outer, typed_holes, face_id))

    shells = [entry[1] for entry in entries]
    shell_tree = shapely.STRtree(shells) if shells else None
    parents: dict[int, int | None] = {index: None for index in range(len(entries))}
    for index, (_, shell, _, _, _) in enumerate(entries):
        point = shell.representative_point()
        candidates = shell_tree.query(point, predicate="within") if shell_tree is not None else []
        enclosing = [
            int(candidate)
            for candidate in candidates
            if int(candidate) != index
            and float(shells[int(candidate)].area) > float(shell.area) + 1e-9
        ]
        if enclosing:
            parents[index] = min(enclosing, key=lambda item: float(shells[item].area))

    depth_cache: dict[int, int] = {}

    def depth(index: int) -> int:
        if index not in depth_cache:
            parent = parents[index]
            depth_cache[index] = 0 if parent is None else depth(parent) + 1
        return depth_cache[index]

    faces = [
        DcelFace(
            face_id=entry[4],
            outer_ring_id=entry[2].ring_id,
            hole_ring_ids=tuple(ring.ring_id for ring in entry[3]),
            parent_face_id=entries[parents[index]][4] if parents[index] is not None else None,
            depth=depth(index),
            area_grid=float(entry[0].area),
        )
        for index, entry in enumerate(entries)
    ]
    faces.sort(key=lambda face: face.face_id)
    face_position = {face.face_id: index for index, face in enumerate(faces)}
    half_edge_faces = np.full(len(origins), -1, dtype=np.int64)
    for _, _, outer, holes, face_id in entries:
        position = face_position[face_id]
        for ring in (outer, *holes):
            for half_edge in ring.half_edges:
                if half_edge_faces[half_edge] not in (-1, position):
                    half_edge_faces[half_edge] = -2
                else:
                    half_edge_faces[half_edge] = position

    adjacency: dict[int, set[int]] = {index: set() for index in range(len(faces))}
    for half_edge in range(len(twins)):
        left = int(half_edge_faces[half_edge])
        right = int(half_edge_faces[int(twins[half_edge])])
        if left >= 0 and right >= 0 and left != right:
            adjacency[left].add(right)
            adjacency[right].add(left)
    faces = [
        replace(
            face,
            adjacent_face_ids=tuple(faces[index].face_id for index in sorted(adjacency[position])),
        )
        for position, face in enumerate(faces)
    ]
    unbounded: list[str] = []
    for ring in raw_rings:
        if ring.signed_area_grid < 0 and all(
            half_edge_faces[half_edge] == -1 for half_edge in ring.half_edges
        ):
            ring_by_id.setdefault(ring.ring_id, ring)
            unbounded.append(ring.ring_id)
    return (
        tuple(ring_by_id[key] for key in sorted(ring_by_id)),
        tuple(faces),
        tuple(sorted(unbounded)),
        half_edge_faces,
    )


def _polygonized_area(arrangement: Arrangement) -> float:
    if len(arrangement.edge_vertices) == 0:
        return 0.0
    segments = arrangement.vertices_grid[arrangement.edge_vertices].astype(np.float64)
    lines = shapely.linestrings(segments)
    polygons = shapely.get_parts(shapely.polygonize(lines))
    return float(shapely.area(polygons).sum()) if len(polygons) else 0.0


def validate_dcel(
    arrangement: Arrangement,
    origins: np.ndarray,
    destinations: np.ndarray,
    twins: np.ndarray,
    next_edges: np.ndarray,
    rings: tuple[DcelRing, ...],
    faces: tuple[DcelFace, ...],
    half_edge_faces: np.ndarray,
) -> DcelValidation:
    vertex_count = len(arrangement.vertices_grid)
    edge_count = len(arrangement.edge_vertices)
    if vertex_count:
        vertex_degrees = np.bincount(
            arrangement.edge_vertices.reshape(-1), minlength=vertex_count
        )
        if bool(np.all(vertex_degrees == 1)):
            components = edge_count
        else:
            graph = nx.Graph()
            graph.add_nodes_from(range(vertex_count))
            graph.add_edges_from(
                (int(left), int(right)) for left, right in arrangement.edge_vertices
            )
            components = nx.number_connected_components(graph)
    else:
        components = 0
    face_count = len(faces) + 1
    euler_left = vertex_count - edge_count + face_count
    euler_right = 1 + components
    half_edge_indices = np.arange(len(origins), dtype=np.int64)
    twin_complete = bool(
        len(twins) == len(origins)
        and np.all((twins >= 0) & (twins < len(origins)))
        and np.array_equal(twins[twins], half_edge_indices)
        and np.array_equal(origins, destinations[twins])
        and np.array_equal(destinations, origins[twins])
    )
    next_complete = bool(
        len(next_edges) == len(origins)
        and np.all((next_edges >= 0) & (next_edges < len(origins)))
        and np.array_equal(destinations, origins[next_edges])
        and np.array_equal(np.sort(next_edges), half_edge_indices)
    )
    ring_by_id = {ring.ring_id: ring for ring in rings}
    face_assignment_consistent = not bool(np.any(half_edge_faces < -1))
    if face_assignment_consistent:
        for face_index, face in enumerate(faces):
            for ring_id in (face.outer_ring_id, *face.hole_ring_ids):
                ring = ring_by_id[ring_id]
                if any(half_edge_faces[half_edge] != face_index for half_edge in ring.half_edges):
                    face_assignment_consistent = False
                    break
            if not face_assignment_consistent:
                break
    invalid_face_ids = tuple(
        face.face_id
        for face in faces
        if _face_polygon_from_rings(arrangement, ring_by_id, face) is None
    )
    face_geometry_valid = not invalid_face_ids
    dcel_area = float(sum(face.area_grid for face in faces))
    cycle_rank = edge_count - vertex_count + components
    polygonized_area = 0.0 if cycle_rank == 0 else _polygonized_area(arrangement)
    area_consistent = math_isclose(dcel_area, polygonized_area)
    diagnostics: list[str] = []
    if euler_left != euler_right:
        diagnostics.append(f"Euler mismatch: {euler_left} != {euler_right}")
    if not twin_complete:
        diagnostics.append("Twin half-edge pairing is incomplete")
    if not next_complete:
        diagnostics.append("Half-edge next relation is incomplete")
    if not face_assignment_consistent:
        diagnostics.append("One or more bounded-face half-edges have conflicting ownership")
    if not face_geometry_valid:
        diagnostics.append(
            f"{len(invalid_face_ids)} face geometries are invalid or disagree with their assigned rings: "
            + ",".join(invalid_face_ids[:20])
        )
    if not area_consistent:
        diagnostics.append(f"Area mismatch: DCEL={dcel_area:g}, polygonize={polygonized_area:g}")
    valid = (
        euler_left == euler_right
        and twin_complete
        and next_complete
        and face_assignment_consistent
        and face_geometry_valid
        and area_consistent
    )
    return DcelValidation(
        valid=valid,
        vertex_count=vertex_count,
        edge_count=edge_count,
        face_count_including_unbounded=face_count,
        connected_component_count=components,
        euler_left=euler_left,
        euler_right=euler_right,
        twin_complete=twin_complete,
        next_complete=next_complete,
        face_assignment_consistent=face_assignment_consistent,
        face_geometry_valid=face_geometry_valid,
        invalid_face_count=len(invalid_face_ids),
        area_consistent=area_consistent,
        dcel_area_grid=dcel_area,
        polygonized_area_grid=polygonized_area,
        diagnostics=tuple(diagnostics),
    )


def math_isclose(left: float, right: float) -> bool:
    tolerance = max(1e-8, 1e-10 * max(abs(left), abs(right), 1.0))
    return abs(left - right) <= tolerance


@operator_registry.operator(
    OperatorSpec("topology.build_dcel", "1.1.0", "Half-edge/DCEL construction with face-level validation", "DrawingSnapshot+Arrangement", "Dcel", Exactness.FLOATING_CONSTRUCTION)
)
def build_dcel(snapshot: DrawingSnapshot, arrangement: Arrangement) -> OpResult[Dcel]:
    if arrangement.snapshot_id != snapshot.snapshot_id:
        raise ValueError("Arrangement belongs to another snapshot")
    origins, destinations, twins, next_edges, edge_indices = _half_edges(arrangement)
    raw_rings, _ = _walk_rings(arrangement, next_edges, origins)
    rings, faces, unbounded, half_edge_faces = _build_faces(
        arrangement, raw_rings, origins, destinations, twins
    )
    validation = validate_dcel(
        arrangement,
        origins,
        destinations,
        twins,
        next_edges,
        rings,
        faces,
        half_edge_faces,
    )
    dcel_id = stable_id(
        "dcel",
        arrangement.arrangement_id,
        digest_arrays(origins, next_edges),
        tuple(face.face_id for face in faces),
        length=64,
    )
    dcel = Dcel(
        snapshot_id=snapshot.snapshot_id,
        dcel_id=dcel_id,
        arrangement_id=arrangement.arrangement_id,
        vertices_grid=arrangement.vertices_grid,
        half_edge_origins=origins,
        half_edge_destinations=destinations,
        half_edge_twins=twins,
        half_edge_next=next_edges,
        half_edge_edges=edge_indices,
        half_edge_faces=half_edge_faces,
        rings=rings,
        faces=faces,
        unbounded_ring_ids=unbounded,
        validation=validation,
    )
    diagnostics = tuple(
        Diagnostic(
            code="DCEL_VALIDATION_FAILED",
            message=message,
            severity=DiagnosticSeverity.ERROR,
        )
        for message in validation.diagnostics
    )
    return OpResult(
        status=OpStatus.SUCCESS if validation.valid else OpStatus.AMBIGUOUS,
        value=dcel,
        decision=Decision.COMPUTED if validation.valid else Decision.AMBIGUOUS,
        exactness=Exactness.FLOATING_CONSTRUCTION,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        diagnostics=diagnostics,
        derivation=(
            "two half-edges per canonical arrangement edge",
            "grouped numpy angle sort and clockwise successor around destination vertex",
            "polygonized elementary surfaces are mapped back to directed half-edge rings",
            "shell containment builds parent/depth and directed twins establish face adjacency",
            "Euler, twin, next, face geometry, and polygonized-area validation gates conclusions",
        ),
    )
