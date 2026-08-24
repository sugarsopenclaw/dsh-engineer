from __future__ import annotations

from cadpatterns.contracts import PatternInstance
from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceKind,
    EvidenceRef,
    SemanticPort,
    SemanticRepresentation,
)


def map_pattern_ports(
    representation: SemanticRepresentation,
    pattern: PatternInstance,
    graph: PatternGraph,
) -> tuple[SemanticPort, ...]:
    raw_ports = pattern.feature("ports", ())
    if not isinstance(raw_ports, (tuple, list)):
        return ()
    evidence_ref = EvidenceRef.create(
        kind=EvidenceKind.FEATURE,
        ref_id=pattern.pattern_key,
        source_snapshot_id=graph.snapshot_id,
        source_pattern_graph_id=graph.pattern_graph_id,
        feature_key="ports",
        geometry_proof_grade=pattern.proof_grade.value,
        literal=str(raw_ports),
    )
    ports = []
    for item in raw_ports:
        if not isinstance(item, (tuple, list)) or not item:
            continue
        ports.append(
            SemanticPort.create(
                owner_representation_id=representation.resolution_id,
                generic_pattern_port_ref=str(item[0]),
                semantic_role="core.connection",
                direction="bidirectional",
                evidence=EvidenceBundle.create(supporting=(evidence_ref,)),
            )
        )
    return tuple(sorted(ports, key=lambda item: item.port_id))

