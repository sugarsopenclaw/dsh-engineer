from __future__ import annotations

from dataclasses import dataclass

from cadkernel.contracts import stable_id
from cadkernel.ir import DrawingSnapshot
from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import EvidenceKind, EvidenceRef, SemanticStatus


@dataclass(frozen=True, slots=True)
class RankedContextValue:
    value: str
    ranking_score: float
    evidence_refs: tuple[EvidenceRef, ...]


@dataclass(frozen=True, slots=True)
class DrawingContextHypothesis:
    context_id: str
    source_snapshot_id: str
    scope_id: str
    bounds: tuple[float, float, float, float]
    discipline_candidates: tuple[RankedContextValue, ...]
    drawing_type_candidates: tuple[RankedContextValue, ...]
    representation_conventions: tuple[str, ...]
    phase_candidates: tuple[RankedContextValue, ...]
    source_evidence: tuple[EvidenceRef, ...]
    status: SemanticStatus

    def __post_init__(self) -> None:
        if not self.context_id.startswith("context:"):
            raise ValueError("Context id must use context:<64hex>")

    @classmethod
    def create(
        cls,
        *,
        source_snapshot_id: str,
        scope_id: str,
        bounds: tuple[float, float, float, float],
        disciplines: tuple[RankedContextValue, ...],
        drawing_types: tuple[RankedContextValue, ...],
        representation_conventions: tuple[str, ...],
        phases: tuple[RankedContextValue, ...],
        source_evidence: tuple[EvidenceRef, ...],
        status: SemanticStatus,
    ) -> "DrawingContextHypothesis":
        evidence = tuple(
            {item.evidence_id: item for item in source_evidence}[key]
            for key in sorted({item.evidence_id: item for item in source_evidence})
        )
        digest = stable_id(
            "drawing-context",
            source_snapshot_id,
            scope_id,
            tuple(item.value for item in disciplines),
            tuple(item.value for item in drawing_types),
            representation_conventions,
            tuple(item.evidence_id for item in evidence),
            length=64,
        )
        return cls(
            "context:" + digest,
            source_snapshot_id,
            scope_id,
            tuple(float(item) for item in bounds),
            disciplines,
            drawing_types,
            tuple(sorted(set(representation_conventions))),
            phases,
            evidence,
            status,
        )


def pattern_evidence(graph: PatternGraph, pattern_key: str) -> EvidenceRef:
    instance = next(item for item in graph.instances if item.pattern_key == pattern_key)
    return EvidenceRef.create(
        kind=EvidenceKind.PATTERN,
        ref_id=pattern_key,
        source_snapshot_id=graph.snapshot_id,
        source_pattern_graph_id=graph.pattern_graph_id,
        geometry_proof_grade=instance.proof_grade.value,
    )


def text_evidence(snapshot: DrawingSnapshot, row: int) -> EvidenceRef:
    return EvidenceRef.create(
        kind=EvidenceKind.TEXT,
        ref_id=str(snapshot.texts.occurrence_ids[row]),
        source_snapshot_id=snapshot.snapshot_id,
        literal=str(snapshot.texts.plain_text[row]),
    )

