from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import ReferenceKind
from cadpatterns.graph import PatternGraph

from cadsemantics.context import DrawingContextHypothesis
from cadsemantics.contracts import (
    ClassAssertion,
    EvidenceBundle,
    EvidenceKind,
    EvidenceRef,
    FailureCode,
    IdentityAssertion,
    PropertyAssertion,
    SemanticFailure,
    SemanticPort,
    SemanticRelation,
    SemanticSystem,
)
from cadsemantics.ontology import OntologyRegistry


@dataclass(frozen=True, slots=True)
class SemanticValidationError(ValueError):
    failure: SemanticFailure

    def __str__(self) -> str:
        return self.failure.message


class SemanticValidator:
    def __init__(
        self,
        snapshot: DrawingSnapshot,
        graph: PatternGraph,
        contexts: Iterable[DrawingContextHypothesis],
        ontology: OntologyRegistry,
    ) -> None:
        self.snapshot = snapshot
        self.graph = graph
        self.contexts = tuple(contexts)
        self.ontology = ontology
        self._occurrences = {
            str(item) for item in snapshot.occurrences.occurrence_ids
        } | {str(item) for item in snapshot.geometry.occurrence_ids}
        self._texts = {str(item) for item in snapshot.texts.occurrence_ids}
        self._annotations = {str(item) for item in snapshot.annotations.occurrence_ids}
        self._patterns = {item.pattern_key: item for item in graph.instances}
        self._detections = {item.detection_id for item in graph.instances}
        self._edges = {item.edge_id for item in graph.edges}
        self._faces = {
            member.ref.ref_id
            for item in graph.instances
            for member in item.members
            if member.ref.kind is ReferenceKind.FACE
        }
        self._layouts = {
            scope.source_ref for scope in graph.scopes if scope.source_ref is not None
        } | {str(item) for item in snapshot.occurrences.layout_names}
        self._context_ids = {item.context_id for item in self.contexts}

    def _reject(self, subject_id: str, message: str, refs: Iterable[EvidenceRef] = ()) -> None:
        raise SemanticValidationError(
            SemanticFailure.create(
                FailureCode.MODEL_UNSUPPORTED_ASSERTION,
                subject_id,
                message,
                refs,
            )
        )

    def validate_evidence_ref(self, evidence: EvidenceRef) -> None:
        if evidence.source_snapshot_id != self.snapshot.snapshot_id:
            self._reject(evidence.evidence_id, "Evidence references another snapshot", (evidence,))
        if evidence.source_pattern_graph_id not in {None, self.graph.pattern_graph_id}:
            self._reject(evidence.evidence_id, "Evidence references another PatternGraph", (evidence,))
        valid = False
        if evidence.kind is EvidenceKind.OCCURRENCE:
            valid = evidence.ref_id in self._occurrences
        elif evidence.kind is EvidenceKind.TEXT:
            valid = evidence.ref_id in self._texts
        elif evidence.kind is EvidenceKind.ANNOTATION:
            valid = evidence.ref_id in self._annotations
        elif evidence.kind is EvidenceKind.FACE:
            valid = evidence.ref_id in self._faces
        elif evidence.kind is EvidenceKind.PATTERN:
            valid = evidence.ref_id in self._patterns
        elif evidence.kind is EvidenceKind.DETECTION:
            valid = evidence.ref_id in self._detections
        elif evidence.kind is EvidenceKind.FEATURE:
            pattern = self._patterns.get(evidence.ref_id)
            valid = pattern is not None and evidence.feature_key is not None and any(
                name == evidence.feature_key for name, _ in pattern.features
            )
        elif evidence.kind is EvidenceKind.PATTERN_EDGE:
            valid = evidence.ref_id in self._edges
        elif evidence.kind is EvidenceKind.LAYOUT:
            valid = evidence.ref_id in self._layouts
        elif evidence.kind is EvidenceKind.CONTEXT:
            valid = evidence.ref_id in self._context_ids
        if not valid:
            self._reject(evidence.evidence_id, f"Evidence source does not exist: {evidence.kind.value}:{evidence.ref_id}", (evidence,))

    def validate_bundle(self, subject_id: str, bundle: EvidenceBundle) -> None:
        references = bundle.all_refs
        if not references:
            self._reject(subject_id, "Semantic assertion has no verifiable evidence")
        for evidence in references:
            self.validate_evidence_ref(evidence)

    def validate_class_assertion(self, assertion: ClassAssertion) -> None:
        try:
            self.ontology.classes.require(assertion.class_id)
        except ValueError as error:
            self._reject(assertion.assertion_id, str(error), assertion.evidence.all_refs)
        self.validate_bundle(assertion.assertion_id, assertion.evidence)

    def validate_property_assertion(
        self,
        assertion: PropertyAssertion,
        *,
        semantic_class: str | None = None,
    ) -> None:
        try:
            definition = self.ontology.properties.require(assertion.property_id)
        except ValueError as error:
            self._reject(assertion.assertion_id, str(error), assertion.evidence.all_refs)
        if assertion.applies_to_scope not in definition.allowed_scopes:
            self._reject(assertion.assertion_id, "Property assertion uses an invalid scope", assertion.evidence.all_refs)
        if (
            semantic_class is not None
            and definition.applies_to
            and semantic_class not in definition.applies_to
        ):
            self._reject(
                assertion.assertion_id,
                f"Property {assertion.property_id} does not apply to {semantic_class}",
                assertion.evidence.all_refs,
            )
        self.validate_bundle(assertion.assertion_id, assertion.evidence)

    def validate_relation(
        self,
        relation: SemanticRelation,
        *,
        endpoint_ids: Iterable[str] | None = None,
    ) -> None:
        try:
            self.ontology.relations.require(relation.relation_type)
        except ValueError as error:
            self._reject(relation.relation_id, str(error), relation.evidence.all_refs)
        if endpoint_ids is not None:
            allowed = set(endpoint_ids)
            if relation.source_id not in allowed or relation.target_id not in allowed:
                self._reject(
                    relation.relation_id,
                    "Semantic relation references an unknown endpoint",
                    relation.evidence.all_refs,
                )
        self.validate_bundle(relation.relation_id, relation.evidence)

    def validate_identity_assertion(
        self,
        assertion: IdentityAssertion,
        *,
        representation_ids: Iterable[str] | None = None,
    ) -> None:
        if representation_ids is not None:
            allowed = set(representation_ids)
            if (
                assertion.source_representation_id not in allowed
                or assertion.target_representation_id not in allowed
            ):
                self._reject(
                    assertion.assertion_id,
                    "Identity assertion references an unknown representation",
                    assertion.evidence.all_refs,
                )
        self.validate_bundle(assertion.assertion_id, assertion.evidence)

    def validate_port(
        self,
        port: SemanticPort,
        *,
        owner_ids: Iterable[str],
    ) -> None:
        if port.owner_representation_id not in set(owner_ids):
            self._reject(
                port.port_id,
                "Semantic port references an unknown owner",
                port.evidence.all_refs,
            )
        self.ontology.roles.require(port.semantic_role)
        self.validate_bundle(port.port_id, port.evidence)

    def validate_system(
        self,
        system: SemanticSystem,
        *,
        member_ids: Iterable[str],
    ) -> None:
        allowed = set(member_ids)
        if any(item not in allowed for item in system.member_ids):
            self._reject(
                system.system_id,
                "Semantic system references an unknown member",
                system.evidence.all_refs,
            )
        self.ontology.classes.require(system.semantic_class)
        self.validate_bundle(system.system_id, system.evidence)
