from __future__ import annotations

from dataclasses import dataclass, replace

from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceKind,
    EvidenceRef,
    IdentityAssertion,
    IdentityCluster,
    ObjectType,
    ProjectObject,
    RepresentationMode,
    SemanticRepresentation,
    SemanticStatus,
)
from cadsemantics.identity.constraints import (
    proven_different_pairs,
    supported_merge_pairs,
)


@dataclass(frozen=True, slots=True)
class IdentityResolution:
    representations: tuple[SemanticRepresentation, ...]
    assertions: tuple[IdentityAssertion, ...]
    clusters: tuple[IdentityCluster, ...]
    project_objects: tuple[ProjectObject, ...]
    object_types: tuple[ObjectType, ...]


class _DisjointSet:
    def __init__(self, values: tuple[str, ...]) -> None:
        self.parent = {value: value for value in values}

    def find(self, value: str) -> str:
        parent = self.parent[value]
        if parent != value:
            self.parent[value] = self.find(parent)
        return self.parent[value]

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[max(left_root, right_root)] = min(left_root, right_root)


def _representation_evidence(
    representation: SemanticRepresentation,
    graph: PatternGraph,
) -> tuple[EvidenceRef, ...]:
    by_key = {item.pattern_key: item for item in graph.instances}
    evidence = {
        item.evidence_id: item
        for assertion in (
            *representation.class_assertions,
            *representation.properties,
        )
        for item in assertion.evidence.all_refs
    }
    for key in representation.source_pattern_keys:
        item = EvidenceRef.create(
            kind=EvidenceKind.PATTERN,
            ref_id=key,
            source_snapshot_id=graph.snapshot_id,
            source_pattern_graph_id=graph.pattern_graph_id,
            geometry_proof_grade=by_key[key].proof_grade.value,
        )
        evidence[item.evidence_id] = item
    return tuple(evidence[key] for key in sorted(evidence))


