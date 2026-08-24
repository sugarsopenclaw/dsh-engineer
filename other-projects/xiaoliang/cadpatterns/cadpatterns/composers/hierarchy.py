from __future__ import annotations

from collections import defaultdict

from cadpatterns.candidates import DetectionBatch, DetectionContext, make_candidate, member, ref
from cadpatterns.contracts import (
    DetectorSpec,
    PatternEdge,
    PatternInstance,
    ProofGrade,
    ReferenceKind,
    RelationType,
    ScopeType,
    TraceEvent,
)
from cadpatterns.ontology import (
    GENERIC_REPEATED_MOTIF_GROUP,
    GENERIC_SYMBOL_LIKE_CLUSTER,
)


REPEAT_COMPOSER_SPEC = DetectorSpec(
    detector_id="motif.repeat_group",
    version="1.0.0",
    pattern_type=GENERIC_REPEATED_MOTIF_GROUP,
    summary="Compose signature-confirmed instances into repeated motif groups",
    emits=(GENERIC_REPEATED_MOTIF_GROUP,),
    consumes=(GENERIC_SYMBOL_LIKE_CLUSTER,),
)


def _group_scope(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
):
    occurrence_ids = {
        member_value.ref.ref_id
        for instance in instances
        for member_value in instance.members
        if member_value.ref.kind is ReferenceKind.OCCURRENCE
    }
    choices = [
        scope
        for scope in context.scopes.scopes
        if scope.scope_type in {ScopeType.LAYOUT, ScopeType.DRAWING}
        and occurrence_ids.issubset(set(scope.occurrence_ids))
    ]
    return min(choices, key=lambda scope: (len(scope.occurrence_ids), scope.scope_id))


def _union_bounds(instances: tuple[PatternInstance, ...]):
    values = [item.bounds for item in instances if item.bounds is not None]
    if not values:
        return None
    return (
        min(value[0] for value in values),
        min(value[1] for value in values),
        max(value[2] for value in values),
        max(value[3] for value in values),
    )


def compose_hierarchy(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
    edges: tuple[PatternEdge, ...] = (),
) -> DetectionBatch:
    by_signature: dict[str, dict[str, PatternInstance]] = defaultdict(dict)
    for instance in instances:
        if instance.pattern_type != GENERIC_SYMBOL_LIKE_CLUSTER:
            continue
        signature = instance.feature("geometry_signature")
        if signature is not None:
            current = by_signature[str(signature)].get(instance.pattern_key)
            if current is None or (-instance.score, instance.detection_id) < (
                -current.score,
                current.detection_id,
            ):
                by_signature[str(signature)][instance.pattern_key] = instance
    composed = []
    composed_edges = list(edges)
    for signature, keyed in sorted(by_signature.items()):
        values = tuple(keyed[key] for key in sorted(keyed))
        if len(values) < context.profile.motif_min_instances:
            continue
        scope = _group_scope(context, values)
        group = make_candidate(
            context,
            REPEAT_COMPOSER_SPEC,
            pattern_type=GENERIC_REPEATED_MOTIF_GROUP,
            scope_id=scope.scope_id,
            members=tuple(
                member(
                    context,
                    "motif_instance",
                    ReferenceKind.PATTERN,
                    instance.pattern_key,
                    ordinal=ordinal,
                )
                for ordinal, instance in enumerate(values)
            ),
            proof_grade=ProofGrade.TOLERANCE_DERIVED,
            score=sum(item.score for item in values) / len(values),
            features=(
                ("geometry_signature", signature),
                ("instance_count", len(values)),
            ),
            bounds=_union_bounds(values),
            assumptions=("repeat identity is based on normalized geometry, not authored names",),
        )
        composed.append(group)
        representative = values[0]
        for instance in values:
            composed_edges.extend(
                (
                    PatternEdge.create(
                        snapshot_id=context.snapshot.snapshot_id,
                        relation=RelationType.CONTAINS,
                        source_pattern_key=group.pattern_key,
                        target=ref(context, ReferenceKind.PATTERN, instance.pattern_key),
                        proof_grade=ProofGrade.TOLERANCE_DERIVED,
                    ),
                    PatternEdge.create(
                        snapshot_id=context.snapshot.snapshot_id,
                        relation=RelationType.INSTANCE_OF,
                        source_pattern_key=instance.pattern_key,
                        target=ref(context, ReferenceKind.PATTERN, group.pattern_key),
                        proof_grade=ProofGrade.TOLERANCE_DERIVED,
                    ),
                )
            )
            if instance.pattern_key != representative.pattern_key:
                composed_edges.append(
                    PatternEdge.create(
                        snapshot_id=context.snapshot.snapshot_id,
                        relation=RelationType.REPEATS,
                        source_pattern_key=instance.pattern_key,
                        target=ref(
                            context,
                            ReferenceKind.PATTERN,
                            representative.pattern_key,
                        ),
                        proof_grade=ProofGrade.TOLERANCE_DERIVED,
                    )
                )
    all_instances = tuple(instances) + tuple(composed)
    unique_edges = {edge.edge_id: edge for edge in composed_edges}
    return DetectionBatch(
        instances=tuple(
            sorted(
                all_instances,
                key=lambda item: (
                    item.pattern_type,
                    item.scope_id,
                    item.pattern_key,
                    item.detection_id,
                ),
            )
        ),
        edges=tuple(unique_edges[key] for key in sorted(unique_edges)),
        trace=(
            TraceEvent.create(
                "composer",
                REPEAT_COMPOSER_SPEC.detector_id,
                "signature-confirmed motif groups composed",
                (("group_count", len(composed)),),
            ),
        ),
    )
