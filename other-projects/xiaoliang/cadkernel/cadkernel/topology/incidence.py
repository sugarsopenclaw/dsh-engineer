from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import networkx as nx
import numpy as np

from cadkernel._serialization import freeze_array
from cadkernel.contracts import Decision, Exactness, OperatorSpec, OpResult, operator_registry
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot
from cadkernel.repair import EndpointTable, SnapPlan


@dataclass(frozen=True, slots=True)
class IncidenceEdge:
    occurrence_id: str
    definition_id: str
    node_u: str
    node_v: str


@dataclass(frozen=True, slots=True, eq=False)
class IncidenceGraph:
    """Immutable columnar source-incidence multigraph.

    Node and edge object tuples are lazy compatibility views. Algorithms can
    stay on integer columns, which is critical at hundreds of thousands of
    source entities.
    """

    snapshot_id: str
    graph_id: str
    tolerance_profile_id: str
    endpoint_ids: np.ndarray = field(repr=False, compare=False)
    node_endpoint_indices: np.ndarray = field(repr=False, compare=False)
    node_grid_points: np.ndarray = field(repr=False, compare=False)
    source_occurrence_ids: np.ndarray = field(repr=False, compare=False)
    source_definition_ids: np.ndarray = field(repr=False, compare=False)
    edge_geometry_rows: np.ndarray = field(repr=False, compare=False)
    edge_node_indices: np.ndarray = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        endpoint_ids = freeze_array(self.endpoint_ids, ndim=1)
        node_endpoints = freeze_array(self.node_endpoint_indices, dtype=np.int64, ndim=1)
        node_points = freeze_array(self.node_grid_points, dtype=np.int64, ndim=2)
        occurrences = freeze_array(self.source_occurrence_ids, ndim=1)
        definitions = freeze_array(self.source_definition_ids, ndim=1)
        edge_rows = freeze_array(self.edge_geometry_rows, dtype=np.int64, ndim=1)
        edge_nodes = freeze_array(self.edge_node_indices, dtype=np.int32, ndim=2)
        if endpoint_ids.dtype.kind != "U" or occurrences.dtype.kind != "U" or definitions.dtype.kind != "U":
            raise ValueError("IncidenceGraph identity columns must be Unicode arrays")
        if node_points.shape != (len(node_endpoints), 2):
            raise ValueError("IncidenceGraph node columns disagree")
        if edge_nodes.shape != (len(edge_rows), 2):
            raise ValueError("IncidenceGraph edge columns disagree")
        if len(node_endpoints) and (
            node_endpoints.min() < 0 or node_endpoints.max() >= len(endpoint_ids)
        ):
            raise ValueError("IncidenceGraph node endpoint index is out of range")
        if len(edge_rows) and (
            edge_rows.min() < 0
            or edge_rows.max() >= len(occurrences)
            or edge_rows.max() >= len(definitions)
        ):
            raise ValueError("IncidenceGraph edge geometry row is out of range")
        if len(edge_nodes) and (
            edge_nodes.min() < 0 or edge_nodes.max() >= len(node_endpoints)
        ):
            raise ValueError("IncidenceGraph edge node is out of range")
        object.__setattr__(self, "endpoint_ids", endpoint_ids)
        object.__setattr__(self, "node_endpoint_indices", node_endpoints)
        object.__setattr__(self, "node_grid_points", node_points)
        object.__setattr__(self, "source_occurrence_ids", occurrences)
        object.__setattr__(self, "source_definition_ids", definitions)
        object.__setattr__(self, "edge_geometry_rows", edge_rows)
        object.__setattr__(self, "edge_node_indices", edge_nodes)

    @property
    def node_count(self) -> int:
        return len(self.node_endpoint_indices)

    @property
    def edge_count(self) -> int:
        return len(self.edge_geometry_rows)

    def node_id(self, node_index: int) -> str:
        return str(self.endpoint_ids[self.node_endpoint_indices[node_index]])

    @property
    def node_ids(self) -> np.ndarray:
        values = self.endpoint_ids[self.node_endpoint_indices]
        values.setflags(write=False)
        return values

    @property
    def nodes(self) -> tuple[str, ...]:
        return tuple(str(value) for value in self.node_ids)

    @property
    def edges(self) -> tuple[IncidenceEdge, ...]:
        return tuple(
            IncidenceEdge(
                occurrence_id=str(self.source_occurrence_ids[row]),
                definition_id=str(self.source_definition_ids[row]),
                node_u=self.node_id(int(nodes[0])),
                node_v=self.node_id(int(nodes[1])),
            )
            for row, nodes in zip(self.edge_geometry_rows, self.edge_node_indices)
        )

    def to_networkx(self) -> nx.MultiGraph:
        graph = nx.MultiGraph(graph_id=self.graph_id)
        node_ids = self.node_ids
        for node_index, point in enumerate(self.node_grid_points):
            graph.add_node(
                str(node_ids[node_index]),
                grid_point=(int(point[0]), int(point[1])),
                node_index=node_index,
            )
        for row, nodes in zip(self.edge_geometry_rows, self.edge_node_indices):
            occurrence_id = str(self.source_occurrence_ids[row])
            graph.add_edge(
                str(node_ids[nodes[0]]),
                str(node_ids[nodes[1]]),
                key=occurrence_id,
                occurrence_id=occurrence_id,
                definition_id=str(self.source_definition_ids[row]),
            )
        return nx.freeze(graph)


