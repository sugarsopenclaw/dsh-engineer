from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from cadsemantics.context import DrawingContextHypothesis
from cadsemantics.contracts import (
    ClassAssertion,
    EvidenceRef,
    PropertyAssertion,
    SemanticRelation,
)


@dataclass(frozen=True, slots=True)
class SemanticEvidencePacket:
    representation_id: str
    context: DrawingContextHypothesis
    source_pattern_key: str
    source_pattern_type: str
    source_bounds: tuple[float, float, float, float] | None
    source_features: tuple[tuple[str, object], ...]
    associated_text: tuple[EvidenceRef, ...]
    class_candidates: tuple[str, ...]
    allowed_properties: tuple[str, ...]
    existing_class_assertions: tuple[ClassAssertion, ...] = ()


@dataclass(frozen=True, slots=True)
class SemanticInferenceResult:
    class_assertions: tuple[ClassAssertion, ...] = ()
    property_assertions: tuple[PropertyAssertion, ...] = ()
    relations: tuple[SemanticRelation, ...] = ()
    alternatives: tuple[str, ...] = ()
    abstention_reason: str | None = None


@runtime_checkable
class SemanticInferencePort(Protocol):
    @property
    def backend_version(self) -> str: ...

    def classify_object(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult: ...

    def extract_properties(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult: ...

    def resolve_relation(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult: ...

    def interpret_context(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult: ...

