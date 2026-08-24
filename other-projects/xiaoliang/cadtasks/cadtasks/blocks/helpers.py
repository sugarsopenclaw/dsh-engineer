from __future__ import annotations

from typing import Any, Iterable

from cadpatterns.contracts import PatternInstance
from cadsemantics.contracts import RepresentationMode, SemanticRepresentation

from cadtasks.binding import BoundRepresentation
from cadtasks.blocks.registry import BlockContext, TaskWorkState
from cadtasks.contracts import (
    Artifact,
    ArtifactType,
    CapabilityGap,
    TaskFragment,
)


INSTANCE_MODES = frozenset(
    {
        RepresentationMode.INSTANCE_VIEW,
        RepresentationMode.SCHEMATIC_INSTANCE,
        RepresentationMode.AGGREGATED_REPRESENTATION,
    }
)


def merge_fragment(
    state: TaskWorkState,
    *,
    claims: Iterable[Any] = (),
    issues: Iterable[Any] = (),
    artifacts: Iterable[Any] = (),
    gaps: Iterable[CapabilityGap] = (),
    records: Iterable[tuple[str, Any]] = (),
) -> TaskWorkState:
    current = state.fragment
    merged_records = dict(current.records)
    merged_records.update(dict(records))
    return state.with_fragment(
        TaskFragment.create(
            claims=(*current.claims, *claims),
            issues=(*current.issues, *issues),
            artifacts=(*current.artifacts, *artifacts),
            gaps=(*current.gaps, *gaps),
            records=merged_records,
        )
    )


def semantic_evidence(representation: SemanticRepresentation) -> tuple[str, ...]:
    refs = {
        representation.resolution_id,
        representation.representation_key,
        *representation.source_pattern_keys,
        *representation.source_detection_ids,
    }
    for assertion in representation.class_assertions:
        refs.update(item.evidence_id for item in assertion.evidence.all_refs)
    for assertion in representation.properties:
        refs.update(item.evidence_id for item in assertion.evidence.all_refs)
    return tuple(sorted(refs))


def pattern_evidence(instance: PatternInstance) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                instance.detection_id,
                instance.pattern_key,
                *(member.ref.ref_id for member in instance.members),
            }
        )
    )


def scoped_representations(
    context: BlockContext,
    state: TaskWorkState,
    *,
    instance_modes_only: bool = False,
) -> tuple[BoundRepresentation, ...]:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Task block requires a resolved scope")
    values = context.facts.representations(
        semantic_class=context.spec.target.semantic_class,
        snapshot_ids=scope.snapshot_ids,
        supported_only=True,
    )
    def in_layout(bound: BoundRepresentation) -> bool:
        if not scope.layout_names:
            return True
        representation = bound.representation
        member_refs = {
            member.ref.ref_id
            for pattern_key in representation.source_pattern_keys
            for pattern_bound in context.facts.pattern_key_index.get(pattern_key, ())
            if pattern_bound.source_ordinal == bound.source_ordinal
            for member in pattern_bound.instance.members
        }
        return any(
            context.facts.occurrence_index[ref].layout_name in scope.layout_names
            for ref in member_refs
            if ref in context.facts.occurrence_index
        )

    def in_object_refs(bound: BoundRepresentation) -> bool:
        if not scope.object_refs:
            return True
        representation = bound.representation
        direct_refs = {
            representation.resolution_id,
            representation.representation_key,
            *representation.source_pattern_keys,
            *representation.source_detection_ids,
            *(
                member.ref.ref_id
                for pattern_key in representation.source_pattern_keys
                for pattern_bound in context.facts.pattern_key_index.get(
                    pattern_key, ()
                )
                if pattern_bound.source_ordinal == bound.source_ordinal
                for member in pattern_bound.instance.members
            ),
        }
        if direct_refs.intersection(scope.object_refs):
            return True
        return any(
            project_object.project_object.project_object_id in scope.object_refs
            and representation.resolution_id
            in project_object.project_object.representation_ids
            for project_object in context.facts.project_object_index.values()
        )

    return tuple(
        bound
        for bound in values
        if scope.includes_bounds(bound.representation.bounds)
        and in_layout(bound)
        and in_object_refs(bound)
        and (
            not instance_modes_only
            or bound.representation.representation_mode in INSTANCE_MODES
        )
    )


def graph_evidence(context: BlockContext, state: TaskWorkState) -> tuple[str, ...]:
    scope = state.resolved_scope
    selected = (
        range(len(context.facts.sources))
        if scope is None
        else scope.source_ordinals
    )
    return tuple(
        sorted(
            context.facts.sources[index].source.drawing_semantic_graph_id
            for index in selected
        )
    )


def highlight_artifact(
    context: BlockContext,
    items: Iterable[dict[str, Any]],
    evidence_refs: Iterable[str],
) -> Artifact:
    ordered = tuple(
        sorted(
            items,
            key=lambda item: (
                str(item.get("snapshot_id", "")),
                str(item.get("source_ref", "")),
                str(item.get("occurrence_id", "")),
            ),
        )
    )
    return Artifact.create(
        task_run_id=context.task_run_id,
        artifact_type=ArtifactType.SOURCE_HIGHLIGHTS,
        media_type="application/vnd.xiaoliang.highlight+json",
        payload={"items": ordered},
        evidence_refs=evidence_refs,
    )
