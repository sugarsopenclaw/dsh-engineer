from __future__ import annotations

from dataclasses import replace

from cadpatterns.contracts import ReferenceKind, RelationType
from cadpatterns.graph import PatternGraph

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceGrade,
    EvidenceKind,
    EvidenceRef,
    RepresentationMode,
    SemanticRelation,
    SemanticRepresentation,
    SemanticStatus,
)


_RELATION_MAP = {
    RelationType.CONTAINS: "core.HAS_PART",
    RelationType.INSIDE: "core.CONTAINED_IN",
    RelationType.ADJACENT_TO: "core.ADJACENT_TO",
    RelationType.ALIGNED_WITH: "core.ALIGNED_WITH",
    RelationType.CONNECTED_TO: "core.CONNECTED_TO",
    RelationType.CROSSES: "core.CROSSES",
    RelationType.LABELS: "core.DESCRIBED_BY",
    RelationType.REPEATS: "core.REPEATS",
    RelationType.INSTANCE_OF: "core.INSTANCE_OF",
    RelationType.CONFLICTS_WITH: "core.CONFLICTS_WITH",
    RelationType.ALTERNATIVE_TO: "core.ALTERNATIVE_TO",
    RelationType.DERIVED_FROM: "core.DERIVED_FROM",
    RelationType.POINTS_TO: "core.POINTS_TO",
}


def _pattern_bundle(graph: PatternGraph, pattern_keys: tuple[str, ...]) -> EvidenceBundle:
    instance_by_key = {item.pattern_key: item for item in graph.instances}
    return EvidenceBundle.create(
        supporting=tuple(
            EvidenceRef.create(
                kind=EvidenceKind.PATTERN,
                ref_id=pattern_key,
                source_snapshot_id=graph.snapshot_id,
                source_pattern_graph_id=graph.pattern_graph_id,
                geometry_proof_grade=instance_by_key[pattern_key].proof_grade.value,
            )
            for pattern_key in sorted(set(pattern_keys))
        )
    )


def map_pattern_relations(
    representations: tuple[SemanticRepresentation, ...],
    graph: PatternGraph,
) -> tuple[SemanticRelation, ...]:
    by_pattern: dict[str, list[SemanticRepresentation]] = {}
    for representation in representations:
        if representation.semantic_class is None:
            continue
        for pattern_key in representation.source_pattern_keys:
            by_pattern.setdefault(pattern_key, []).append(representation)
    relations = []
    for edge in graph.edges:
        relation_type = _RELATION_MAP.get(edge.relation)
        if relation_type is None or edge.target.kind is not ReferenceKind.PATTERN:
            continue
        sources = by_pattern.get(edge.source_pattern_key, ())
        targets = by_pattern.get(edge.target.ref_id, ())
        evidence_ref = EvidenceRef.create(
            kind=EvidenceKind.PATTERN_EDGE,
            ref_id=edge.edge_id,
            source_snapshot_id=graph.snapshot_id,
            source_pattern_graph_id=graph.pattern_graph_id,
            geometry_proof_grade=edge.proof_grade.value,
        )
        for source in sources:
            for target in targets:
                if source.resolution_id == target.resolution_id:
                    continue
                relations.append(
                    SemanticRelation.create(
                        relation_type=relation_type,
                        source_id=source.resolution_id,
                        target_id=target.resolution_id,
                        status=SemanticStatus.SUPPORTED,
                        evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                        evidence=EvidenceBundle.create(supporting=(evidence_ref,)),
                        geometry_proof_grades=(edge.proof_grade.value,),
                    )
                )
    indexed = {item.relation_id: item for item in relations}
    return tuple(indexed[key] for key in sorted(indexed))


def _bounds_contained(
    inner: tuple[float, float, float, float] | None,
    outer: tuple[float, float, float, float] | None,
) -> bool:
    if inner is None or outer is None:
        return False
    return (
        outer[0] <= inner[0]
        and inner[2] <= outer[2]
        and outer[1] <= inner[1]
        and inner[3] <= outer[3]
    )


def _pattern_inside_region(
    graph: PatternGraph,
    source_key: str,
    region_key: str,
) -> bool:
    if source_key == region_key:
        return True
    instances = {item.pattern_key: item for item in graph.instances}
    source = instances[source_key]
    region = instances[region_key]
    if any(
        edge.source_pattern_key == source_key
        and edge.target.kind is ReferenceKind.PATTERN
        and edge.target.ref_id == region_key
        and edge.relation in {RelationType.INSIDE, RelationType.LABELS, RelationType.POINTS_TO}
        for edge in graph.edges
    ):
        return True
    # L2 emits no containment edge from an enclosure to the engineering
    # patterns inside it, and scopes cannot express it either: nothing parents
    # under an ENCLOSURE scope, while merged/gap-bridged enclosures carry a
    # container scope (up to the whole LAYOUT), which would vacuously "contain"
    # the drawing. The persisted world-coordinate bounds are the only honest
    # membership fact: fully contained means part of the region's content.
    # AABB is coarser than polygon containment, but L3 does not keep a second
    # geometry engine, so this is the strongest claim the persisted facts allow.
    return _bounds_contained(source.bounds, region.bounds)


