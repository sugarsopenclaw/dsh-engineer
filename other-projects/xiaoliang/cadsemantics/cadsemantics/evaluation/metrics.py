from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Callable

from cadsemantics.contracts import SemanticStatus
from cadsemantics.coverage import semantic_coverage_report
from cadsemantics.graph import DrawingSemanticGraph, SemanticGraphBundle


@dataclass(frozen=True, slots=True)
class DeterminismMetric:
    reproducible: bool
    graph_ids: tuple[str, ...]
    canonical_payloads: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SemanticStabilityMetric:
    comparison_name: str
    jaccard: float
    stable: bool


def deterministic_reproduction(
    builder: Callable[[], SemanticGraphBundle],
) -> DeterminismMetric:
    first = builder()
    second = builder()
    payloads = (first.to_json(), second.to_json())
    ids = (
        first.drawing_graph.drawing_semantic_graph_id,
        second.drawing_graph.drawing_semantic_graph_id,
    )
    return DeterminismMetric(payloads[0] == payloads[1], ids, payloads)


def semantic_fingerprint_multiset(graph: DrawingSemanticGraph) -> Counter[tuple]:
    return Counter(
        (
            item.semantic_class,
            item.representation_mode.value,
            item.status.value,
            tuple(sorted(assertion.property_id for assertion in item.properties)),
            bool(item.geometry_signature),
        )
        for item in graph.representations
    )


def _multiset_jaccard(left: Counter, right: Counter) -> float:
    keys = set(left) | set(right)
    union = sum(max(left[key], right[key]) for key in keys)
    intersection = sum(min(left[key], right[key]) for key in keys)
    return intersection / union if union else 1.0


def semantic_stability(
    reference: DrawingSemanticGraph,
    variant: DrawingSemanticGraph,
    *,
    comparison_name: str,
    minimum_jaccard: float = 1.0,
) -> SemanticStabilityMetric:
    jaccard = _multiset_jaccard(
        semantic_fingerprint_multiset(reference),
        semantic_fingerprint_multiset(variant),
    )
    return SemanticStabilityMetric(comparison_name, jaccard, jaccard >= minimum_jaccard)


def transform_stability(
    reference: DrawingSemanticGraph,
    variant: DrawingSemanticGraph,
    *,
    transform_name: str,
) -> SemanticStabilityMetric:
    return semantic_stability(
        reference,
        variant,
        comparison_name=transform_name,
    )


def scale_stability(
    reference: DrawingSemanticGraph,
    variant: DrawingSemanticGraph,
    *,
    scale_name: str,
) -> SemanticStabilityMetric:
    return semantic_stability(
        reference,
        variant,
        comparison_name=scale_name,
    )


def tolerance_stability(
    reference: DrawingSemanticGraph,
    variant: DrawingSemanticGraph,
    *,
    perturbation_name: str,
    minimum_jaccard: float = 0.8,
) -> SemanticStabilityMetric:
    jaccard = supported_set_jaccard(reference, variant)
    return SemanticStabilityMetric(
        perturbation_name,
        jaccard,
        jaccard >= minimum_jaccard,
    )


def supported_set_jaccard(
    reference: DrawingSemanticGraph,
    variant: DrawingSemanticGraph,
) -> float:
    def values(graph: DrawingSemanticGraph) -> Counter[tuple[str | None, str]]:
        return Counter(
            (item.semantic_class, item.representation_mode.value)
            for item in graph.representations
            if item.status is SemanticStatus.SUPPORTED
        )

    return _multiset_jaccard(values(reference), values(variant))


def context_distribution(graph: DrawingSemanticGraph) -> tuple[tuple[str, str, int], ...]:
    counter = Counter(
        (candidate.value, context.status.value)
        for context in graph.contexts
        for candidate in context.drawing_type_candidates
    )
    return tuple((key[0], key[1], counter[key]) for key in sorted(counter))


def evidence_and_leakage_gate(bundle: SemanticGraphBundle) -> bool:
    report = semantic_coverage_report(bundle.drawing_graph, bundle.project_graph)
    return report.evidence_coverage == 1.0 and report.domain_leakage_rate == 0.0
