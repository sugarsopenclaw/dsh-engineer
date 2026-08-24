from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from cadkernel._ids import stable_id
from cadkernel._serialization import freeze_array
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    Exactness,
    OperatorSpec,
    OpResult,
    ToleranceProfile,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot, GeometryKind


def _text_array(values: Any) -> np.ndarray:
    """Return an immutable one-dimensional Unicode array without Pythonizing arrays."""

    array = np.asarray(values)
    if array.ndim != 1:
        raise ValueError(f"Expected a 1D text column, got shape {array.shape!r}")
    if array.dtype.kind == "U":
        return freeze_array(array, ndim=1)
    if array.dtype.kind == "S":
        return freeze_array(array.astype("U"), ndim=1)
    items = [str(item) for item in array.tolist()]
    width = max((len(item) for item in items), default=1)
    return freeze_array(items, dtype=f"<U{width}", ndim=1)


@dataclass(frozen=True, slots=True, eq=False)
class EndpointTable:
    endpoint_ids: np.ndarray
    occurrence_ids: np.ndarray
    definition_ids: np.ndarray
    geometry_rows: np.ndarray
    ordinals: np.ndarray
    coordinates: np.ndarray
    grid_coordinates: np.ndarray
    source_priority: np.ndarray

    def __post_init__(self) -> None:
        endpoint_ids = _text_array(self.endpoint_ids)
        occurrence_ids = _text_array(self.occurrence_ids)
        definition_ids = _text_array(self.definition_ids)
        geometry_rows = freeze_array(self.geometry_rows, dtype=np.int64, ndim=1)
        ordinals = freeze_array(self.ordinals, dtype=np.int8, ndim=1)
        coordinates = freeze_array(self.coordinates, dtype=np.float64, ndim=2)
        grid_coordinates = freeze_array(self.grid_coordinates, dtype=np.int64, ndim=2)
        priority = freeze_array(self.source_priority, dtype=np.bool_, ndim=1)
        count = len(endpoint_ids)
        if (
            len(occurrence_ids) != count
            or len(definition_ids) != count
            or geometry_rows.shape != (count,)
        ):
            raise ValueError("Endpoint identity columns disagree")
        if ordinals.shape != (count,) or priority.shape != (count,):
            raise ValueError("Endpoint scalar columns disagree")
        if coordinates.shape != (count, 2) or grid_coordinates.shape != (count, 2):
            raise ValueError("Endpoint coordinates must have shape (N, 2)")
        if count and np.any(endpoint_ids[1:] < endpoint_ids[:-1]):
            raise ValueError("EndpointTable must be ordered by stable endpoint id")
        object.__setattr__(self, "endpoint_ids", endpoint_ids)
        object.__setattr__(self, "occurrence_ids", occurrence_ids)
        object.__setattr__(self, "definition_ids", definition_ids)
        object.__setattr__(self, "geometry_rows", geometry_rows)
        object.__setattr__(self, "ordinals", ordinals)
        object.__setattr__(self, "coordinates", coordinates)
        object.__setattr__(self, "grid_coordinates", grid_coordinates)
        object.__setattr__(self, "source_priority", priority)

    def __len__(self) -> int:
        return len(self.endpoint_ids)


@dataclass(frozen=True, slots=True)
class SnapMove:
    endpoint_id: str
    occurrence_id: str
    original_point: tuple[float, float]
    representative_point: tuple[float, float]
    displacement: float


@dataclass(frozen=True, slots=True)
class SnapCluster:
    cluster_id: str
    representative_endpoint_id: str
    representative_grid_point: tuple[int, int]
    member_endpoint_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SnapConflict:
    cluster_id: str
    code: str
    message: str
    member_endpoint_ids: tuple[str, ...]
    max_displacement: float


@dataclass(frozen=True, slots=True, eq=False)
class EndpointView:
    endpoint_ids: np.ndarray
    coordinates: np.ndarray
    grid_coordinates: np.ndarray
    view_kind: str

    def __post_init__(self) -> None:
        ids = _text_array(self.endpoint_ids)
        coordinates = freeze_array(self.coordinates, dtype=np.float64, ndim=2)
        grid = freeze_array(self.grid_coordinates, dtype=np.int64, ndim=2)
        if coordinates.shape != (len(ids), 2) or grid.shape != (len(ids), 2):
            raise ValueError("EndpointView columns disagree")
        object.__setattr__(self, "endpoint_ids", ids)
        object.__setattr__(self, "coordinates", coordinates)
        object.__setattr__(self, "grid_coordinates", grid)