def apply_document_regions(
    representations: tuple[SemanticRepresentation, ...],
    graph: PatternGraph,
) -> tuple[tuple[SemanticRepresentation, ...], tuple[SemanticRelation, ...]]:
    pattern_by_key = {item.pattern_key: item for item in graph.instances}
    regions = tuple(
        item
        for item in representations
        if item.status is SemanticStatus.SUPPORTED
        and item.semantic_class in {
            "documentation.Legend",
            "documentation.Schedule",
            "documentation.DetailReference",
        }
    )
    updated = []
    relations = []
    for representation in representations:
        if (
            representation.domain_pack_id == "documentation_layout"
            or representation.semantic_class is None
        ):
            updated.append(representation)
            continue
        matches = []
        for region in regions:
            for source_key in representation.source_pattern_keys:
                for region_key in region.source_pattern_keys:
                    if _pattern_inside_region(graph, source_key, region_key):
                        matches.append(region)
                        break
        mode = representation.representation_mode
        classes = {item.semantic_class for item in matches}
        if "documentation.Legend" in classes:
            mode = RepresentationMode.LEGEND_SYMBOL
        elif "documentation.Schedule" in classes:
            mode = RepresentationMode.SCHEDULE_RECORD
        elif "documentation.DetailReference" in classes:
            mode = RepresentationMode.TYPE_DETAIL
        current = replace(representation, representation_mode=mode)
        updated.append(current)
        for region in sorted({item.resolution_id: item for item in matches}.values(), key=lambda item: item.resolution_id):
            bundle = _pattern_bundle(
                graph,
                tuple((*current.source_pattern_keys, *region.source_pattern_keys)),
            )
            relations.append(
                SemanticRelation.create(
                    relation_type="core.REFERENCED_IN" if mode in {RepresentationMode.LEGEND_SYMBOL, RepresentationMode.TYPE_DETAIL} else "core.LOCATED_IN",
                    source_id=current.resolution_id,
                    target_id=region.resolution_id,
                    status=SemanticStatus.SUPPORTED,
                    evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                    evidence=bundle,
                    geometry_proof_grades=tuple(
                        sorted(
                            {
                                pattern_by_key[key].proof_grade.value
                                for key in (*current.source_pattern_keys, *region.source_pattern_keys)
                            }
                        )
                    ),
                )
            )
    relation_index = {item.relation_id: item for item in relations}
    return (
        tuple(sorted(updated, key=lambda item: item.resolution_id)),
        tuple(relation_index[key] for key in sorted(relation_index)),
    )


def assemble_spatial_membership(
    representations: tuple[SemanticRepresentation, ...],
    graph: PatternGraph,
) -> tuple[SemanticRelation, ...]:
    pattern_by_key = {item.pattern_key: item for item in graph.instances}
    scope_by_id = {item.scope_id: item for item in graph.scopes}
    spaces = tuple(
        item for item in representations if item.semantic_class == "generic.EnclosedSpace"
    )
    relations = []
    for representation in representations:
        if representation.semantic_class in {None, "generic.EnclosedSpace"}:
            continue
        containers = []
        for space in spaces:
            if any(
                _bounds_contained(
                    pattern_by_key[source].bounds,
                    pattern_by_key[target].bounds,
                )
                for source in representation.source_pattern_keys
                for target in space.source_pattern_keys
            ):
                containers.append(space)
        ordered = tuple(
            sorted(
                containers,
                key=lambda item: (
                    min(
                        len(scope_by_id[pattern_by_key[key].scope_id].occurrence_ids)
                        for key in item.source_pattern_keys
                    ),
                    item.resolution_id,
                ),
            )
        )
        for position, space in enumerate(ordered):
            bundle = _pattern_bundle(
                graph,
                tuple((*representation.source_pattern_keys, *space.source_pattern_keys)),
            )
            relations.append(
                SemanticRelation.create(
                    relation_type="core.PRIMARY_CONTAINMENT" if position == 0 else "core.REFERENCED_IN",
                    source_id=representation.resolution_id,
                    target_id=space.resolution_id,
                    status=SemanticStatus.SUPPORTED,
                    evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                    evidence=bundle,
                )
            )
    indexed = {item.relation_id: item for item in relations}
    return tuple(indexed[key] for key in sorted(indexed))


def attach_relation_ids(
    representations: tuple[SemanticRepresentation, ...],
    relations: tuple[SemanticRelation, ...],
) -> tuple[SemanticRepresentation, ...]:
    by_id: dict[str, list[str]] = {}
    for relation in relations:
        by_id.setdefault(relation.source_id, []).append(relation.relation_id)
        by_id.setdefault(relation.target_id, []).append(relation.relation_id)
    return tuple(
        replace(
            item,
            relation_ids=tuple(sorted(set((*item.relation_ids, *by_id.get(item.resolution_id, ())))))
        )
        for item in representations
    )
