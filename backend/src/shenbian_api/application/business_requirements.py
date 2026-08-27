from __future__ import annotations

import hashlib
import math
from collections import defaultdict, deque

from shenbian_api.application.ports import BusinessRequirementsReader
from shenbian_api.domain.business_requirements import (
    BusinessRequirementDetailNode,
    BusinessRequirementDetailResponse,
    BusinessRequirementGraphEdge,
    BusinessRequirementGraphNode,
    BusinessRequirementsGraphCounts,
    BusinessRequirementsGraphResponse,
    BusinessRequirementsGraphSnapshot,
    GraphDatasetMetadata,
    GraphDimensions,
    GraphPosition,
    GraphViewMetadata,
    NodePositionSource,
    RequirementNodeRecord,
    RequirementOriginKind,
    RequirementRelationKind,
    ViewPositionSource,
)

DEFAULT_BUSINESS_REQUIREMENTS_DATASET_ID = "shenbian.client_requirements.curated.v1"
DEFAULT_BUSINESS_REQUIREMENTS_VIEW_ID = "GV-BUSINESS-DEFAULT"
INITIAL_LAYOUT_VERSION = "initial-semantic-v1"
ORIGIN_MEANING = "距离越小，越贴近客户原始需求表达"

HIERARCHY_RELATION_KINDS = {
    RequirementRelationKind.CONTAINS,
    RequirementRelationKind.DECOMPOSES,
}


def source_proximity_rank(node: RequirementNodeRecord) -> int:
    if node.requirement_id == "BR-000":
        return 0
    return {
        RequirementOriginKind.CUSTOMER_STATED: 1,
        RequirementOriginKind.NORMALIZED: 2,
        RequirementOriginKind.DOMAIN_DECOMPOSITION: 3,
    }[node.origin_kind]


def semantic_radius(node: RequirementNodeRecord) -> float:
    if node.requirement_id == "BR-000":
        return 0.0
    return float(180 * source_proximity_rank(node) + 55 * max(node.derived_min_depth - 1, 0))


def _stable_unit_interval(value: str) -> float:
    integer = int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:8], "big")
    return integer / ((1 << 64) - 1)


def _top_level_edges(
    snapshot: BusinessRequirementsGraphSnapshot,
) -> list[BusinessRequirementGraphEdge]:
    return sorted(
        (
            edge
            for edge in snapshot.edges
            if edge.source_node_id == "BR-000"
            and edge.relation_kind == RequirementRelationKind.CONTAINS
        ),
        key=lambda edge: (edge.display_order, edge.target_node_id, edge.id),
    )


def _sector_assignments(snapshot: BusinessRequirementsGraphSnapshot) -> tuple[dict[str, int], int]:
    top_edges = _top_level_edges(snapshot)
    sector_count = max(len(top_edges), 1)
    assignments: dict[str, int] = {}
    children: dict[str, list[BusinessRequirementGraphEdge]] = defaultdict(list)
    for edge in snapshot.edges:
        if edge.relation_kind in HIERARCHY_RELATION_KINDS:
            children[edge.source_node_id].append(edge)
    for edges in children.values():
        edges.sort(key=lambda edge: (edge.display_order, edge.target_node_id, edge.id))

    for sector_index, top_edge in enumerate(top_edges):
        queue: deque[str] = deque([top_edge.target_node_id])
        seen_in_sector: set[str] = set()
        while queue:
            node_id = queue.popleft()
            if node_id in seen_in_sector:
                continue
            seen_in_sector.add(node_id)
            assignments.setdefault(node_id, sector_index)
            queue.extend(edge.target_node_id for edge in children.get(node_id, []))

    pending = sorted(
        snapshot.edges,
        key=lambda edge: (edge.display_order, edge.source_node_id, edge.target_node_id, edge.id),
    )
    changed = True
    while changed:
        changed = False
        for edge in pending:
            if edge.target_node_id not in assignments and edge.source_node_id in assignments:
                assignments[edge.target_node_id] = assignments[edge.source_node_id]
                changed = True

    return assignments, sector_count