@dataclass(frozen=True, slots=True)
class IncidenceFacts:
    graph_id: str
    node_count: int
    edge_count: int
    connected_components: tuple[tuple[str, ...], ...]
    degrees: tuple[tuple[str, int], ...]
    isolated_nodes: tuple[str, ...]
    dangling_nodes: tuple[str, ...]
    bridge_occurrence_ids: tuple[str, ...]
    articulation_points: tuple[str, ...]
    cycles: tuple[tuple[str, ...], ...]
    minimum_cycle_basis: tuple[tuple[str, ...], ...]
    connected_component_count: int
    isolated_node_count: int
    dangling_node_count: int
    bridge_count: int
    articulation_point_count: int
    cycle_count: int
    minimum_cycle_basis_count: int
    details_truncated: bool


@dataclass(frozen=True, slots=True)
class PathResult:
    graph_id: str
    nodes: tuple[str, ...]
    occurrence_ids: tuple[str, ...]


@operator_registry.operator(
    OperatorSpec("topology.build_incidence_graph", "1.0.0", "Build raw or explicitly snapped endpoint incidence graph", "DrawingSnapshot+EndpointTable+SnapPlan", "IncidenceGraph", Exactness.GRID_SNAPPED)
)
def build_incidence_graph(
    snapshot: DrawingSnapshot,
    endpoints: EndpointTable,
    plan: SnapPlan,
) -> OpResult[IncidenceGraph]:
    if plan.snapshot_id != snapshot.snapshot_id:
        raise ValueError("SnapPlan belongs to another snapshot")
    plan._assert_same_endpoints(endpoints)
    geometry_count = len(snapshot.geometry)
    start_endpoint = np.full(geometry_count, -1, dtype=np.int64)
    end_endpoint = np.full(geometry_count, -1, dtype=np.int64)
    endpoint_indices = np.arange(len(endpoints), dtype=np.int64)
    start_mask = endpoints.ordinals == 0
    end_mask = endpoints.ordinals == 1
    start_endpoint[endpoints.geometry_rows[start_mask]] = endpoint_indices[start_mask]
    end_endpoint[endpoints.geometry_rows[end_mask]] = endpoint_indices[end_mask]
    edge_rows = np.flatnonzero((start_endpoint >= 0) & (end_endpoint >= 0))
    edge_nodes = np.column_stack(
        (
            plan.cluster_indices_by_endpoint[start_endpoint[edge_rows]],
            plan.cluster_indices_by_endpoint[end_endpoint[edge_rows]],
        )
    ).astype(np.int32, copy=False)
    graph = IncidenceGraph(
        snapshot_id=snapshot.snapshot_id,
        graph_id=plan.graph_id,
        tolerance_profile_id=plan.tolerance_profile_id,
        endpoint_ids=endpoints.endpoint_ids,
        node_endpoint_indices=plan.cluster_anchor_endpoint_indices,
        node_grid_points=plan.representative_grid_points,
        source_occurrence_ids=snapshot.geometry.occurrence_ids,
        source_definition_ids=snapshot.geometry.definition_ids,
        edge_geometry_rows=edge_rows,
        edge_node_indices=edge_nodes,
    )
    return successful_result(
        graph,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED,
        decision=Decision.AMBIGUOUS if plan.conflicts else Decision.COMPUTED,
        derivation=("one graph node per SnapPlan cluster; source occurrences remain multiedges",),
    )


