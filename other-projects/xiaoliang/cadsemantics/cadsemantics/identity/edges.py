from __future__ import annotations

from itertools import combinations

from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceGrade,
    EvidenceKind,
    EvidenceRef,
    IdentityAssertion,
    IdentityEdgeType,
    RepresentationMode,
    RepresentationIdentityGraph,
    SemanticRepresentation,
    SemanticStatus,
)


_PHYSICAL_MODES = {
    RepresentationMode.INSTANCE_VIEW,
    RepresentationMode.SCHEMATIC_INSTANCE,
    RepresentationMode.AGGREGATED_REPRESENTATION,
}


def _bundle(
    graph: PatternGraph,
    left: SemanticRepresentation,
    right: SemanticRepresentation,
) -> EvidenceBundle:
    instances = {item.pattern_key: item for item in graph.instances}
    evidence = {
        item.evidence_id: item
        for representation in (left, right)
        for assertion in (
            *representation.class_assertions,
            *representation.properties,
        )
        for item in assertion.evidence.all_refs
    }
    for representation in (left, right):
        for key in representation.source_pattern_keys:
            pattern = instances[key]
            pattern_ref = EvidenceRef.create(
                kind=EvidenceKind.PATTERN,
                ref_id=key,
                source_snapshot_id=graph.snapshot_id,
                source_pattern_graph_id=graph.pattern_graph_id,
                geometry_proof_grade=pattern.proof_grade.value,
            )
            evidence[pattern_ref.evidence_id] = pattern_ref
            if representation.geometry_signature is not None:
                signature_ref = EvidenceRef.create(
                    kind=EvidenceKind.FEATURE,
                    ref_id=key,
                    source_snapshot_id=graph.snapshot_id,
                    source_pattern_graph_id=graph.pattern_graph_id,
                    feature_key="geometry_signature",
                    geometry_proof_grade=pattern.proof_grade.value,
                    literal=representation.geometry_signature,
                )
                evidence[signature_ref.evidence_id] = signature_ref
    return EvidenceBundle.create(
        supporting=tuple(evidence[key] for key in sorted(evidence))
    )


def _labels(representation: SemanticRepresentation) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                str(item.normalized_value).strip().casefold()
                for item in representation.properties
                if item.property_id == "core.label_text" and item.normalized_value
            }
        )
    )


def build_identity_assertions(
    representations: tuple[SemanticRepresentation, ...],
    graph: PatternGraph,
) -> tuple[IdentityAssertion, ...]:
    assertions = []
    for left, right in combinations(representations, 2):
        if left.semantic_class is None or right.semantic_class is None:
            continue
        shared_labels = set(_labels(left)).intersection(_labels(right))
        schedule_physical = (
            left.representation_mode is RepresentationMode.SCHEDULE_RECORD
            and right.representation_mode in _PHYSICAL_MODES
            or right.representation_mode is RepresentationMode.SCHEDULE_RECORD
            and left.representation_mode in _PHYSICAL_MODES
        )
        if left.semantic_class != right.semantic_class:
            # A schedule row and the physical representation it names carry
            # different semantic classes by construction (ScheduleRecord vs
            # the component class), so the same-class rules below can never
            # see this pair. A shared authored label is the only cross-class
            # identity signal L1/L2 persist, and it is strong enough to
            # support the merge.
            if schedule_physical and shared_labels:
                assertions.append(
                    IdentityAssertion.create(
                        source_representation_id=left.resolution_id,
                        target_representation_id=right.resolution_id,
                        edge_type=IdentityEdgeType.SAME_OBJECT_SUPPORTED,
                        status=SemanticStatus.SUPPORTED,
                        evidence_grade=EvidenceGrade.MULTI_EVIDENCE_SUPPORTED,
                        evidence=_bundle(graph, left, right),
                    )
                )
            continue
        evidence = _bundle(graph, left, right)
        type_only_representation = (
            left.representation_mode in {RepresentationMode.LEGEND_SYMBOL, RepresentationMode.TYPE_DETAIL}
            or right.representation_mode in {RepresentationMode.LEGEND_SYMBOL, RepresentationMode.TYPE_DETAIL}
        )
        if type_only_representation:
            assertions.append(
                IdentityAssertion.create(
                    source_representation_id=left.resolution_id,
                    target_representation_id=right.resolution_id,
                    edge_type=IdentityEdgeType.REPRESENTS_TYPE,
                    status=SemanticStatus.SUPPORTED,
                    evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                    evidence=evidence,
                )
            )
        different_in_view = (
            left.context_id == right.context_id
            and left.representation_mode in _PHYSICAL_MODES
            and right.representation_mode in _PHYSICAL_MODES
        )
        if different_in_view:
            assertions.append(
                IdentityAssertion.create(
                    source_representation_id=left.resolution_id,
                    target_representation_id=right.resolution_id,
                    edge_type=IdentityEdgeType.DIFFERENT_OBJECT_PROVEN,
                    status=SemanticStatus.SUPPORTED,
                    evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                    evidence=evidence,
                )
            )
        if left.geometry_signature and left.geometry_signature == right.geometry_signature:
            assertions.append(
                IdentityAssertion.create(
                    source_representation_id=left.resolution_id,
                    target_representation_id=right.resolution_id,
                    edge_type=IdentityEdgeType.SAME_TYPE_ONLY,
                    status=SemanticStatus.SUPPORTED,
                    evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                    evidence=evidence,
                )
            )
        if not different_in_view and not type_only_representation and shared_labels:
            assertions.append(
                IdentityAssertion.create(
                    source_representation_id=left.resolution_id,
                    target_representation_id=right.resolution_id,
                    edge_type=(
                        IdentityEdgeType.SAME_OBJECT_SUPPORTED
                        if schedule_physical
                        else IdentityEdgeType.SAME_OBJECT_POSSIBLE
                    ),
                    status=(
                        SemanticStatus.SUPPORTED
                        if schedule_physical
                        else SemanticStatus.AMBIGUOUS
                    ),
                    evidence_grade=(
                        EvidenceGrade.MULTI_EVIDENCE_SUPPORTED
                        if schedule_physical
                        else EvidenceGrade.DETERMINISTIC_RULE_DERIVED
                    ),
                    evidence=evidence,
                )
            )
    return tuple(sorted(assertions, key=lambda item: item.assertion_id))


def build_identity_graph(
    representations: tuple[SemanticRepresentation, ...],
    graph: PatternGraph,
) -> RepresentationIdentityGraph:
    assertions = build_identity_assertions(representations, graph)
    return RepresentationIdentityGraph.create(
        source_snapshot_ids=tuple(item.source_snapshot_id for item in representations),
        representation_ids=tuple(item.resolution_id for item in representations),
        assertions=assertions,
    )