@dataclass(frozen=True, slots=True, eq=False)
class SnapPlan:
    """Explicit, immutable repair proposal backed by compact columnar arrays.

    ``clusters`` and ``moves`` remain available as materialized compatibility
    views. Core topology code consumes integer columns directly so a large
    drawing does not allocate millions of tiny Python objects.
    """

    snapshot_id: str
    tolerance_profile_id: str
    graph_id: str
    endpoints: EndpointTable = field(repr=False, compare=False)
    cluster_anchor_endpoint_indices: np.ndarray = field(repr=False, compare=False)
    representative_endpoint_indices: np.ndarray = field(repr=False, compare=False)
    representative_grid_points: np.ndarray = field(repr=False, compare=False)
    representative_points: np.ndarray = field(repr=False, compare=False)
    member_offsets: np.ndarray = field(repr=False, compare=False)
    member_endpoint_indices: np.ndarray = field(repr=False, compare=False)
    cluster_indices_by_endpoint: np.ndarray = field(repr=False, compare=False)
    displacements: np.ndarray = field(repr=False, compare=False)
    conflicts: tuple[SnapConflict, ...]

    def __post_init__(self) -> None:
        anchors = freeze_array(
            self.cluster_anchor_endpoint_indices, dtype=np.int64, ndim=1
        )
        representatives = freeze_array(
            self.representative_endpoint_indices, dtype=np.int64, ndim=1
        )
        representative_grid = freeze_array(
            self.representative_grid_points, dtype=np.int64, ndim=2
        )
        representative_points = freeze_array(
            self.representative_points, dtype=np.float64, ndim=2
        )
        offsets = freeze_array(self.member_offsets, dtype=np.int64, ndim=1)
        member_indices = freeze_array(
            self.member_endpoint_indices, dtype=np.int64, ndim=1
        )
        cluster_indices = freeze_array(
            self.cluster_indices_by_endpoint, dtype=np.int32, ndim=1
        )
        displacements = freeze_array(self.displacements, dtype=np.float64, ndim=1)
        cluster_count = len(anchors)
        endpoint_count = len(self.endpoints)
        if len(representatives) != cluster_count:
            raise ValueError("SnapPlan representative columns disagree")
        if representative_grid.shape != (cluster_count, 2):
            raise ValueError("SnapPlan representative grid must have shape (C, 2)")
        if representative_points.shape != (cluster_count, 2):
            raise ValueError("SnapPlan representative points must have shape (C, 2)")
        if offsets.shape != (cluster_count + 1,) or offsets[0] != 0:
            raise ValueError("Invalid SnapPlan member offsets")
        if int(offsets[-1]) != endpoint_count or len(member_indices) != endpoint_count:
            raise ValueError("SnapPlan must assign every endpoint exactly once")
        if cluster_indices.shape != (endpoint_count,) or displacements.shape != (endpoint_count,):
            raise ValueError("SnapPlan endpoint columns disagree")
        if endpoint_count:
            if (
                anchors.min() < 0
                or anchors.max() >= endpoint_count
                or representatives.min() < 0
                or representatives.max() >= endpoint_count
                or member_indices.min() < 0
                or member_indices.max() >= endpoint_count
                or cluster_indices.min() < 0
                or cluster_indices.max() >= cluster_count
            ):
                raise ValueError("SnapPlan contains an out-of-range endpoint or cluster index")
            if len(np.unique(member_indices)) != endpoint_count:
                raise ValueError("SnapPlan member indices must be a permutation")
        object.__setattr__(self, "cluster_anchor_endpoint_indices", anchors)
        object.__setattr__(self, "representative_endpoint_indices", representatives)
        object.__setattr__(self, "representative_grid_points", representative_grid)
        object.__setattr__(self, "representative_points", representative_points)
        object.__setattr__(self, "member_offsets", offsets)
        object.__setattr__(self, "member_endpoint_indices", member_indices)
        object.__setattr__(self, "cluster_indices_by_endpoint", cluster_indices)
        object.__setattr__(self, "displacements", displacements)

    @property
    def cluster_count(self) -> int:
        return len(self.cluster_anchor_endpoint_indices)

    @property
    def move_count(self) -> int:
        return len(self.endpoints)

    @property
    def cluster_ids(self) -> np.ndarray:
        """Stable cluster IDs: the lexicographically least member endpoint ID."""

        values = self.endpoints.endpoint_ids[self.cluster_anchor_endpoint_indices]
        values.setflags(write=False)
        return values

    @property
    def representative_endpoint_ids(self) -> np.ndarray:
        values = self.endpoints.endpoint_ids[self.representative_endpoint_indices]
        values.setflags(write=False)
        return values

    @property
    def affected_occurrence_ids(self) -> tuple[str, ...]:
        values = np.unique(self.endpoints.occurrence_ids[self.displacements > 0.0])
        return tuple(str(value) for value in values)

    @property
    def clusters(self) -> tuple[SnapCluster, ...]:
        cluster_ids = self.cluster_ids
        representative_ids = self.representative_endpoint_ids
        result: list[SnapCluster] = []
        for cluster_index in range(self.cluster_count):
            start = int(self.member_offsets[cluster_index])
            end = int(self.member_offsets[cluster_index + 1])
            members = self.member_endpoint_indices[start:end]
            point = self.representative_grid_points[cluster_index]
            result.append(
                SnapCluster(
                    cluster_id=str(cluster_ids[cluster_index]),
                    representative_endpoint_id=str(representative_ids[cluster_index]),
                    representative_grid_point=(int(point[0]), int(point[1])),
                    member_endpoint_ids=tuple(
                        str(value) for value in self.endpoints.endpoint_ids[members]
                    ),
                )
            )
        return tuple(result)

    @property
    def moves(self) -> tuple[SnapMove, ...]:
        representative = self.representative_points[self.cluster_indices_by_endpoint]
        return tuple(
            SnapMove(
                endpoint_id=str(self.endpoints.endpoint_ids[index]),
                occurrence_id=str(self.endpoints.occurrence_ids[index]),
                original_point=tuple(float(value) for value in self.endpoints.coordinates[index]),
                representative_point=tuple(float(value) for value in representative[index]),
                displacement=float(self.displacements[index]),
            )
            for index in range(self.move_count)
        )

    def original_view(self, endpoints: EndpointTable | None = None) -> EndpointView:
        table = endpoints or self.endpoints
        self._assert_same_endpoints(table)
        return EndpointView(
            table.endpoint_ids,
            table.coordinates,
            table.grid_coordinates,
            "original",
        )

    def snapped_grid(self, endpoints: EndpointTable | None = None) -> np.ndarray:
        table = endpoints or self.endpoints
        self._assert_same_endpoints(table)
        grid = self.representative_grid_points[self.cluster_indices_by_endpoint]
        grid.setflags(write=False)
        return grid

    def snapped_view(
        self,
        endpoints: EndpointTable,
        snapshot: DrawingSnapshot,
    ) -> EndpointView:
        grid = self.snapped_grid(endpoints)
        coordinates = snapshot.coordinate_frame.dequantize(grid)
        return EndpointView(endpoints.endpoint_ids, coordinates, grid, "snapped")

    def _assert_same_endpoints(self, endpoints: EndpointTable) -> None:
        if len(endpoints) != len(self.endpoints) or not np.array_equal(
            endpoints.endpoint_ids, self.endpoints.endpoint_ids
        ):
            raise ValueError("EndpointTable does not belong to this SnapPlan")