def _node_angles(snapshot: BusinessRequirementsGraphSnapshot) -> dict[str, float]:
    assignments, sector_count = _sector_assignments(snapshot)
    incoming_order: dict[str, tuple[int, str]] = {}
    for edge in sorted(snapshot.edges, key=lambda item: item.id):
        candidate = (edge.display_order, edge.id)
        current = incoming_order.get(edge.target_node_id)
        if current is None or candidate < current:
            incoming_order[edge.target_node_id] = candidate

    nodes_by_group: dict[tuple[int, int], list[RequirementNodeRecord]] = defaultdict(list)
    angles: dict[str, float] = {"BR-000": 0.0}
    for node in snapshot.nodes:
        if node.requirement_id == "BR-000":
            continue
        sector_index = assignments.get(node.requirement_id)
        if sector_index is None:
            angles[node.requirement_id] = (
                2
                * math.pi
                * _stable_unit_interval(f"{INITIAL_LAYOUT_VERSION}:theta:{node.requirement_id}")
            )
            continue
        nodes_by_group[(sector_index, node.derived_min_depth)].append(node)

    sector_span = (2 * math.pi / sector_count) * 0.82
    for (sector_index, _depth), nodes in sorted(nodes_by_group.items()):
        center = 2 * math.pi * sector_index / sector_count
        ordered = sorted(
            nodes,
            key=lambda node: (
                incoming_order.get(node.requirement_id, (0, "")),
                node.requirement_id,
            ),
        )
        if len(ordered) == 1:
            angles[ordered[0].requirement_id] = center
            continue
        for index, node in enumerate(ordered):
            fraction = index / (len(ordered) - 1)
            angles[node.requirement_id] = center - sector_span / 2 + sector_span * fraction
    return angles


def _stored_position(
    node: RequirementNodeRecord,
    dimensions: GraphDimensions,
) -> GraphPosition | None:
    stored = node.stored_position
    if stored.x is None or stored.y is None or (dimensions == 3 and stored.z is None):
        return None
    z = 0.0 if dimensions == 2 else float(stored.z)
    radius = math.sqrt(float(stored.x) ** 2 + float(stored.y) ** 2 + z**2)
    return GraphPosition(
        x=round(float(stored.x), 6),
        y=round(float(stored.y), 6),
        z=round(z, 6),
        radius=round(radius, 6),
        source=NodePositionSource.STORED,
        locked=stored.locked,
    )


def _generated_position(
    node: RequirementNodeRecord,
    angle: float,
    dimensions: GraphDimensions,
) -> GraphPosition:
    radius = semantic_radius(node)
    if dimensions == 2 or radius == 0:
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        z = 0.0
    else:
        unit = _stable_unit_interval(f"{INITIAL_LAYOUT_VERSION}:phi:{node.requirement_id}")
        phi = (unit * 2 - 1) * (math.pi / 8)
        x = radius * math.cos(angle) * math.cos(phi)
        y = radius * math.sin(angle) * math.cos(phi)
        z = radius * math.sin(phi)
    return GraphPosition(
        x=round(x, 6),
        y=round(y, 6),
        z=round(z, 6),
        radius=radius,
        source=NodePositionSource.GENERATED,
        locked=node.requirement_id == "BR-000",
    )


def _graph_node(
    node: RequirementNodeRecord,
    position: GraphPosition,
) -> BusinessRequirementGraphNode:
    return BusinessRequirementGraphNode(
        id=node.requirement_id,
        label=node.name,
        description=node.description,
        requirement_kind=node.requirement_kind,
        origin_kind=node.origin_kind,
        atomic=node.atomic,
        customer_visible=node.customer_visible,
        needs_confirmation=node.needs_confirmation,
        lifecycle_status=node.lifecycle_status,
        priority_order=node.priority_order,
        derived_min_depth=node.derived_min_depth,
        source_proximity_rank=source_proximity_rank(node),
        position=position,
        summary=node.summary,
    )


