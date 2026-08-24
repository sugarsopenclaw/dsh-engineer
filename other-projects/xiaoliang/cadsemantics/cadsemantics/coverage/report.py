from __future__ import annotations

from dataclasses import dataclass

from cadsemantics.contracts import EvidenceGrade, FailureCode, SemanticStatus
from cadsemantics.graph import DrawingSemanticGraph, ProjectSemanticGraph


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 1.0


@dataclass(frozen=True, slots=True)
class SemanticCoverageReport:
    drawing_semantic_graph_id: str
    pattern_resolution_coverage: float
    class_resolution_coverage: float
    attribute_coverage: float
    relation_coverage: float
    identity_coverage: float
    conflict_count: int
    unknown_pattern_count: int
    unexplained_pattern_keys: tuple[str, ...]
    model_inferred_ratio: float
    human_confirmed_ratio: float
    evidence_coverage: float
    domain_leakage_rate: float


def semantic_coverage_report(
    drawing: DrawingSemanticGraph,
    project: ProjectSemanticGraph,
) -> SemanticCoverageReport:
    resolved = {
        key
        for representation in drawing.representations
        if representation.status in {SemanticStatus.SUPPORTED, SemanticStatus.AMBIGUOUS}
        for key in representation.source_pattern_keys
    }
    all_patterns = set(drawing.source_pattern_keys)
    unexplained = tuple(sorted(all_patterns - resolved))
    supported_representations = tuple(
        item for item in drawing.representations if item.status is SemanticStatus.SUPPORTED
    )
    class_resolved = sum(item.semantic_class is not None for item in supported_representations)
    with_attributes = sum(bool(item.properties) for item in supported_representations)
    related_ids = {
        endpoint
        for relation in drawing.relations
        for endpoint in (relation.source_id, relation.target_id)
    }
    with_relations = sum(item.resolution_id in related_ids for item in supported_representations)
    physical = tuple(
        item for item in supported_representations if item.identity_cluster_id is not None
    )
    graded_assertions = [
        assertion
        for representation in drawing.representations
        for assertion in (*representation.class_assertions, *representation.properties)
    ]
    graded_assertions.extend(drawing.relations)
    graded_assertions.extend(drawing.identity_assertions)
    evidence_bearing = [
        *graded_assertions,
        *(port for representation in drawing.representations for port in representation.ports),
        *drawing.systems,
    ]
    with_evidence = sum(bool(item.evidence.all_refs) for item in evidence_bearing)
    model_inferred = sum(
        item.evidence_grade is EvidenceGrade.MODEL_INFERRED
        for item in graded_assertions
    )
    human_confirmed = sum(
        item.evidence_grade is EvidenceGrade.HUMAN_CONFIRMED
        for item in graded_assertions
    )
    conflicts = sum(
        item.status is SemanticStatus.CONFLICTED
        for representation in drawing.representations
        for item in representation.properties
    ) + sum(bool(cluster.conflicts) for cluster in project.identity_clusters)
    representation_pack = {
        item.resolution_id: item.domain_pack_id for item in drawing.representations
    }
    cross_pack_relations = tuple(
        relation
        for relation in drawing.relations
        if relation.source_id in representation_pack
        and relation.target_id in representation_pack
        and representation_pack[relation.source_id]
        != representation_pack[relation.target_id]
    )
    leaked_relations = sum(
        not relation.relation_type.startswith("core.")
        for relation in cross_pack_relations
    )
    leakage_failures = sum(
        item.code is FailureCode.DOMAIN_LEAKAGE for item in drawing.failures
    )
    leakage_cases = leaked_relations + leakage_failures
    leakage_opportunities = len(cross_pack_relations) + leakage_failures
    return SemanticCoverageReport(
        drawing.drawing_semantic_graph_id,
        _ratio(len(resolved), len(all_patterns)),
        _ratio(class_resolved, len(supported_representations)),
        _ratio(with_attributes, len(supported_representations)),
        _ratio(with_relations, len(supported_representations)),
        _ratio(len(physical), len(supported_representations)),
        conflicts,
        len(unexplained),
        unexplained,
        (
            model_inferred / len(graded_assertions)
            if graded_assertions
            else 0.0
        ),
        (
            human_confirmed / len(graded_assertions)
            if graded_assertions
            else 0.0
        ),
        _ratio(with_evidence, len(evidence_bearing)),
        (
            leakage_cases / leakage_opportunities
            if leakage_opportunities
            else 0.0
        ),
    )
