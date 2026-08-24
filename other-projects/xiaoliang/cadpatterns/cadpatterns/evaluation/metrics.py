from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import hashlib
from typing import Callable

from cadpatterns.contracts import PatternInstance, PatternStatus
from cadpatterns.graph import PatternGraph


@dataclass(frozen=True, slots=True)
class ReproducibilityMetric:
    reproducible: bool
    graph_ids: tuple[str, ...]
    canonical_sha256: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StabilityMetric:
    name: str
    jaccard: float
    stable: bool
    reference_count: int
    comparison_count: int


@dataclass(frozen=True, slots=True)
class CandidateDistribution:
    rows: tuple[tuple[str, str, str, int], ...]


@dataclass(frozen=True, slots=True)
class EvaluationReport:
    reproducibility: ReproducibilityMetric | None
    transform_stability: tuple[StabilityMetric, ...]
    scale_stability: tuple[StabilityMetric, ...]
    tolerance_stability: tuple[StabilityMetric, ...]
    distribution: CandidateDistribution


def deterministic_reproduction(
    builder: Callable[[], PatternGraph],
    *,
    runs: int = 2,
) -> ReproducibilityMetric:
    if runs < 2:
        raise ValueError("Determinism evaluation needs at least two runs")
    graphs = tuple(builder() for _ in range(runs))
    payloads = tuple(graph.to_json().encode("utf-8") for graph in graphs)
    hashes = tuple(hashlib.sha256(payload).hexdigest() for payload in payloads)
    return ReproducibilityMetric(
        reproducible=len(set(payloads)) == 1,
        graph_ids=tuple(graph.pattern_graph_id for graph in graphs),
        canonical_sha256=hashes,
    )


def _structural_descriptor(instance: PatternInstance):
    member_shape = tuple(
        sorted(Counter((member.role, member.ref.kind.value) for member in instance.members).items())
    )
    stable_feature_names = {
        "cell_adjacency_consistent",
        "columns",
        "degree",
        "detection_method",
        "geometry_signature",
        "instance_count",
        "line_count",
        "rows",
        "text_count",
    }
    stable_features = tuple(
        (name, value)
        for name, value in instance.features
        if name in stable_feature_names
    )
    crossing_semantics = tuple(
        sorted(value[1] for value in instance.feature("crossings", ()))
    )
    return (
        instance.pattern_type,
        instance.status.value,
        instance.proof_grade.value,
        member_shape,
        stable_features,
        crossing_semantics,
    )


def structural_fingerprint(graph: PatternGraph) -> Counter:
    return Counter(
        _structural_descriptor(item)
        for item in graph.instances
        if item.status is PatternStatus.SUPPORTED
    )


def _multiset_jaccard(left: Counter, right: Counter) -> float:
    keys = set(left) | set(right)
    intersection = sum(min(left[key], right[key]) for key in keys)
    union = sum(max(left[key], right[key]) for key in keys)
    return intersection / union if union else 1.0


def structural_stability(
    name: str,
    reference: PatternGraph,
    comparison: PatternGraph,
    *,
    minimum_jaccard: float = 1.0,
) -> StabilityMetric:
    left = structural_fingerprint(reference)
    right = structural_fingerprint(comparison)
    jaccard = _multiset_jaccard(left, right)
    return StabilityMetric(
        name=name,
        jaccard=jaccard,
        stable=jaccard >= minimum_jaccard,
        reference_count=sum(left.values()),
        comparison_count=sum(right.values()),
    )


def transform_stability(
    reference: PatternGraph,
    transformed: PatternGraph,
    *,
    transform_name: str,
) -> StabilityMetric:
    return structural_stability(
        f"transform:{transform_name}", reference, transformed, minimum_jaccard=1.0
    )


def scale_stability(
    reference: PatternGraph,
    scaled: PatternGraph,
    *,
    scale_name: str,
) -> StabilityMetric:
    return structural_stability(
        f"scale:{scale_name}", reference, scaled, minimum_jaccard=1.0
    )


def tolerance_stability(
    reference: PatternGraph,
    perturbed: PatternGraph,
    *,
    perturbation_name: str,
    minimum_jaccard: float = 0.8,
) -> StabilityMetric:
    left = Counter(item.pattern_key for item in reference.supported())
    right = Counter(item.pattern_key for item in perturbed.supported())
    jaccard = _multiset_jaccard(left, right)
    return StabilityMetric(
        name=f"tolerance:{perturbation_name}",
        jaccard=jaccard,
        stable=jaccard >= minimum_jaccard,
        reference_count=sum(left.values()),
        comparison_count=sum(right.values()),
    )


def candidate_distribution(graph: PatternGraph) -> CandidateDistribution:
    counts = Counter(
        (item.scope_id, item.pattern_type, item.status.value)
        for item in graph.instances
    )
    return CandidateDistribution(
        rows=tuple(
            (scope_id, pattern_type, status, count)
            for (scope_id, pattern_type, status), count in sorted(counts.items())
        )
    )
