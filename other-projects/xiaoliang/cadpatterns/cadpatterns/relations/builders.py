from __future__ import annotations

from itertools import combinations

import numpy as np

from cadkernel.annotations import resolve_targets
from cadkernel.contracts import Exactness

from cadpatterns.candidates import DetectionContext, ref
from cadpatterns.contracts import (
    PatternEdge,
    PatternInstance,
    ProofGrade,
    ReferenceKind,
    RelationType,
)
from cadpatterns.ontology import (
    GENERIC_ENCLOSURE_CANDIDATE,
    GENERIC_PATH_NETWORK,
    GENERIC_TABLE_GRID,
    GENERIC_TEXT_BLOCK,
)


def _center(bounds: tuple[float, float, float, float]) -> tuple[float, float]:
    min_x, min_y, max_x, max_y = bounds
    return (min_x + max_x) / 2.0, (min_y + max_y) / 2.0


def _contains(
    outer: tuple[float, float, float, float],
    inner: tuple[float, float, float, float],
) -> bool:
    outer_min_x, outer_min_y, outer_max_x, outer_max_y = outer
    inner_min_x, inner_min_y, inner_max_x, inner_max_y = inner
    return (
        outer_min_x <= inner_min_x
        and outer_min_y <= inner_min_y
        and outer_max_x >= inner_max_x
        and outer_max_y >= inner_max_y
    )


def _edge(
    context: DetectionContext,
    relation: RelationType,
    source: PatternInstance,
    target: PatternInstance,
    proof_grade: ProofGrade | None = None,
) -> PatternEdge:
    return PatternEdge.create(
        snapshot_id=context.snapshot.snapshot_id,
        relation=relation,
        source_pattern_key=source.pattern_key,
        target=ref(context, ReferenceKind.PATTERN, target.pattern_key),
        proof_grade=proof_grade or source.proof_grade,
    )


def _face_relations(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
) -> list[PatternEdge]:
    face_instances: dict[str, PatternInstance] = {}
    for instance in instances:
        if instance.pattern_type != GENERIC_ENCLOSURE_CANDIDATE:
            continue
        face_id = instance.feature("face_id")
        if face_id is not None:
            face_instances.setdefault(str(face_id), instance)
    edges: list[PatternEdge] = []
    for face in context.topology.dcel.faces:
        current = face_instances.get(face.face_id)
        if current is None:
            continue
        if face.parent_face_id in face_instances:
            parent = face_instances[face.parent_face_id]
            edges.extend(
                (
                    _edge(context, RelationType.CONTAINS, parent, current),
                    _edge(context, RelationType.INSIDE, current, parent),
                )
            )
        for adjacent_id in face.adjacent_face_ids:
            adjacent = face_instances.get(adjacent_id)
            if adjacent is not None:
                edges.append(
                    _edge(context, RelationType.ADJACENT_TO, current, adjacent)
                )
    return edges


def _label_relations(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
) -> list[PatternEdge]:
    text_blocks = [
        item
        for item in instances
        if item.pattern_type == GENERIC_TEXT_BLOCK and item.bounds is not None
    ]
    targets = [
        item
        for item in instances
        if item.pattern_type in {GENERIC_ENCLOSURE_CANDIDATE, GENERIC_TABLE_GRID}
        and item.bounds is not None
    ]
    edges: list[PatternEdge] = []
    for text in text_blocks:
        containing = [target for target in targets if _contains(target.bounds, text.bounds)]
        if not containing:
            continue
        target = min(
            containing,
            key=lambda item: (
                (item.bounds[2] - item.bounds[0]) * (item.bounds[3] - item.bounds[1]),
                item.pattern_key,
            ),
        )
        edges.append(
            _edge(
                context,
                RelationType.LABELS,
                text,
                target,
                ProofGrade.TOLERANCE_DERIVED,
            )
        )
        text_x, text_y = _center(text.bounds)
        target_x, target_y = _center(target.bounds)
        scope = context.scopes.by_id(text.scope_id)
        tolerance = context.profile.text_line_alignment_ratio * scope.local_frame.scale
        if abs(text_x - target_x) <= tolerance or abs(text_y - target_y) <= tolerance:
            edges.append(
                _edge(
                    context,
                    RelationType.ALIGNED_WITH,
                    text,
                    target,
                    ProofGrade.TOLERANCE_DERIVED,
                )
            )
    return edges


def _network_crossing_relations(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
) -> list[PatternEdge]:
    networks = [item for item in instances if item.pattern_type == GENERIC_PATH_NETWORK]
    crossing_to_networks: dict[str, list[PatternInstance]] = {}
    for network in networks:
        for crossing_id, semantics, _, _ in network.feature("crossings", ()):
            if semantics != "CONNECTED":
                crossing_to_networks.setdefault(crossing_id, []).append(network)
    edges: list[PatternEdge] = []
    for values in crossing_to_networks.values():
        unique = {value.pattern_key: value for value in values}
        for left, right in combinations(
            (unique[key] for key in sorted(unique)),
            2,
        ):
            edges.extend(
                (
                    _edge(context, RelationType.CROSSES, left, right),
                    _edge(context, RelationType.CROSSES, right, left),
                )
            )
    return edges


