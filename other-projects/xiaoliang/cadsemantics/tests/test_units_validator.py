from __future__ import annotations

import pytest

from cadsemantics.attributes import normalize_quantity
from cadsemantics.contracts import (
    ClassAssertion,
    EvidenceBundle,
    EvidenceGrade,
    EvidenceKind,
    EvidenceRef,
    PropertyAssertion,
    PropertyScope,
    SemanticStatus,
    UnitStatus,
)
from cadsemantics.evidence import fuse_evidence, retain_property_conflicts
from cadsemantics.context import resolve_contexts
from cadsemantics.inference import SemanticValidationError, SemanticValidator
from cadsemantics.ontology import builtin_ontology
from cadsemantics.runtime import SemanticRuntime


def test_build_never_assigns_units_to_bare_numeric_text(semantic_sources) -> None:
    snapshot, pattern_graph, _, _ = semantic_sources
    result = SemanticRuntime().build(snapshot, pattern_graph)
    assertions = tuple(
        assertion
        for representation in result.drawing_graph.representations
        for assertion in representation.properties
    )
    assert assertions
    assert all(item.normalized_unit is None for item in assertions)
    assert all(item.unit_status is UnitStatus.NOT_APPLICABLE for item in assertions)
    assert not any(item.property_id == "core.measured_value" for item in assertions)
    bare_numeric_labels = tuple(
        item
        for item in assertions
        if item.property_id == "core.label_text" and item.normalized_value == "1600"
    )
    assert bare_numeric_labels
    assert all(item.normalized_unit is None for item in bare_numeric_labels)


def test_bare_numeric_text_never_acquires_an_engineering_unit() -> None:
    units = builtin_ontology().units
    unresolved = normalize_quantity("1600", units, drawing_unit_status="unknown")
    assert unresolved.normalized_value is None
    assert unresolved.normalized_unit is None
    assert unresolved.unit_status is UnitStatus.UNRESOLVED
    explicit = normalize_quantity("1600 kVA", units, drawing_unit_status="unknown")
    assert explicit.normalized_value is not None
    assert explicit.normalized_unit == "VA"
    assert explicit.unit_status is UnitStatus.EXPLICIT
    dimension = normalize_quantity(
        "10",
        units,
        drawing_unit_status="millimetre",
        dimlfac=2.0,
        allow_drawing_unit=True,
    )
    assert dimension.normalized_value == 20.0
    assert dimension.normalized_unit == "mm"
    assert dimension.unit_status is UnitStatus.DIMENSION_SCALE


def test_validator_rejects_assertion_without_evidence(semantic_sources) -> None:
    snapshot, graph, _, _ = semantic_sources
    contexts = resolve_contexts(snapshot, graph)
    validator = SemanticValidator(snapshot, graph, contexts, builtin_ontology())
    assertion = ClassAssertion.create(
        class_id="generic.TagLabel",
        status=SemanticStatus.SUPPORTED,
        evidence_grade=EvidenceGrade.MODEL_INFERRED,
        evidence=EvidenceBundle.create(),
    )
    with pytest.raises(SemanticValidationError, match="no verifiable evidence"):
        validator.validate_class_assertion(assertion)


def test_validator_rejects_invented_evidence_reference(semantic_sources) -> None:
    snapshot, graph, _, _ = semantic_sources
    contexts = resolve_contexts(snapshot, graph)
    validator = SemanticValidator(snapshot, graph, contexts, builtin_ontology())
    invented = EvidenceRef.create(
        kind=EvidenceKind.PATTERN,
        ref_id="pattern:invented",
        source_snapshot_id=snapshot.snapshot_id,
        source_pattern_graph_id=graph.pattern_graph_id,
    )
    assertion = ClassAssertion.create(
        class_id="generic.TagLabel",
        status=SemanticStatus.SUPPORTED,
        evidence_grade=EvidenceGrade.MODEL_INFERRED,
        evidence=EvidenceBundle.create(supporting=(invented,)),
    )
    with pytest.raises(SemanticValidationError, match="does not exist"):
        validator.validate_class_assertion(assertion)


def test_property_conflicts_retain_every_source_assertion() -> None:
    evidence_ref = EvidenceRef.create(
        kind=EvidenceKind.TEXT,
        ref_id="text:a",
        source_snapshot_id="snapshot:a",
        literal="value",
    )
    evidence = EvidenceBundle.create(supporting=(evidence_ref,))
    assertions = tuple(
        PropertyAssertion.create(
            subject_id="semres:a",
            property_id="core.measured_value",
            normalized_value=value,
            normalized_unit="mm",
            original_literal=str(value),
            applies_to_scope=PropertyScope.REPRESENTATION,
            source_kind="SOURCE_TEXT",
            source_ref=f"text:{value}",
            unit_status=UnitStatus.EXPLICIT,
            status=SemanticStatus.SUPPORTED,
            evidence_grade=EvidenceGrade.SOURCE_DECLARED,
            evidence=evidence,
        )
        for value in (10.0, 20.0)
    )
    retained = retain_property_conflicts(assertions)
    assert len(retained) == 2
    assert all(item.status is SemanticStatus.CONFLICTED for item in retained)


def test_equivalent_normalized_units_do_not_create_a_false_conflict() -> None:
    evidence_ref = EvidenceRef.create(
        kind=EvidenceKind.TEXT,
        ref_id="text:a",
        source_snapshot_id="snapshot:a",
        literal="equivalent quantities",
    )
    evidence = EvidenceBundle.create(supporting=(evidence_ref,))
    assertions = tuple(
        PropertyAssertion.create(
            subject_id="semres:a",
            property_id="core.measured_value",
            normalized_value=1000.0,
            normalized_unit="mm",
            original_literal=literal,
            applies_to_scope=PropertyScope.REPRESENTATION,
            source_kind="SOURCE_TEXT",
            source_ref=literal,
            unit_status=UnitStatus.EXPLICIT,
            status=SemanticStatus.SUPPORTED,
            evidence_grade=EvidenceGrade.SOURCE_DECLARED,
            evidence=evidence,
        )
        for literal in ("1 m", "1000 mm")
    )
    retained = retain_property_conflicts(assertions)
    assert len(retained) == 2
    assert all(item.status is SemanticStatus.SUPPORTED for item in retained)


def test_should_evidence_ratio_uses_the_semantic_profile_threshold() -> None:
    evidence_ref = EvidenceRef.create(
        kind=EvidenceKind.PATTERN,
        ref_id="pattern:a",
        source_snapshot_id="snapshot:a",
    )
    evidence = EvidenceBundle.create(supporting=(evidence_ref,))
    lower_status, _ = fuse_evidence(
        evidence,
        has_required_alternative=True,
        should_declared=True,
        should_match_ratio=0.5,
        minimum_should_ratio=0.4,
    )
    upper_status, _ = fuse_evidence(
        evidence,
        has_required_alternative=True,
        should_declared=True,
        should_match_ratio=0.5,
        minimum_should_ratio=0.6,
    )
    assert lower_status is SemanticStatus.SUPPORTED
    assert upper_status is SemanticStatus.AMBIGUOUS
