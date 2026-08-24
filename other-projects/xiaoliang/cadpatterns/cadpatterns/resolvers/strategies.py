from __future__ import annotations

from dataclasses import dataclass

from cadpatterns.candidates import DetectionContext, ref
from cadpatterns.contracts import (
    PatternEdge,
    PatternInstance,
    PatternStatus,
    ProofGrade,
    ReferenceKind,
    RelationType,
    TraceEvent,
)


RESOLVER_GREEDY_NMS = "greedy_nms"
RESOLVER_NESTED = "nested"
KNOWN_RESOLVERS = (RESOLVER_GREEDY_NMS, RESOLVER_NESTED)


@dataclass(frozen=True, slots=True)
class ResolutionResult:
    instances: tuple[PatternInstance, ...]
    edges: tuple[PatternEdge, ...]
    trace: tuple[TraceEvent, ...]


def _intersection_over_union(
    left: tuple[float, float, float, float] | None,
    right: tuple[float, float, float, float] | None,
) -> float:
    if left is None or right is None:
        return 0.0
    left_min_x, left_min_y, left_max_x, left_max_y = left
    right_min_x, right_min_y, right_max_x, right_max_y = right
    width = max(0.0, min(left_max_x, right_max_x) - max(left_min_x, right_min_x))
    height = max(0.0, min(left_max_y, right_max_y) - max(left_min_y, right_min_y))
    intersection = width * height
    left_area = max(0.0, left_max_x - left_min_x) * max(0.0, left_max_y - left_min_y)
    right_area = max(0.0, right_max_x - right_min_x) * max(0.0, right_max_y - right_min_y)
    union = left_area + right_area - intersection
    return intersection / union if union > 0.0 else 0.0


def _is_alternative(
    left: PatternInstance,
    right: PatternInstance,
    *,
    strategy: str,
    context: DetectionContext,
) -> bool:
    if left.pattern_key == right.pattern_key:
        return True
    overlap = _intersection_over_union(left.bounds, right.bounds)
    threshold = (
        context.profile.nested_overlap_ratio
        if strategy == RESOLVER_NESTED
        else context.profile.nms_overlap_ratio
    )
    return overlap >= threshold


def resolve_candidates(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
    edges: tuple[PatternEdge, ...] = (),
) -> ResolutionResult:
    """Resolve competing detections without dropping a single candidate row."""

    resolution: dict[str, dict[str, object]] = {
        item.detection_id: {
            "status": item.status,
            "conflicts": set(item.conflicts),
            "alternatives": set(item.alternatives),
        }
        for item in instances
    }
    extra_edges: list[PatternEdge] = []
    by_type: dict[str, list[PatternInstance]] = {}
    for item in instances:
        by_type.setdefault(item.pattern_type, []).append(item)
    for pattern_type, values in sorted(by_type.items()):
        strategy = context.spec_for(pattern_type).resolver
        if strategy not in KNOWN_RESOLVERS:
            raise ValueError(
                f"Unknown resolver {strategy!r} declared for {pattern_type!r}; "
                f"known resolvers: {', '.join(KNOWN_RESOLVERS)}"
            )
        ordered = sorted(
            (item for item in values if item.status is PatternStatus.CANDIDATE),
            key=lambda item: (-item.score, item.pattern_key, item.detection_id),
        )
        selected: list[PatternInstance] = []
        for candidate in ordered:
            competing = next(
                (
                    accepted
                    for accepted in selected
                    if _is_alternative(
                        candidate,
                        accepted,
                        strategy=strategy,
                        context=context,
                    )
                ),
                None,
            )
            if competing is None:
                resolution[candidate.detection_id]["status"] = PatternStatus.SUPPORTED
                selected.append(candidate)
                continue
            resolution[candidate.detection_id]["status"] = PatternStatus.SUPPRESSED
            resolution[candidate.detection_id]["conflicts"].add(competing.detection_id)
            resolution[candidate.detection_id]["alternatives"].add(competing.detection_id)
            resolution[competing.detection_id]["conflicts"].add(candidate.detection_id)
            resolution[competing.detection_id]["alternatives"].add(candidate.detection_id)
            if candidate.pattern_key != competing.pattern_key:
                extra_edges.extend(
                    (
                        PatternEdge.create(
                            snapshot_id=context.snapshot.snapshot_id,
                            relation=RelationType.CONFLICTS_WITH,
                            source_pattern_key=candidate.pattern_key,
                            target=ref(
                                context,
                                ReferenceKind.PATTERN,
                                competing.pattern_key,
                            ),
                            proof_grade=ProofGrade.TOLERANCE_DERIVED,
                        ),
                        PatternEdge.create(
                            snapshot_id=context.snapshot.snapshot_id,
                            relation=RelationType.ALTERNATIVE_TO,
                            source_pattern_key=candidate.pattern_key,
                            target=ref(
                                context,
                                ReferenceKind.PATTERN,
                                competing.pattern_key,
                            ),
                            proof_grade=ProofGrade.TOLERANCE_DERIVED,
                        ),
                    )
                )
    resolved = tuple(
        sorted(
            (
                item.resolved(
                    resolution[item.detection_id]["status"],
                    conflicts=tuple(resolution[item.detection_id]["conflicts"]),
                    alternatives=tuple(resolution[item.detection_id]["alternatives"]),
                )
                for item in instances
            ),
            key=lambda item: (
                item.pattern_type,
                item.scope_id,
                item.pattern_key,
                item.detection_id,
            ),
        )
    )
    all_edges = {edge.edge_id: edge for edge in (*edges, *extra_edges)}
    return ResolutionResult(
        instances=resolved,
        edges=tuple(all_edges[key] for key in sorted(all_edges)),
        trace=(
            TraceEvent.create(
                "resolver",
                "pattern-resolver:1.0.0",
                "candidate statuses resolved without deleting candidates",
                (
                    ("candidate_count", len(instances)),
                    (
                        "suppressed_count",
                        sum(item.status is PatternStatus.SUPPRESSED for item in resolved),
                    ),
                ),
            ),
        ),
    )