def _overlaps(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> bool:
    return not (
        left[2] < right[0]
        or left[0] > right[2]
        or left[3] < right[1]
        or left[1] > right[3]
    )


def _leader_source_blocks(
    annotation_id: str,
    text_bounds: tuple[float, float, float, float] | None,
    text_blocks: tuple[PatternInstance, ...],
) -> tuple[PatternInstance, ...]:
    direct = tuple(
        item
        for item in text_blocks
        if any(member.ref.ref_id == annotation_id for member in item.members)
    )
    if direct:
        return direct
    if text_bounds is None:
        return ()
    overlapping = tuple(
        item
        for item in text_blocks
        if item.bounds is not None and _overlaps(item.bounds, text_bounds)
    )
    return tuple(sorted(overlapping, key=lambda item: item.pattern_key))


def _leader_relations(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
) -> list[PatternEdge]:
    text_blocks = tuple(
        item for item in instances if item.pattern_type == GENERIC_TEXT_BLOCK
    )
    patterns_by_occurrence: dict[str, list[PatternInstance]] = {}
    for instance in instances:
        for pattern_member in instance.members:
            if pattern_member.ref.kind is ReferenceKind.OCCURRENCE:
                patterns_by_occurrence.setdefault(
                    pattern_member.ref.ref_id, []
                ).append(instance)
    edges: list[PatternEdge] = []
    annotations = context.snapshot.annotations
    for row, annotation_id_value in enumerate(annotations.occurrence_ids):
        if str(annotations.annotation_kinds[row]).casefold() not in {
            "leader",
            "multileader",
        }:
            continue
        annotation_id = str(annotation_id_value)
        raw_bounds = annotations.text_bounds[row]
        text_bounds = (
            None
            if not np.isfinite(raw_bounds).all()
            else tuple(float(value) for value in raw_bounds)
        )
        sources = _leader_source_blocks(annotation_id, text_bounds, text_blocks)
        if not sources:
            continue
        resolved = resolve_targets(context.snapshot, (annotation_id,)).value
        if resolved is None:
            continue
        for target in resolved.targets:
            if target.target_occurrence_id is None:
                continue
            targets = patterns_by_occurrence.get(target.target_occurrence_id, ())
            proof_grade = (
                ProofGrade.STRUCTURALLY_PROVEN
                if target.exactness is Exactness.EXACT
                else ProofGrade.TOLERANCE_DERIVED
                if target.exactness is Exactness.GRID_SNAPPED
                else ProofGrade.HEURISTIC
            )
            evidence = (
                ref(context, ReferenceKind.ANNOTATION, annotation_id),
                ref(
                    context,
                    ReferenceKind.OCCURRENCE,
                    target.target_occurrence_id,
                ),
            )
            for source in sources:
                for pattern_target in sorted(
                    targets, key=lambda item: item.pattern_key
                ):
                    if pattern_target.pattern_key == source.pattern_key:
                        continue
                    edges.append(
                        PatternEdge.create(
                            snapshot_id=context.snapshot.snapshot_id,
                            relation=RelationType.POINTS_TO,
                            source_pattern_key=source.pattern_key,
                            target=ref(
                                context,
                                ReferenceKind.PATTERN,
                                pattern_target.pattern_key,
                            ),
                            proof_grade=proof_grade,
                            evidence=evidence,
                        )
                    )
    return edges


def build_relations(
    context: DetectionContext,
    instances: tuple[PatternInstance, ...],
    existing: tuple[PatternEdge, ...] = (),
) -> tuple[PatternEdge, ...]:
    edges = list(existing)
    edges.extend(_face_relations(context, instances))
    edges.extend(_label_relations(context, instances))
    edges.extend(_leader_relations(context, instances))
    edges.extend(_network_crossing_relations(context, instances))
    for instance in instances:
        for virtual_id in instance.virtual_geometry_ids:
            edges.append(
                PatternEdge.create(
                    snapshot_id=context.snapshot.snapshot_id,
                    relation=RelationType.DERIVED_FROM,
                    source_pattern_key=instance.pattern_key,
                    target=ref(context, ReferenceKind.VIRTUAL_GEOMETRY, virtual_id),
                    proof_grade=instance.proof_grade,
                )
            )
    proof_rank = {
        ProofGrade.STRUCTURALLY_PROVEN: 0,
        ProofGrade.TOLERANCE_DERIVED: 1,
        ProofGrade.INFERRED_FROM_MISSING_GEOMETRY: 2,
        ProofGrade.HEURISTIC: 3,
    }
    unique: dict[str, PatternEdge] = {}
    for edge in edges:
        current = unique.get(edge.edge_id)
        if current is None or proof_rank[edge.proof_grade] < proof_rank[current.proof_grade]:
            unique[edge.edge_id] = edge
    return tuple(unique[key] for key in sorted(unique))