def build_graph_response(
    snapshot: BusinessRequirementsGraphSnapshot,
    dimensions: GraphDimensions,
) -> BusinessRequirementsGraphResponse:
    angles = _node_angles(snapshot)
    graph_nodes: list[BusinessRequirementGraphNode] = []
    stored_count = 0
    stored_layout_matches = snapshot.view.layout_version == INITIAL_LAYOUT_VERSION
    for node in sorted(snapshot.nodes, key=lambda item: item.requirement_id):
        position = _stored_position(node, dimensions) if stored_layout_matches else None
        if position is None:
            position = _generated_position(node, angles[node.requirement_id], dimensions)
        else:
            stored_count += 1
        graph_nodes.append(_graph_node(node, position))

    if stored_count == 0:
        view_position_source = ViewPositionSource.GENERATED
    elif stored_count == len(graph_nodes):
        view_position_source = ViewPositionSource.STORED
    else:
        view_position_source = ViewPositionSource.MIXED

    edges = sorted(snapshot.edges, key=lambda edge: edge.id)
    return BusinessRequirementsGraphResponse(
        dataset=GraphDatasetMetadata.model_validate(snapshot.dataset.model_dump()),
        view=GraphViewMetadata(
            graph_view_id=snapshot.view.graph_view_id,
            name=snapshot.view.name,
            description=snapshot.view.description,
            dimensions=dimensions,
            layout_version=INITIAL_LAYOUT_VERSION,
            position_source=view_position_source,
            origin_meaning=ORIGIN_MEANING,
            persisted=stored_count == len(graph_nodes),
        ),
        counts=BusinessRequirementsGraphCounts(
            nodes=len(graph_nodes),
            edges=len(edges),
            atomic_requirements=sum(node.atomic for node in snapshot.nodes),
            level_one_requirements=len(_top_level_edges(snapshot)),
            needs_confirmation=sum(node.needs_confirmation for node in snapshot.nodes),
        ),
        nodes=graph_nodes,
        edges=edges,
    )


class BusinessRequirementsQueryService:
    def __init__(self, reader: BusinessRequirementsReader) -> None:
        self._reader = reader

    async def graph(
        self,
        dataset_id: str,
        view_id: str,
        dimensions: GraphDimensions,
    ) -> BusinessRequirementsGraphResponse:
        snapshot = await self._reader.get_graph(dataset_id, view_id)
        return build_graph_response(snapshot, dimensions)

    async def detail(
        self,
        dataset_id: str,
        requirement_id: str,
    ) -> BusinessRequirementDetailResponse:
        detail = await self._reader.get_detail(dataset_id, requirement_id)
        node = detail.requirement
        return BusinessRequirementDetailResponse(
            dataset_id=detail.dataset_id,
            requirement=BusinessRequirementDetailNode(
                id=node.requirement_id,
                label=node.name,
                description=node.description,
                requirement_kind=node.requirement_kind,
                origin_kind=node.origin_kind,
                atomic=node.atomic,
                customer_visible=node.customer_visible,
                needs_confirmation=node.needs_confirmation,
                lifecycle_status=node.lifecycle_status,
                priority_order=node.priority_order,
                derived_min_depth=node.derived_min_depth,
                source_proximity_rank=source_proximity_rank(node),
                summary=node.summary,
                verification_method=node.verification_method,
                source_emphasis=node.source_emphasis,
            ),
            relations=detail.relations,
            aliases=detail.aliases,
            evidence=detail.evidence,
            scopes=detail.scopes,
            acceptance_criteria=detail.acceptance_criteria,
            open_questions=detail.open_questions,
        )

    async def close(self) -> None:
        await self._reader.close()
