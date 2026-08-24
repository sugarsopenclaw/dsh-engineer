from __future__ import annotations

from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import PatternInstance, ReferenceKind
from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceGrade,
    EvidenceKind,
    EvidenceRef,
    PropertyAssertion,
    PropertyScope,
    SemanticRepresentation,
    SemanticStatus,
    UnitStatus,
)
from cadsemantics.ontology import OntologyRegistry


def _feature_property(
    representation: SemanticRepresentation,
    pattern: PatternInstance,
    graph: PatternGraph,
    *,
    feature_name: str,
    property_id: str,
) -> PropertyAssertion | None:
    value = pattern.feature(feature_name)
    if value is None:
        return None
    evidence_ref = EvidenceRef.create(
        kind=EvidenceKind.FEATURE,
        ref_id=pattern.pattern_key,
        source_snapshot_id=graph.snapshot_id,
        source_pattern_graph_id=graph.pattern_graph_id,
        feature_key=feature_name,
        geometry_proof_grade=pattern.proof_grade.value,
        literal=str(value),
    )
    return PropertyAssertion.create(
        subject_id=representation.resolution_id,
        property_id=property_id,
        normalized_value=value,
        normalized_unit=None,
        original_literal=str(value),
        applies_to_scope=PropertyScope.REPRESENTATION,
        source_kind="PATTERN_FEATURE",
        source_ref=pattern.pattern_key,
        unit_status=UnitStatus.NOT_APPLICABLE,
        status=SemanticStatus.SUPPORTED,
        evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
        evidence=EvidenceBundle.create(supporting=(evidence_ref,)),
        geometry_proof_grades=(pattern.proof_grade.value,),
    )


def _label_properties(
    representation: SemanticRepresentation,
    pattern: PatternInstance,
    snapshot: DrawingSnapshot,
) -> tuple[PropertyAssertion, ...]:
    rows = {
        str(occurrence_id): row
        for row, occurrence_id in enumerate(snapshot.texts.occurrence_ids)
    }
    assertions = []
    for member in pattern.members:
        if member.ref.kind is ReferenceKind.TEXT:
            row = rows.get(member.ref.ref_id)
            if row is None:
                continue
            literal = str(snapshot.texts.plain_text[row])
        elif member.ref.kind is ReferenceKind.OCCURRENCE:
            # A block attribute occurrence inside a symbol cluster is the
            # authored tag of that symbol. Plain text rows are deliberately
            # not harvested: L2 emits no label binding onto clusters, so a
            # proximity-based read would be a guess.
            row = rows.get(member.ref.ref_id)
            if row is None or not str(snapshot.texts.block_attribute_value[row]):
                continue
            literal = str(snapshot.texts.plain_text[row]) or str(
                snapshot.texts.block_attribute_value[row]
            )
        else:
            continue
        evidence_ref = EvidenceRef.create(
            kind=EvidenceKind.TEXT,
            ref_id=member.ref.ref_id,
            source_snapshot_id=snapshot.snapshot_id,
            literal=literal,
        )
        assertions.append(
            PropertyAssertion.create(
                subject_id=representation.resolution_id,
                property_id="core.label_text",
                normalized_value=literal,
                normalized_unit=None,
                original_literal=literal,
                applies_to_scope=PropertyScope.REPRESENTATION,
                source_kind="SOURCE_TEXT",
                source_ref=member.ref.ref_id,
                unit_status=UnitStatus.NOT_APPLICABLE,
                status=SemanticStatus.SUPPORTED,
                evidence_grade=EvidenceGrade.SOURCE_DECLARED,
                evidence=EvidenceBundle.create(supporting=(evidence_ref,)),
                geometry_proof_grades=(pattern.proof_grade.value,),
            )
        )
    return tuple(assertions)


def extract_properties(
    representation: SemanticRepresentation,
    pattern: PatternInstance,
    snapshot: DrawingSnapshot,
    graph: PatternGraph,
    ontology: OntologyRegistry,
) -> tuple[PropertyAssertion, ...]:
    values = list(_label_properties(representation, pattern, snapshot))
    for feature_name, property_id in (
        ("rows", "core.row_count"),
        ("columns", "core.column_count"),
    ):
        assertion = _feature_property(
            representation,
            pattern,
            graph,
            feature_name=feature_name,
            property_id=property_id,
        )
        if assertion is not None:
            values.append(assertion)
    for assertion in values:
        ontology.properties.require(assertion.property_id)
    return tuple(sorted(values, key=lambda item: item.assertion_id))

