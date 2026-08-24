from __future__ import annotations

from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceKind,
    EvidenceRef,
    SemanticRepresentation,
    SemanticStatus,
    SemanticSystem,
)


def assemble_systems(
    representations: tuple[SemanticRepresentation, ...],
    graph: PatternGraph,
) -> tuple[SemanticSystem, ...]:
    systems = []
    by_pattern: dict[str, list[SemanticRepresentation]] = {}
    for representation in representations:
        for pattern_key in representation.source_pattern_keys:
            by_pattern.setdefault(pattern_key, []).append(representation)
    for representation in representations:
        if representation.semantic_class != "generic.DistributionNetwork":
            continue
        related_pattern_keys = set(representation.source_pattern_keys)
        related_edges = tuple(
            edge
            for edge in graph.edges
            if edge.source_pattern_key in representation.source_pattern_keys
            or edge.target.ref_id in representation.source_pattern_keys
        )
        for edge in related_edges:
            if edge.source_pattern_key in representation.source_pattern_keys:
                related_pattern_keys.add(edge.target.ref_id)
            if edge.target.ref_id in representation.source_pattern_keys:
                related_pattern_keys.add(edge.source_pattern_key)
        members = {
            item.resolution_id
            for pattern_key in related_pattern_keys
            for item in by_pattern.get(pattern_key, ())
            if item.status is SemanticStatus.SUPPORTED
        }
        pattern_refs = tuple(
            EvidenceRef.create(
                kind=EvidenceKind.PATTERN,
                ref_id=pattern_key,
                source_snapshot_id=graph.snapshot_id,
                source_pattern_graph_id=graph.pattern_graph_id,
                geometry_proof_grade=next(
                    item.proof_grade.value
                    for item in graph.instances
                    if item.pattern_key == pattern_key
                ),
            )
            for pattern_key in representation.source_pattern_keys
        )
        edge_refs = tuple(
            EvidenceRef.create(
                kind=EvidenceKind.PATTERN_EDGE,
                ref_id=edge.edge_id,
                source_snapshot_id=graph.snapshot_id,
                source_pattern_graph_id=graph.pattern_graph_id,
                geometry_proof_grade=edge.proof_grade.value,
            )
            for edge in related_edges
        )
        systems.append(
            SemanticSystem.create(
                semantic_class="generic.DistributionNetwork",
                member_ids=tuple(sorted(members or {representation.resolution_id})),
                source_network_refs=representation.source_pattern_keys,
                status=SemanticStatus.SUPPORTED,
                evidence=EvidenceBundle.create(
                    supporting=(*pattern_refs, *edge_refs),
                ),
            )
        )
    return tuple(sorted(systems, key=lambda item: item.system_id))
