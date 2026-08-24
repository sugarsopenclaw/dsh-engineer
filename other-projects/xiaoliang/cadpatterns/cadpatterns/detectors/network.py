from __future__ import annotations

from collections import defaultdict

import numpy as np

from cadkernel.contracts import stable_id

from cadpatterns.candidates import (
    DetectionBatch,
    DetectionContext,
    make_candidate,
    member,
    proof_grade_for_topology,
    ref,
    topology_is_unsupported,
    unsupported_candidate,
)
from cadpatterns.contracts import (
    DetectorSpec,
    PatternEdge,
    ProofGrade,
    ReferenceKind,
    RelationType,
    ScopeType,
    TraceEvent,
    detector_registry,
)
from cadpatterns.ontology import (
    GENERIC_NETWORK_JUNCTION,
    GENERIC_NETWORK_TERMINAL,
    GENERIC_PATH_NETWORK,
)


PATH_NETWORK_SPEC = DetectorSpec(
    detector_id="network.path",
    version="1.0.0",
    pattern_type=GENERIC_PATH_NETWORK,
    summary="Classify component degree structure, merge chains, and preserve crossing uncertainty",
    emits=(GENERIC_NETWORK_JUNCTION, GENERIC_NETWORK_TERMINAL),
)


def _component_columns(context: DetectionContext, scope):
    incidence = context.topology.incidence_graph
    allowed = set(scope.occurrence_ids)
    edge_occurrences = np.asarray(
        [
            str(context.snapshot.geometry.occurrence_ids[row])
            for row in incidence.edge_geometry_rows
        ]
    )
    edge_positions = np.asarray(
        [
            index
            for index, occurrence_id in enumerate(edge_occurrences)
            if str(occurrence_id) in allowed
        ],
        dtype=np.int64,
    )
    edge_nodes = incidence.edge_node_indices[edge_positions]
    degrees = np.bincount(
        edge_nodes.reshape(-1), minlength=incidence.node_count
    )
    return edge_positions, edge_nodes, edge_occurrences, degrees


def _segments(
    context: DetectionContext,
    edge_positions: np.ndarray,
    edge_nodes: np.ndarray,
    edge_occurrences: np.ndarray,
    degrees: np.ndarray,
):
    incidence = context.topology.incidence_graph
    adjacency: dict[int, list[int]] = defaultdict(list)
    nodes_by_edge: dict[int, tuple[int, int]] = {}
    for local, edge_position_value in enumerate(edge_positions):
        edge_position = int(edge_position_value)
        left, right = (int(value) for value in edge_nodes[local])
        nodes_by_edge[edge_position] = (left, right)
        adjacency[left].append(edge_position)
        adjacency[right].append(edge_position)
    for values in adjacency.values():
        values.sort(key=lambda position: str(edge_occurrences[position]))
    visited: set[int] = set()
    result = []

    def walk(start_node: int, first_edge: int):
        path_edges = []
        path_nodes = [start_node]
        node = start_node
        edge = first_edge
        while edge not in visited:
            visited.add(edge)
            path_edges.append(edge)
            left, right = nodes_by_edge[edge]
            node = right if left == node else left
            path_nodes.append(node)
            if int(degrees[node]) != 2:
                break
            choices = [candidate for candidate in adjacency[node] if candidate not in visited]
            if not choices:
                break
            edge = choices[0]
        return (
            str(incidence.node_ids[path_nodes[0]]),
            str(incidence.node_ids[path_nodes[-1]]),
            tuple(str(edge_occurrences[position]) for position in path_edges),
            tuple(str(incidence.node_ids[index]) for index in path_nodes),
        )

    significant_nodes = sorted(
        (index for index in adjacency if int(degrees[index]) != 2),
        key=lambda index: str(incidence.node_ids[index]),
    )
    for node in significant_nodes:
        for edge in adjacency[node]:
            if edge not in visited:
                result.append(walk(node, edge))
    for edge in sorted(nodes_by_edge, key=lambda value: str(edge_occurrences[value])):
        if edge in visited:
            continue
        left, right = nodes_by_edge[edge]
        start = min((left, right), key=lambda index: str(incidence.node_ids[index]))
        result.append(walk(start, edge))
    return tuple(sorted(result))