def _canonical_cycle(cycle: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    values = list(cycle)
    if len(values) <= 1:
        return tuple(values)
    variants: list[tuple[str, ...]] = []
    for oriented in (values, list(reversed(values))):
        for offset in range(len(values)):
            variants.append(tuple(oriented[offset:] + oriented[:offset]))
    return min(variants)


class _IndexDisjointSet:
    def __init__(self, size: int) -> None:
        self.parents = np.arange(size, dtype=np.int64)
        self.ranks = np.zeros(size, dtype=np.uint8)

    def find(self, value: int) -> int:
        parent = int(self.parents[value])
        while parent != value:
            grandparent = int(self.parents[parent])
            self.parents[value] = grandparent
            value, parent = parent, grandparent
        return value

    def union(self, left: int, right: int) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left == root_right:
            return
        if self.ranks[root_left] < self.ranks[root_right]:
            root_left, root_right = root_right, root_left
        self.parents[root_right] = root_left
        if self.ranks[root_left] == self.ranks[root_right]:
            self.ranks[root_left] += 1

    def roots(self) -> np.ndarray:
        if len(self.parents) == 0:
            return self.parents.copy()
        while True:
            compressed = self.parents[self.parents]
            if np.array_equal(compressed, self.parents):
                break
            self.parents[:] = compressed
        return self.parents.copy()


def _limit_indices(indices: np.ndarray, detail_limit: int | None) -> np.ndarray:
    return indices if detail_limit is None else indices[:detail_limit]


def _forest_facts(
    incidence: IncidenceGraph,
    *,
    canonical_edges: np.ndarray,
    unique_edges: np.ndarray,
    unique_first: np.ndarray,
    multiplicities: np.ndarray,
    roots: np.ndarray,
    detail_limit: int | None,
) -> IncidenceFacts:
    node_count = incidence.node_count
    edge_count = incidence.edge_count
    node_ids = incidence.endpoint_ids[incidence.node_endpoint_indices]
    degrees_array = np.bincount(
        incidence.edge_node_indices.reshape(-1), minlength=node_count
    ).astype(np.int64, copy=False)
    isolated_indices = np.flatnonzero(degrees_array == 0)
    dangling_indices = np.flatnonzero(degrees_array == 1)
    component_roots, component_inverse, component_sizes = np.unique(
        roots, return_inverse=True, return_counts=True
    )
    component_count = len(component_roots)

    # Never emit a partial component as if it were complete. On very large
    # graphs counts remain exact and the bounded detail view is explicitly marked.
    components: list[tuple[str, ...]] = []
    if detail_limit is None or node_count <= detail_limit:
        component_order = np.argsort(component_inverse, kind="stable")
        offsets = np.concatenate(
            (np.asarray((0,), dtype=np.int64), np.cumsum(component_sizes, dtype=np.int64))
        )
        for start, end in zip(offsets[:-1], offsets[1:]):
            members = component_order[int(start) : int(end)]
            components.append(tuple(str(node_ids[index]) for index in members))
        components.sort(key=lambda item: (item[0] if item else "", len(item)))

    degree_indices = _limit_indices(np.arange(node_count, dtype=np.int64), detail_limit)
    degrees = tuple((str(node_ids[index]), int(degrees_array[index])) for index in degree_indices)
    isolated = tuple(str(node_ids[index]) for index in _limit_indices(isolated_indices, detail_limit))
    dangling = tuple(str(node_ids[index]) for index in _limit_indices(dangling_indices, detail_limit))

    non_loop = unique_edges[:, 0] != unique_edges[:, 1]
    bridge_unique_indices = np.flatnonzero(non_loop & (multiplicities == 1))
    bridge_edge_indices = unique_first[bridge_unique_indices]
    bridge_rows = incidence.edge_geometry_rows[bridge_edge_indices]
    bridge_ids_array = incidence.source_occurrence_ids[bridge_rows]
    bridge_order = np.argsort(bridge_ids_array, kind="stable")
    bridge_ids_array = bridge_ids_array[bridge_order]
    bridges = tuple(
        str(value) for value in _limit_indices(bridge_ids_array, detail_limit)
    )

    simple_degrees = np.bincount(
        unique_edges[non_loop].reshape(-1), minlength=node_count
    )
    articulation_indices = np.flatnonzero(simple_degrees > 1)
    articulation = tuple(
        str(node_ids[index])
        for index in _limit_indices(articulation_indices, detail_limit)
    )

    loop_edge_indices = np.flatnonzero(~non_loop)
    parallel_edge_indices = np.flatnonzero(non_loop & (multiplicities >= 2))
    cycle_count = int(multiplicities[loop_edge_indices].sum()) + int(
        (multiplicities[parallel_edge_indices] - 1).sum()
    )
    cycle_details: list[tuple[str, ...]] = []
    maximum = cycle_count if detail_limit is None else detail_limit
    for edge_index in loop_edge_indices:
        for _ in range(int(multiplicities[edge_index])):
            if len(cycle_details) >= maximum:
                break
            cycle_details.append((str(node_ids[unique_edges[edge_index, 0]]),))
    for edge_index in parallel_edge_indices:
        for _ in range(int(multiplicities[edge_index]) - 1):
            if len(cycle_details) >= maximum:
                break
            left, right = unique_edges[edge_index]
            cycle_details.append((str(node_ids[left]), str(node_ids[right])))
    cycle_details.sort()

    details_truncated = bool(
        detail_limit is not None
        and (
            node_count > detail_limit
            or component_count > len(components)
            or len(isolated_indices) > len(isolated)
            or len(dangling_indices) > len(dangling)
            or len(bridge_ids_array) > len(bridges)
            or len(articulation_indices) > len(articulation)
            or cycle_count > len(cycle_details)
        )
    )
    return IncidenceFacts(
        graph_id=incidence.graph_id,
        node_count=node_count,
        edge_count=edge_count,
        connected_components=tuple(components),
        degrees=degrees,
        isolated_nodes=isolated,
        dangling_nodes=dangling,
        bridge_occurrence_ids=bridges,
        articulation_points=articulation,
        cycles=tuple(cycle_details),
        minimum_cycle_basis=tuple(cycle_details),
        connected_component_count=component_count,
        isolated_node_count=len(isolated_indices),
        dangling_node_count=len(dangling_indices),
        bridge_count=len(bridge_ids_array),
        articulation_point_count=len(articulation_indices),
        cycle_count=cycle_count,
        minimum_cycle_basis_count=cycle_count,
        details_truncated=details_truncated,
    )


def _networkx_facts(
    incidence: IncidenceGraph,
    *,
    detail_limit: int | None,
) -> IncidenceFacts:
    graph = incidence.to_networkx()
    simple = nx.Graph()
    simple.add_nodes_from(graph.nodes)
    multiplicity: Counter[tuple[str, str]] = Counter()
    for left, right in graph.edges():
        key = tuple(sorted((str(left), str(right))))
        multiplicity[key] += 1
        if left != right:
            simple.add_edge(left, right)

    all_components = [tuple(sorted(str(node) for node in value)) for value in nx.connected_components(simple)]
    all_components.sort(key=lambda item: (item[0] if item else "", len(item)))
    degree_values = sorted((str(node), int(value)) for node, value in graph.degree())
    isolated_values = [node for node, degree in degree_values if degree == 0]
    dangling_values = [node for node, degree in degree_values if degree == 1]
    bridge_values: list[str] = []
    for left, right in nx.bridges(simple):
        key = tuple(sorted((str(left), str(right))))
        if multiplicity[key] == 1:
            bridge_values.append(min(str(value) for value in graph.get_edge_data(left, right)))
    bridge_values.sort()
    articulation_values = sorted(str(node) for node in nx.articulation_points(simple))
    # The number of cycles in any basis is the exact cyclomatic rank. Keep that
    # count independent from the bounded example payload: NetworkX's weighted
    # minimum-cycle-basis implementation is superlinear and is not an acceptable
    # mandatory report path for a 300k-entity snapshot.
    component_count = len(all_components)
    cycle_rank = graph.number_of_edges() - graph.number_of_nodes() + component_count
    maximum_details = cycle_rank if detail_limit is None else detail_limit
    structural_cycles: list[tuple[str, ...]] = []
    for node in sorted(graph.nodes, key=str):
        for _ in range(graph.number_of_edges(node, node)):
            if len(structural_cycles) >= maximum_details:
                break
            structural_cycles.append((str(node),))
    for (left, right), count in sorted(multiplicity.items()):
        if left == right:
            continue
        for _ in range(max(0, count - 1)):
            if len(structural_cycles) >= maximum_details:
                break
            structural_cycles.append(_canonical_cycle((left, right)))

    # A caller can request the complete exact detail view with detail_limit=None.
    # Reports use a finite bound, so large cyclic graphs publish exact counts plus
    # an explicitly truncated detail view instead of spending minutes in MCB.
    exact_detail_edge_limit = 1_000
    compute_simple_details = (
        detail_limit is None or simple.number_of_edges() <= exact_detail_edge_limit
    )
    fundamental_cycles: list[tuple[str, ...]] = []
    minimum_simple: list[tuple[str, ...]] = []
    if compute_simple_details:
        fundamental_cycles = sorted(
            _canonical_cycle(cycle) for cycle in nx.cycle_basis(simple)
        )
        minimum_simple = sorted(
            _canonical_cycle(cycle) for cycle in nx.minimum_cycle_basis(simple)
        )
    sorted_cycles = sorted(structural_cycles + fundamental_cycles)
    sorted_minimum = sorted(structural_cycles + minimum_simple)

    def limited(values):
        return tuple(values if detail_limit is None else values[:detail_limit])

    components = limited(all_components)
    degrees = limited(degree_values)
    isolated = limited(isolated_values)
    dangling = limited(dangling_values)
    bridges = limited(bridge_values)
    articulation = limited(articulation_values)
    cycle_details = limited(sorted_cycles)
    minimum_details = limited(sorted_minimum)
    details_truncated = bool(
        detail_limit is not None
        and any(
            len(full) > len(detail)
            for full, detail in (
                (all_components, components),
                (degree_values, degrees),
                (isolated_values, isolated),
                (dangling_values, dangling),
                (bridge_values, bridges),
                (articulation_values, articulation),
                (range(cycle_rank), cycle_details),
                (range(cycle_rank), minimum_details),
            )
        )
    )
    return IncidenceFacts(
        graph_id=incidence.graph_id,
        node_count=graph.number_of_nodes(),
        edge_count=graph.number_of_edges(),
        connected_components=components,
        degrees=degrees,
        isolated_nodes=isolated,
        dangling_nodes=dangling,
        bridge_occurrence_ids=bridges,
        articulation_points=articulation,
        cycles=cycle_details,
        minimum_cycle_basis=minimum_details,
        connected_component_count=len(all_components),
        isolated_node_count=len(isolated_values),
        dangling_node_count=len(dangling_values),
        bridge_count=len(bridge_values),
        articulation_point_count=len(articulation_values),
        cycle_count=cycle_rank,
        minimum_cycle_basis_count=cycle_rank,
        details_truncated=details_truncated,
    )


@operator_registry.operator(
    OperatorSpec("graph.incidence_facts", "1.0.0", "Connected components, degree, bridges, articulation points and cycles", "DrawingSnapshot+IncidenceGraph", "IncidenceFacts", Exactness.EXACT)
)
def graph_facts(
    snapshot: DrawingSnapshot,
    incidence: IncidenceGraph,
    *,
    detail_limit: int | None = 10_000,
) -> OpResult[IncidenceFacts]:
    if detail_limit is not None and detail_limit < 0:
        raise ValueError("detail_limit must be non-negative or None")
    if incidence.edge_count:
        canonical_edges = np.sort(incidence.edge_node_indices.astype(np.int64), axis=1)
        unique_edges, unique_first, multiplicities = np.unique(
            canonical_edges,
            axis=0,
            return_index=True,
            return_counts=True,
        )
    else:
        canonical_edges = np.empty((0, 2), dtype=np.int64)
        unique_edges = np.empty((0, 2), dtype=np.int64)
        unique_first = np.empty(0, dtype=np.int64)
        multiplicities = np.empty(0, dtype=np.int64)
    non_loop_edges = unique_edges[unique_edges[:, 0] != unique_edges[:, 1]]
    disjoint = _IndexDisjointSet(incidence.node_count)
    for left, right in non_loop_edges:
        disjoint.union(int(left), int(right))
    roots = disjoint.roots()
    component_count = len(np.unique(roots))
    simple_cycle_rank = len(non_loop_edges) - incidence.node_count + component_count
    if simple_cycle_rank == 0:
        facts = _forest_facts(
            incidence,
            canonical_edges=canonical_edges,
            unique_edges=unique_edges,
            unique_first=unique_first,
            multiplicities=multiplicities,
            roots=roots,
            detail_limit=detail_limit,
        )
        derivation = (
            "columnar union-find forest analysis; exact multiedge and self-loop accounting",
        )
    else:
        facts = _networkx_facts(incidence, detail_limit=detail_limit)
        derivation = (
            "NetworkX deterministic algorithms over the stable cyclic multigraph projection",
        )
    return successful_result(
        facts,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED,
        derivation=derivation,
    )


@operator_registry.operator(
    OperatorSpec("graph.shortest_path", "1.0.0", "Deterministic shortest path in an incidence graph", "DrawingSnapshot+IncidenceGraph+node-pair", "PathResult", Exactness.EXACT)
)
def shortest_path(
    snapshot: DrawingSnapshot,
    incidence: IncidenceGraph,
    source: str,
    target: str,
) -> OpResult[PathResult]:
    graph = incidence.to_networkx()
    nodes = tuple(nx.shortest_path(graph, source=source, target=target))
    occurrence_ids: list[str] = []
    for left, right in zip(nodes, nodes[1:]):
        edge_data = graph.get_edge_data(left, right)
        occurrence_ids.append(min(str(key) for key in edge_data))
    return successful_result(
        PathResult(incidence.graph_id, nodes, tuple(occurrence_ids)),
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.GRID_SNAPPED,
        derivation=("unweighted shortest path with stable minimum occurrence id for parallel-edge evidence",),
    )
