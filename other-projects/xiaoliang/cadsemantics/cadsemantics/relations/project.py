from __future__ import annotations

from cadsemantics.contracts import (
    EvidenceGrade,
    ProjectObject,
    SemanticRelation,
    SemanticSystem,
)


def _representation_to_object(
    project_objects: tuple[ProjectObject, ...],
) -> dict[str, str]:
    return {
        representation_id: item.project_object_id
        for item in project_objects
        for representation_id in item.representation_ids
    }


def lift_project_relations(
    drawing_relations: tuple[SemanticRelation, ...],
    project_objects: tuple[ProjectObject, ...],
) -> tuple[SemanticRelation, ...]:
    object_by_representation = _representation_to_object(project_objects)
    lifted = []
    for relation in drawing_relations:
        source = object_by_representation.get(relation.source_id)
        target = object_by_representation.get(relation.target_id)
        if source is None or target is None or source == target:
            continue
        lifted.append(
            SemanticRelation.create(
                relation_type=relation.relation_type,
                source_id=source,
                target_id=target,
                properties=relation.properties,
                status=relation.status,
                evidence_grade=relation.evidence_grade,
                evidence=relation.evidence,
                geometry_proof_grades=relation.geometry_proof_grades,
            )
        )
    for project_object in project_objects:
        if project_object.object_type_id is None:
            continue
        lifted.append(
            SemanticRelation.create(
                relation_type="core.HAS_TYPE",
                source_id=project_object.project_object_id,
                target_id=project_object.object_type_id,
                status=project_object.status,
                evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
                evidence=project_object.evidence,
            )
        )
    indexed = {item.relation_id: item for item in lifted}
    return tuple(indexed[key] for key in sorted(indexed))


def lift_project_systems(
    drawing_systems: tuple[SemanticSystem, ...],
    project_objects: tuple[ProjectObject, ...],
) -> tuple[SemanticSystem, ...]:
    object_by_representation = _representation_to_object(project_objects)
    systems = []
    for system in drawing_systems:
        members = tuple(
            sorted(
                {
                    object_by_representation[item]
                    for item in system.member_ids
                    if item in object_by_representation
                }
            )
        )
        if not members:
            continue
        systems.append(
            SemanticSystem.create(
                semantic_class=system.semantic_class,
                member_ids=members,
                source_network_refs=system.source_network_refs,
                properties=system.properties,
                status=system.status,
                evidence=system.evidence,
            )
        )
    return tuple(sorted(systems, key=lambda item: item.system_id))