def extract_endpoints(snapshot: DrawingSnapshot, *, include_points: bool = True) -> EndpointTable:
    """Extract source endpoints as sorted columns without per-endpoint hashing."""

    geometry = snapshot.geometry
    non_point = geometry.kinds != int(GeometryKind.POINT)
    topology_rows = np.flatnonzero(
        geometry.topology_eligible & ~geometry.annotation_derived & non_point
    )
    point_rows = (
        np.flatnonzero(
            (geometry.kinds == int(GeometryKind.POINT))
            & ~geometry.annotation_derived
        )
        if include_points
        else np.empty(0, dtype=np.int64)
    )

    rows = np.repeat(topology_rows, 2)
    ordinals = np.tile(np.asarray((0, 1), dtype=np.int8), len(topology_rows))
    coordinate_indices = np.empty(len(rows), dtype=np.int64)
    if len(topology_rows):
        coordinate_indices[0::2] = geometry.coordinate_offsets[topology_rows]
        coordinate_indices[1::2] = geometry.coordinate_offsets[topology_rows + 1] - 1
    if len(point_rows):
        rows = np.concatenate((rows, point_rows))
        ordinals = np.concatenate((ordinals, np.zeros(len(point_rows), dtype=np.int8)))
        coordinate_indices = np.concatenate(
            (coordinate_indices, geometry.coordinate_offsets[point_rows])
        )

    occurrence_ids = geometry.occurrence_ids[rows]
    definition_ids = geometry.definition_ids[rows]
    suffixes = np.where(ordinals == 0, ":0", ":1")
    endpoint_ids = np.char.add(occurrence_ids, suffixes)
    if len(endpoint_ids):
        order = np.argsort(endpoint_ids, kind="stable")
    else:
        order = np.empty(0, dtype=np.int64)
    return EndpointTable(
        endpoint_ids=endpoint_ids[order],
        occurrence_ids=occurrence_ids[order],
        definition_ids=definition_ids[order],
        geometry_rows=rows[order],
        ordinals=ordinals[order],
        coordinates=geometry.coordinates[coordinate_indices[order], :2],
        grid_coordinates=geometry.grid_coordinates[coordinate_indices[order]],
        source_priority=np.ones(len(order), dtype=np.bool_),
    )


