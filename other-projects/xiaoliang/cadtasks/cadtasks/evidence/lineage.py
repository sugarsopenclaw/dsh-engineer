from __future__ import annotations

from dataclasses import dataclass

from cadkernel.contracts import stable_id

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import ID_LENGTH


@dataclass(frozen=True, slots=True)
class LineageNode:
    ref_id: str
    layer: str
    kind: str
    source_snapshot_id: str | None


@dataclass(frozen=True, slots=True)
class LineageEdge:
    source_ref: str
    target_ref: str
    relation: str


@dataclass(frozen=True, slots=True)
class LineageTrace:
    lineage_id: str
    root_ref: str
    nodes: tuple[LineageNode, ...]
    edges: tuple[LineageEdge, ...]
    unresolved_refs: tuple[str, ...]


def trace_lineage(facts: ProjectFactBundle, root_ref: str) -> LineageTrace:
    nodes: dict[str, LineageNode] = {}
    edges: dict[tuple[str, str, str], LineageEdge] = {}
    unresolved: set[str] = set()
    pending = [str(root_ref)]

    def add_edge(source: str, target: str, relation: str) -> None:
        key = (source, target, relation)
        edges[key] = LineageEdge(source, target, relation)
        if target not in nodes:
            pending.append(target)

    while pending:
        ref = pending.pop()
        if ref in nodes:
            continue
        if ref in facts.resolution_index:
            bound = facts.resolution_index[ref]
            representation = bound.representation
            nodes[ref] = LineageNode(
                ref, "L3", "semantic_representation", representation.source_snapshot_id
            )
            for pattern_key in representation.source_pattern_keys:
                add_edge(ref, pattern_key, "derived_from_pattern")
            for detection_id in representation.source_detection_ids:
                add_edge(ref, detection_id, "resolved_from_detection")
            for assertion in representation.class_assertions:
                for evidence in assertion.evidence.all_refs:
                    add_edge(ref, evidence.evidence_id, "class_evidence")
            for assertion in representation.properties:
                for evidence in assertion.evidence.all_refs:
                    add_edge(ref, evidence.evidence_id, "property_evidence")
            continue
        if ref in facts.representation_key_index:
            values = facts.representation_key_index[ref]
            snapshot_id = values[0].representation.source_snapshot_id if values else None
            nodes[ref] = LineageNode(ref, "L3", "representation_key", snapshot_id)
            for value in values:
                add_edge(ref, value.representation.resolution_id, "resolved_as")
            continue
        if ref in facts.project_object_index:
            bound = facts.project_object_index[ref]
            project_object = bound.project_object
            snapshot_id = project_object.source_snapshot_ids[0] if project_object.source_snapshot_ids else None
            nodes[ref] = LineageNode(ref, "L3", "project_object", snapshot_id)
            for representation_id in project_object.representation_ids:
                add_edge(ref, representation_id, "represented_by")
            for evidence in project_object.evidence.all_refs:
                add_edge(ref, evidence.evidence_id, "identity_evidence")
            continue
        if ref in facts.identity_assertion_index:
            assertion = facts.identity_assertion_index[ref].assertion
            nodes[ref] = LineageNode(ref, "L3", "identity_assertion", None)
            add_edge(ref, assertion.source_representation_id, "identity_endpoint")
            add_edge(ref, assertion.target_representation_id, "identity_endpoint")
            for evidence in assertion.evidence.all_refs:
                add_edge(ref, evidence.evidence_id, "identity_evidence")
            continue
        if ref in facts.semantic_evidence_index:
            evidence = facts.semantic_evidence_index[ref]
            nodes[ref] = LineageNode(
                ref, "L3", f"evidence:{evidence.kind.value}", evidence.source_snapshot_id
            )
            add_edge(ref, evidence.ref_id, "references_fact")
            continue
        if ref in facts.detection_index:
            bound = facts.detection_index[ref]
            instance = bound.instance
            nodes[ref] = LineageNode(ref, "L2", "pattern_detection", instance.snapshot_id)
            add_edge(ref, instance.pattern_key, "has_pattern_key")
            for member in instance.members:
                add_edge(ref, member.ref.ref_id, f"member:{member.role}")
            continue
        if ref in facts.pattern_key_index:
            values = facts.pattern_key_index[ref]
            snapshot_id = values[0].instance.snapshot_id if values else None
            nodes[ref] = LineageNode(ref, "L2", "pattern_key", snapshot_id)
            for value in values:
                add_edge(ref, value.instance.detection_id, "detected_as")
            continue
        if ref in facts.face_index:
            face = facts.face_index[ref]
            nodes[ref] = LineageNode(ref, "L1", "persisted_face", face.snapshot_id)
            for occurrence_id in face.boundary_occurrence_ids:
                add_edge(ref, occurrence_id, "bounded_by")
            continue
        if ref in facts.text_index:
            text = facts.text_index[ref]
            nodes[ref] = LineageNode(ref, "L1", "text_occurrence", text.snapshot_id)
            continue
        if ref in facts.occurrence_index:
            occurrence = facts.occurrence_index[ref]
            nodes[ref] = LineageNode(
                ref, "L1", "geometry_occurrence", occurrence.snapshot_id
            )
            continue
        if ref in facts.evidence_ids:
            nodes[ref] = LineageNode(ref, "fact", "registered_fact", None)
            continue
        unresolved.add(ref)

    ordered_nodes = tuple(nodes[key] for key in sorted(nodes))
    ordered_edges = tuple(edges[key] for key in sorted(edges))
    missing = tuple(sorted(unresolved))
    digest = stable_id(
        "task-evidence-lineage",
        root_ref,
        ordered_nodes,
        ordered_edges,
        missing,
        length=ID_LENGTH,
    )
    return LineageTrace(
        "lineage:" + digest,
        str(root_ref),
        ordered_nodes,
        ordered_edges,
        missing,
    )

