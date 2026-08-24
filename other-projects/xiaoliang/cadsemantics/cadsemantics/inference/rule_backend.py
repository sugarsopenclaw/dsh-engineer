from __future__ import annotations

from cadsemantics.inference.port import (
    SemanticEvidencePacket,
    SemanticInferenceResult,
)


class RuleBasedSemanticBackend:
    """Pass through assertions already produced by deterministic mapping specs."""

    @property
    def backend_version(self) -> str:
        return "rule-based:1.0.0"

    def classify_object(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult:
        return SemanticInferenceResult(
            class_assertions=packet.existing_class_assertions,
            abstention_reason=None if packet.existing_class_assertions else "no deterministic class assertion",
        )

    def extract_properties(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult:
        return SemanticInferenceResult(abstention_reason="no rule extractor requested")

    def resolve_relation(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult:
        return SemanticInferenceResult(abstention_reason="no rule relation inference requested")

    def interpret_context(self, packet: SemanticEvidencePacket) -> SemanticInferenceResult:
        return SemanticInferenceResult(abstention_reason="context was resolved deterministically")