def _crossings(context: DetectionContext, component_occurrences: set[str]):
    arrangement = context.topology.arrangement
    incidence = context.topology.incidence_graph
    endpoint_table = context.topology.endpoints
    vertex_edges: dict[int, list[int]] = defaultdict(list)
    for edge_index, edge in enumerate(arrangement.edge_vertices):
        vertex_edges[int(edge[0])].append(edge_index)
        vertex_edges[int(edge[1])].append(edge_index)
    incidence_point_nodes: dict[tuple[int, int], list[int]] = defaultdict(list)
    for node_index, point in enumerate(incidence.node_grid_points):
        incidence_point_nodes[(int(point[0]), int(point[1]))].append(node_index)
    results = []
    for vertex_index, arrangement_edges in sorted(vertex_edges.items()):
        supporting: set[str] = set()
        for edge_index in arrangement_edges:
            start = int(arrangement.support_offsets[edge_index])
            end = int(arrangement.support_offsets[edge_index + 1])
            supporting.update(
                str(value)
                for value in arrangement.support_occurrence_ids[start:end]
            )
        if len(supporting) < 2 or not supporting.intersection(component_occurrences):
            continue
        grid_point = arrangement.vertices_grid[vertex_index]
        exact_nodes = incidence_point_nodes.get((int(grid_point[0]), int(grid_point[1])), ())
        connected = False
        for node_index in exact_nodes:
            edge_positions = np.flatnonzero(
                np.any(incidence.edge_node_indices == node_index, axis=1)
            )
            incident_occurrences = {
                str(context.snapshot.geometry.occurrence_ids[incidence.edge_geometry_rows[position]])
                for position in edge_positions
            }
            if len(incident_occurrences.intersection(supporting)) >= 2:
                connected = True
                break
        if connected:
            semantics = "CONNECTED"
        else:
            support_mask = np.isin(endpoint_table.occurrence_ids, tuple(supporting))
            endpoint_points = endpoint_table.coordinates[support_mask]
            physical_point = context.snapshot.coordinate_frame.dequantize(grid_point)
            minimum_distance = (
                float(np.min(np.linalg.norm(endpoint_points - physical_point, axis=1)))
                if len(endpoint_points)
                else float("inf")
            )
            boundary = (
                context.upstream_tolerance.endpoint_snap
                * context.profile.crossing_boundary_ratio
            )
            semantics = (
                "AMBIGUOUS_CROSSING"
                if minimum_distance <= boundary
                else "CROSSES_WITHOUT_CONNECTION"
            )
        physical = context.snapshot.coordinate_frame.dequantize(grid_point)
        point = (float(physical[0]), float(physical[1]))
        occurrence_ids = tuple(sorted(supporting))
        crossing_id = "crossing:" + stable_id(
            "network-crossing",
            context.snapshot.snapshot_id,
            tuple(int(value) for value in grid_point),
            occurrence_ids,
            length=len(context.snapshot.snapshot_id),
        )
        results.append((crossing_id, semantics, point, occurrence_ids))
    return tuple(results)


def _node_bounds(context: DetectionContext, node_index: int):
    point = context.snapshot.coordinate_frame.dequantize(
        context.topology.incidence_graph.node_grid_points[node_index]
    )
    x, y = (float(value) for value in point)
    return x, y, x, y