class _DisjointSet:
    def __init__(self, size: int) -> None:
        self.parents = np.arange(size, dtype=np.int64)
        self.union_count = 0

    def find(self, item: int) -> int:
        parent = int(self.parents[item])
        while parent != item:
            grandparent = int(self.parents[parent])
            self.parents[item] = grandparent
            item, parent = parent, grandparent
        return item

    def union(self, left: int, right: int) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left == root_right:
            return
        if root_left < root_right:
            self.parents[root_right] = root_left
        else:
            self.parents[root_left] = root_right
        self.union_count += 1

    def roots(self) -> np.ndarray:
        if self.union_count == 0:
            return self.parents.copy()
        while True:
            compressed = self.parents[self.parents]
            if np.array_equal(compressed, self.parents):
                break
            self.parents[:] = compressed
        return self.parents.copy()


_CELL_KEY_DTYPE = np.dtype([("x", np.int64), ("y", np.int64)])


def _cell_keys(values: np.ndarray) -> np.ndarray:
    contiguous = np.ascontiguousarray(values, dtype=np.int64)
    return contiguous.view(_CELL_KEY_DTYPE).reshape(-1)


def _union_nearby(
    disjoint: _DisjointSet,
    coordinates: np.ndarray,
    left: np.ndarray,
    right: np.ndarray,
    tolerance_squared: float,
    *,
    same_group: bool,
) -> None:
    """Union exact candidates from one or two neighboring uniform-grid cells."""

    for local, left_index in enumerate(left):
        candidates = right[local + 1 :] if same_group else right
        if not len(candidates):
            continue
        deltas = coordinates[candidates] - coordinates[int(left_index)]
        squared = np.einsum("ij,ij->i", deltas, deltas)
        for right_index in candidates[squared <= tolerance_squared]:
            disjoint.union(int(left_index), int(right_index))