def resolve_identity(
    representations: tuple[SemanticRepresentation, ...],
    assertions: tuple[IdentityAssertion, ...],
    graph: PatternGraph,
) -> IdentityResolution:
    physical = tuple(
        item
        for item in representations
        if item.semantic_class is not None
        and item.representation_mode
        in {
            RepresentationMode.INSTANCE_VIEW,
            RepresentationMode.SCHEMATIC_INSTANCE,
            RepresentationMode.AGGREGATED_REPRESENTATION,
        }
    )
    disjoint = _DisjointSet(tuple(item.resolution_id for item in physical))
    physical_ids = set(disjoint.parent)
    forbidden = tuple(
        pair
        for pair in proven_different_pairs(assertions)
        if pair[0] in physical_ids and pair[1] in physical_ids
    )
    for left, right in supported_merge_pairs(assertions):
        if left in physical_ids and right in physical_ids:
            left_root = disjoint.find(left)
            right_root = disjoint.find(right)
            if left_root == right_root:
                continue
            if any(
                {
                    disjoint.find(forbidden_left),
                    disjoint.find(forbidden_right),
                }
                == {left_root, right_root}
                for forbidden_left, forbidden_right in forbidden
            ):
                continue
            disjoint.union(left, right)
    groups: dict[str, list[SemanticRepresentation]] = {}
    for representation in physical:
        groups.setdefault(disjoint.find(representation.resolution_id), []).append(representation)
    # Schedule records never cluster on their own: a row that names no
    # physical representation in this snapshot documents an object the
    # drawing does not show. A record attaches to a physical cluster only
    # when every supported merge edge it holds lands in that one cluster;
    # conflicting targets leave it unattached and the assertions stay
    # visible in the identity graph.
    schedule_records = {
        item.resolution_id: item
        for item in representations
        if item.semantic_class is not None
        and item.representation_mode is RepresentationMode.SCHEDULE_RECORD
    }
    attachment_roots: dict[str, set[str]] = {}
    for left, right in supported_merge_pairs(assertions):
        for schedule_id, other in ((left, right), (right, left)):
            if schedule_id in schedule_records and other in physical_ids:
                attachment_roots.setdefault(schedule_id, set()).add(
                    disjoint.find(other)
                )
    attached_by_root: dict[str, list[SemanticRepresentation]] = {}
    for schedule_id in sorted(attachment_roots):
        roots = attachment_roots[schedule_id]
        if len(roots) == 1:
            attached_by_root.setdefault(next(iter(roots)), []).append(
                schedule_records[schedule_id]
            )
    clusters = []
    objects = []
    cluster_by_representation: dict[str, str] = {}
    for root in sorted(groups):
        physical_members = tuple(sorted(groups[root], key=lambda item: item.resolution_id))
        semantic_class = physical_members[0].semantic_class
        if semantic_class is None:
            continue
        members = tuple(
            sorted(
                (*physical_members, *attached_by_root.get(root, ())),
                key=lambda item: item.resolution_id,
            )
        )
        evidence_refs = tuple(
            evidence
            for member in members
            for evidence in _representation_evidence(member, graph)
        )
        cluster = IdentityCluster.create(
            representation_ids=tuple(item.resolution_id for item in members),
            source_snapshot_ids=tuple(item.source_snapshot_id for item in members),
            project_object_class=semantic_class,
            identity_status=SemanticStatus.SUPPORTED,
            supporting_evidence=evidence_refs,
        )
        clusters.append(cluster)
        for member in members:
            cluster_by_representation[member.resolution_id] = cluster.cluster_id
        objects.append(
            ProjectObject.create(
                semantic_class=semantic_class,
                representation_ids=cluster.representation_ids,
                source_snapshot_ids=cluster.source_snapshot_ids,
                functional_roles=tuple(
                    role for member in physical_members for role in member.functional_roles
                ),
                lifecycle_state=physical_members[0].lifecycle_state,
                project_phase=physical_members[0].project_phase,
                evidence=EvidenceBundle.create(supporting=evidence_refs),
            )
        )
    type_groups: dict[tuple[str, str], list[SemanticRepresentation]] = {}
    for representation in representations:
        if representation.semantic_class is None:
            continue
        type_key = representation.geometry_signature or representation.semantic_class
        if representation.geometry_signature or representation.representation_mode in {
            RepresentationMode.LEGEND_SYMBOL,
            RepresentationMode.TYPE_DETAIL,
        }:
            type_groups.setdefault((representation.semantic_class, type_key), []).append(representation)
    object_types = []
    type_by_representation: dict[str, str] = {}
    for key in sorted(type_groups):
        members = tuple(sorted(type_groups[key], key=lambda item: item.resolution_id))
        evidence_refs = tuple(
            evidence
            for member in members
            for evidence in _representation_evidence(member, graph)
        )
        object_type = ObjectType.create(
            semantic_class=key[0],
            representation_ids=tuple(item.resolution_id for item in members),
            properties=tuple(
                assertion
                for member in members
                for assertion in member.properties
                if assertion.applies_to_scope.value == "object_type"
            ),
            status=SemanticStatus.SUPPORTED,
            evidence=EvidenceBundle.create(supporting=evidence_refs),
        )
        object_types.append(object_type)
        for member in members:
            type_by_representation[member.resolution_id] = object_type.object_type_id
    updated = tuple(
        replace(
            item,
            identity_cluster_id=cluster_by_representation.get(item.resolution_id),
            object_type_id=type_by_representation.get(item.resolution_id),
        )
        for item in representations
    )
    object_type_by_representation = type_by_representation
    updated_objects = tuple(
        replace(
            item,
            object_type_id=next(
                (
                    object_type_by_representation[representation_id]
                    for representation_id in item.representation_ids
                    if representation_id in object_type_by_representation
                ),
                None,
            ),
        )
        for item in objects
    )
    return IdentityResolution(
        tuple(sorted(updated, key=lambda item: item.resolution_id)),
        assertions,
        tuple(sorted(clusters, key=lambda item: item.cluster_id)),
        tuple(sorted(updated_objects, key=lambda item: item.project_object_id)),
        tuple(sorted(object_types, key=lambda item: item.object_type_id)),
    )