@detector_registry.detector(PATH_NETWORK_SPEC)
def detect_path_networks(context: DetectionContext) -> DetectionBatch:
    if topology_is_unsupported(context):
        drawing = context.scopes.of_type(ScopeType.DRAWING)[0]
        return DetectionBatch(
            instances=(
                unsupported_candidate(
                    context,
                    PATH_NETWORK_SPEC,
                    pattern_type=GENERIC_PATH_NETWORK,
                    scope_id=drawing.scope_id,
                    reason="network structure is unavailable because source incidence was rejected or unsupported",
                ),
            )
        )
    incidence = context.topology.incidence_graph
    proof_grade, assumptions = proof_grade_for_topology(context)
    instances = []
    edges: list[PatternEdge] = []
    for scope in context.scopes.of_type(ScopeType.CONNECTED_COMPONENT):
        edge_positions, edge_nodes, edge_occurrences, degrees = _component_columns(
            context, scope
        )
        if len(edge_positions) == 0:
            continue
        segment_values = _segments(
            context, edge_positions, edge_nodes, edge_occurrences, degrees
        )
        crossing_values = _crossings(context, set(scope.occurrence_ids))
        network = make_candidate(
            context,
            PATH_NETWORK_SPEC,
            pattern_type=GENERIC_PATH_NETWORK,
            scope_id=scope.scope_id,
            members=tuple(
                member(context, "network_source", ReferenceKind.OCCURRENCE, value)
                for value in scope.occurrence_ids
            ),
            proof_grade=proof_grade,
            score=1.0,
            features=(
                ("crossings", crossing_values),
                ("detection_method", "incidence_component"),
                ("segments", segment_values),
            ),
            bounds=scope.bounds,
            assumptions=assumptions,
        )
        instances.append(network)
        local_edge_positions = {
            int(position) for position in edge_positions
        }
        for node_index, degree_value in enumerate(degrees):
            degree = int(degree_value)
            if degree != 1 and degree < context.profile.junction_min_degree:
                continue
            pattern_type = (
                GENERIC_NETWORK_TERMINAL
                if degree == 1
                else GENERIC_NETWORK_JUNCTION
            )
            role = "terminal_node" if degree == 1 else "junction_node"
            incident_positions = [
                int(position)
                for position in np.flatnonzero(
                    np.any(incidence.edge_node_indices == node_index, axis=1)
                )
                if int(position) in local_edge_positions
            ]
            node_id = str(incidence.node_ids[node_index])
            child = make_candidate(
                context,
                PATH_NETWORK_SPEC,
                pattern_type=pattern_type,
                scope_id=scope.scope_id,
                members=(
                    member(context, role, ReferenceKind.NODE, node_id),
                    *tuple(
                        member(
                            context,
                            "incident_source",
                            ReferenceKind.OCCURRENCE,
                            str(edge_occurrences[position]),
                        )
                        for position in incident_positions
                    ),
                ),
                proof_grade=proof_grade,
                score=1.0,
                features=(("degree", degree), ("network_pattern_key", network.pattern_key)),
                bounds=_node_bounds(context, node_index),
                assumptions=assumptions,
            )
            instances.append(child)
            edges.extend(
                (
                    PatternEdge.create(
                        snapshot_id=context.snapshot.snapshot_id,
                        relation=RelationType.CONTAINS,
                        source_pattern_key=network.pattern_key,
                        target=ref(context, ReferenceKind.PATTERN, child.pattern_key),
                        proof_grade=proof_grade,
                    ),
                    PatternEdge.create(
                        snapshot_id=context.snapshot.snapshot_id,
                        relation=RelationType.INSIDE,
                        source_pattern_key=child.pattern_key,
                        target=ref(context, ReferenceKind.PATTERN, network.pattern_key),
                        proof_grade=proof_grade,
                    ),
                    PatternEdge.create(
                        snapshot_id=context.snapshot.snapshot_id,
                        relation=RelationType.CONNECTED_TO,
                        source_pattern_key=child.pattern_key,
                        target=ref(context, ReferenceKind.PATTERN, network.pattern_key),
                        proof_grade=proof_grade,
                    ),
                )
            )
        for crossing_id, semantics, _, occurrence_ids in crossing_values:
            if semantics == "CONNECTED":
                continue
            edges.append(
                PatternEdge.create(
                    snapshot_id=context.snapshot.snapshot_id,
                    relation=RelationType.CROSSES,
                    source_pattern_key=network.pattern_key,
                    target=ref(context, ReferenceKind.CROSSING, crossing_id),
                    proof_grade=(
                        ProofGrade.TOLERANCE_DERIVED
                        if semantics == "AMBIGUOUS_CROSSING"
                        else ProofGrade.STRUCTURALLY_PROVEN
                    ),
                    evidence=tuple(
                        ref(context, ReferenceKind.OCCURRENCE, value)
                        for value in occurrence_ids
                    ),
                )
            )
    return DetectionBatch(
        instances=tuple(instances),
        edges=tuple(edges),
        trace=(
            TraceEvent.create(
                "detector",
                PATH_NETWORK_SPEC.detector_id,
                "incidence components classified into segments, terminals, junctions, and crossings",
                (("candidate_count", len(instances)),),
            ),
        ),
    )