def _cluster_endpoints(
    endpoint_table: EndpointTable,
    *,
    cell_width: int,
    tolerance_squared: float,
) -> np.ndarray:
    count = len(endpoint_table)
    if count == 0:
        return np.empty(0, dtype=np.int64)
    cells = np.floor_divide(endpoint_table.grid_coordinates, cell_width)
    order = np.lexsort((cells[:, 1], cells[:, 0]))
    sorted_cells = cells[order]
    starts_mask = np.empty(count, dtype=np.bool_)
    starts_mask[0] = True
    starts_mask[1:] = np.any(sorted_cells[1:] != sorted_cells[:-1], axis=1)
    starts = np.flatnonzero(starts_mask)
    counts = np.diff(np.append(starts, count))
    unique_cells = sorted_cells[starts]
    keys = _cell_keys(unique_cells)
    disjoint = _DisjointSet(count)

    for cell_index in np.flatnonzero(counts > 1):
        start = int(starts[cell_index])
        members = order[start : start + int(counts[cell_index])]
        _union_nearby(
            disjoint,
            endpoint_table.coordinates,
            members,
            members,
            tolerance_squared,
            same_group=True,
        )

    # Only the positive half of the Moore neighborhood is required.
    for offset in ((0, 1), (1, -1), (1, 0), (1, 1)):
        targets = unique_cells + np.asarray(offset, dtype=np.int64)
        target_keys = _cell_keys(targets)
        positions = np.searchsorted(keys, target_keys)
        valid = positions < len(keys)
        matched = np.zeros(len(keys), dtype=np.bool_)
        valid_indices = np.flatnonzero(valid)
        matched[valid_indices] = keys[positions[valid_indices]] == target_keys[valid_indices]
        for left_cell in np.flatnonzero(matched):
            right_cell = int(positions[left_cell])
            left_start = int(starts[left_cell])
            right_start = int(starts[right_cell])
            left_members = order[left_start : left_start + int(counts[left_cell])]
            right_members = order[right_start : right_start + int(counts[right_cell])]
            _union_nearby(
                disjoint,
                endpoint_table.coordinates,
                left_members,
                right_members,
                tolerance_squared,
                same_group=False,
            )
    return disjoint.roots()


def _medoid_costs(coordinates: np.ndarray) -> np.ndarray:
    count = len(coordinates)
    if count <= 1:
        return np.zeros(count, dtype=np.float64)
    costs = np.empty(count, dtype=np.float64)
    # Chunking keeps pathological coincident clusters from allocating O(k^2) memory.
    chunk_size = max(1, min(512, 8_000_000 // max(count, 1)))
    for start in range(0, count, chunk_size):
        stop = min(count, start + chunk_size)
        deltas = coordinates[start:stop, None, :] - coordinates[None, :, :]
        costs[start:stop] = np.linalg.norm(deltas, axis=2).sum(axis=1)
    return costs


@operator_registry.operator(
    OperatorSpec("snap.propose", "1.0.0", "Deterministic non-mutating endpoint snap plan", "DrawingSnapshot+EndpointTable", "SnapPlan", Exactness.GRID_SNAPPED, tolerance_fields=("endpoint_snap",))
)
def propose(
    snapshot: DrawingSnapshot,
    *,
    tolerance: ToleranceProfile | None = None,
    endpoints: EndpointTable | None = None,
) -> OpResult[SnapPlan]:
    profile = tolerance or ToleranceProfile.from_json(snapshot.tolerance_profile_json)
    endpoint_table = endpoints or extract_endpoints(snapshot)
    count = len(endpoint_table)
    cell_width = max(
        1,
        int(np.ceil(profile.endpoint_snap / snapshot.coordinate_frame.grid_size)),
    )
    roots = _cluster_endpoints(
        endpoint_table,
        cell_width=cell_width,
        tolerance_squared=profile.endpoint_snap * profile.endpoint_snap,
    )
    unique_roots, cluster_indices = np.unique(roots, return_inverse=True)
    if len(unique_roots) > np.iinfo(np.int32).max:
        raise OverflowError("SnapPlan cluster count exceeds int32 capacity")
    cluster_indices = cluster_indices.astype(np.int32, copy=False)
    member_order = np.argsort(cluster_indices, kind="stable")
    member_counts = np.bincount(cluster_indices, minlength=len(unique_roots))
    member_offsets = np.concatenate(
        (np.asarray((0,), dtype=np.int64), np.cumsum(member_counts, dtype=np.int64))
    )
    anchors = member_order[member_offsets[:-1]] if count else np.empty(0, dtype=np.int64)
    representatives = anchors.copy()

    # Singleton clusters are already resolved. Apply the full deterministic rule
    # only where a choice exists.
    for cluster_index in np.flatnonzero(member_counts > 1):
        start = int(member_offsets[cluster_index])
        end = int(member_offsets[cluster_index + 1])
        members = member_order[start:end]
        coordinates = endpoint_table.coordinates[members]
        centroid = coordinates.mean(axis=0)
        centroid_displacements = np.linalg.norm(coordinates - centroid, axis=1)
        medoid_costs = _medoid_costs(coordinates)
        winner = min(
            range(len(members)),
            key=lambda local: (
                not bool(endpoint_table.source_priority[members[local]]),
                float(centroid_displacements[local]),
                float(medoid_costs[local]),
                str(endpoint_table.endpoint_ids[members[local]]),
            ),
        )
        representatives[cluster_index] = members[winner]

    representative_grid = endpoint_table.grid_coordinates[representatives]
    representative_points = snapshot.coordinate_frame.dequantize(representative_grid)
    endpoint_representatives = representative_points[cluster_indices]
    displacements = np.linalg.norm(
        endpoint_table.coordinates - endpoint_representatives,
        axis=1,
    )
    maximum_by_cluster = np.zeros(len(unique_roots), dtype=np.float64)
    if count:
        np.maximum.at(maximum_by_cluster, cluster_indices, displacements)

    graph_id = stable_id(
        "incidence-graph",
        snapshot.snapshot_id,
        profile.profile_id,
        profile.profile_name,
        profile.endpoint_snap,
        length=64,
    )
    conflicts: list[SnapConflict] = []

    def conflict_members(cluster_index: int) -> tuple[str, ...]:
        start = int(member_offsets[cluster_index])
        end = int(member_offsets[cluster_index + 1])
        return tuple(
            str(value) for value in endpoint_table.endpoint_ids[member_order[start:end]]
        )

    for cluster_index in np.flatnonzero(maximum_by_cluster > profile.endpoint_snap):
        cluster_id = str(endpoint_table.endpoint_ids[anchors[cluster_index]])
        conflicts.append(
            SnapConflict(
                cluster_id,
                "TRANSITIVE_CLUSTER_EXCEEDS_TOLERANCE",
                "Transitive endpoint links place a member farther than snap tolerance from the representative.",
                conflict_members(int(cluster_index)),
                float(maximum_by_cluster[cluster_index]),
            )
        )

    # A source curve collapses only when its distinct authored endpoints resolve
    # to one cluster; deliberately closed entities are exempt.
    if count > 1:
        adjacent_pairs = np.flatnonzero(
            (endpoint_table.geometry_rows[:-1] == endpoint_table.geometry_rows[1:])
            & (endpoint_table.ordinals[:-1] == 0)
            & (endpoint_table.ordinals[1:] == 1)
        )
        collapsed = adjacent_pairs[
            cluster_indices[adjacent_pairs] == cluster_indices[adjacent_pairs + 1]
        ]
        if len(collapsed):
            collapsed = collapsed[
                ~snapshot.geometry.closed[endpoint_table.geometry_rows[collapsed]]
            ]
        for cluster_index in np.unique(cluster_indices[collapsed]):
            index = int(cluster_index)
            conflicts.append(
                SnapConflict(
                    str(endpoint_table.endpoint_ids[anchors[index]]),
                    "COLLAPSED_SOURCE_EDGE",
                    "Both endpoints of a source edge resolve to one cluster.",
                    conflict_members(index),
                    float(maximum_by_cluster[index]),
                )
            )

    conflicts.sort(key=lambda item: (item.cluster_id, item.code))
    plan = SnapPlan(
        snapshot_id=snapshot.snapshot_id,
        tolerance_profile_id=profile.profile_id,
        graph_id=graph_id,
        endpoints=endpoint_table,
        cluster_anchor_endpoint_indices=anchors,
        representative_endpoint_indices=representatives,
        representative_grid_points=representative_grid,
        representative_points=representative_points,
        member_offsets=member_offsets,
        member_endpoint_indices=member_order,
        cluster_indices_by_endpoint=cluster_indices,
        displacements=displacements,
        conflicts=tuple(conflicts),
    )
    return successful_result(
        plan,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED,
        decision=Decision.AMBIGUOUS if conflicts else Decision.COMPUTED,
        diagnostics=tuple(
            Diagnostic(
                code=conflict.code,
                message=conflict.message,
                severity=DiagnosticSeverity.ERROR,
                details=(
                    ("cluster_id", conflict.cluster_id),
                    ("member_endpoint_ids", ",".join(conflict.member_endpoint_ids)),
                    ("max_displacement", f"{conflict.max_displacement:.17g}"),
                ),
            )
            for conflict in conflicts
        ),
        derivation=(
            "uniform-grid neighbor proposal within endpoint_snap",
            "deterministic representative: source priority, centroid displacement, medoid cost, stable id",
            "original geometry retained; snapped coordinates exist only in EndpointView",
        ),
    )
