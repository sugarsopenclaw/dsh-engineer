from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from cadsemantics.contracts import IdentityEdgeType, RepresentationMode

from cadtasks.blocks.helpers import (
    graph_evidence,
    merge_fragment,
    scoped_representations,
    semantic_evidence,
)
from cadtasks.blocks.registry import (
    BlockContext,
    TaskBlockRegistry,
    TaskBlockSpec,
    TaskWorkState,
)
from cadtasks.contracts import (
    ApplicabilityStatus,
    AssemblyPolicy,
    Artifact,
    ArtifactType,
    AuditIssue,
    CapabilityGap,
    Claim,
    ClaimStatus,
    ConclusionStatus,
    QuantityBasis,
    Severity,
    TruthBasis,
)


_ALL_BASES = tuple(QuantityBasis)


def _claim_evidence(context: BlockContext, state: TaskWorkState, values: Iterable) -> tuple[str, ...]:
    refs = {
        ref
        for bound in values
        for ref in semantic_evidence(bound.representation)
    }
    return tuple(sorted(refs)) or graph_evidence(context, state)


def _project_objects(context: BlockContext, state: TaskWorkState):
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Physical count requires a resolved scope")
    selected = set(scope.source_ordinals)
    target = context.spec.target.semantic_class

    def in_object_scope(bound) -> bool:
        if not scope.object_refs:
            return True
        project_object = bound.project_object
        direct = {
            project_object.project_object_id,
            *project_object.representation_ids,
        }
        for representation_id in project_object.representation_ids:
            representation_bound = context.facts.resolution_index.get(
                representation_id
            )
            if representation_bound is None:
                continue
            representation = representation_bound.representation
            direct.update(representation.source_pattern_keys)
            direct.update(representation.source_detection_ids)
            direct.update(
                member.ref.ref_id
                for pattern_key in representation.source_pattern_keys
                for pattern_bound in context.facts.pattern_key_index.get(
                    pattern_key, ()
                )
                if pattern_bound.source_ordinal == representation_bound.source_ordinal
                for member in pattern_bound.instance.members
            )
        return bool(direct.intersection(scope.object_refs))

    values = tuple(
        sorted(
            (
                bound
                for bound in context.facts.project_object_index.values()
                if bound.source_ordinal in selected
                and (target == "*" or bound.project_object.semantic_class == target)
                and in_object_scope(bound)
            ),
            key=lambda item: (
                item.source_ordinal,
                item.project_object.project_object_id,
            ),
        )
    )
    if context.spec.assembly_policy is AssemblyPolicy.COUNT_GROUPS:
        return tuple(
            bound
            for bound in values
            if any(
                context.facts.resolution_index[representation_id].representation.representation_mode
                is RepresentationMode.AGGREGATED_REPRESENTATION
                for representation_id in bound.project_object.representation_ids
                if representation_id in context.facts.resolution_index
            )
        )
    return tuple(
        bound
        for bound in values
        if not any(
            context.facts.resolution_index[representation_id].representation.representation_mode
            is RepresentationMode.AGGREGATED_REPRESENTATION
            for representation_id in bound.project_object.representation_ids
            if representation_id in context.facts.resolution_index
        )
    )


def _physical_interval(context: BlockContext, state: TaskWorkState):
    objects = _project_objects(context, state)
    object_ids = tuple(item.project_object.project_object_id for item in objects)
    representation_owner = {
        representation_id: item.project_object.project_object_id
        for item in objects
        for representation_id in item.project_object.representation_ids
    }
    parent = {object_id: object_id for object_id in object_ids}
    members = {object_id: {object_id} for object_id in object_ids}

    def find(value: str) -> str:
        current = value
        while parent[current] != current:
            current = parent[current]
        return current

    different: set[tuple[str, str]] = set()
    possible: set[tuple[str, str]] = set()
    identity_refs: set[str] = set()
    selected_ordinals = set(state.resolved_scope.source_ordinals) if state.resolved_scope else set()
    for bound in context.facts.identity_assertion_index.values():
        if bound.source_ordinal not in selected_ordinals:
            continue
        assertion = bound.assertion
        left = representation_owner.get(assertion.source_representation_id)
        right = representation_owner.get(assertion.target_representation_id)
        if left is None or right is None or left == right:
            continue
        pair = tuple(sorted((left, right)))
        if assertion.edge_type is IdentityEdgeType.DIFFERENT_OBJECT_PROVEN:
            different.add(pair)
        elif assertion.edge_type is IdentityEdgeType.SAME_OBJECT_POSSIBLE:
            possible.add(pair)
        identity_refs.add(assertion.assertion_id)
        identity_refs.update(item.evidence_id for item in assertion.evidence.all_refs)

    for left, right in sorted(possible):
        left_root = find(left)
        right_root = find(right)
        if left_root == right_root:
            continue
        left_members = members[left_root]
        right_members = members[right_root]
        blocked = any(
            tuple(sorted((left_member, right_member))) in different
            for left_member in left_members
            for right_member in right_members
        )
        if blocked:
            continue
        retained, merged = sorted((left_root, right_root))
        parent[merged] = retained
        members[retained] = left_members | right_members
        del members[merged]

    upper = len(object_ids)
    lower = len({find(object_id) for object_id in object_ids})
    evidence = {
        *object_ids,
        *identity_refs,
        *(
            representation_id
            for item in objects
            for representation_id in item.project_object.representation_ids
        ),
    }
    return lower, upper, tuple(sorted(evidence)), len(possible)


def count_by_basis(context: BlockContext, state: TaskWorkState) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Counting requires a resolved scope")
    all_representations = scoped_representations(
        context, state, instance_modes_only=True
    )
    group_representations = tuple(
        bound
        for bound in all_representations
        if bound.representation.representation_mode
        is RepresentationMode.AGGREGATED_REPRESENTATION
    )
    member_representations = tuple(
        bound
        for bound in all_representations
        if bound.representation.representation_mode
        is not RepresentationMode.AGGREGATED_REPRESENTATION
    )
    representations = (
        group_representations
        if context.spec.assembly_policy is AssemblyPolicy.COUNT_GROUPS
        else member_representations
    )
    base_evidence = _claim_evidence(context, state, representations)
    requested = context.spec.quantity_bases or _ALL_BASES
    claims = []
    gaps = []
    table_rows = []

    if group_representations and context.spec.assembly_policy is not AssemblyPolicy.COUNT_GROUPS:
        group_evidence = _claim_evidence(context, state, group_representations)
        group_claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="ASSEMBLY_GROUP_COUNT",
            subject_ref=f"class:{context.spec.target.semantic_class}",
            predicate="count_groups_separately",
            value=len(group_representations),
            unit="group",
            scope_ref=scope.scope_id,
            truth_basis=TruthBasis.DRAWING_EXPRESSION,
            status=ClaimStatus.PROVEN,
            evidence_refs=group_evidence,
            assumptions=("aggregate groups are reported separately from member counts",),
            derivation_ref="taskblock:count.assembly_policy@1.0.0",
            source_snapshot_ids=scope.snapshot_ids,
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        claims.append(group_claim)

    if QuantityBasis.DRAWING_OCCURRENCE in requested:
        value = len(representations)
        claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="DRAWING_OCCURRENCE_COUNT",
            subject_ref=f"class:{context.spec.target.semantic_class}",
            predicate="count",
            value=value,
            unit="occurrence",
            scope_ref=scope.scope_id,
            truth_basis=TruthBasis.DRAWING_EXPRESSION,
            quantity_basis=QuantityBasis.DRAWING_OCCURRENCE,
            status=ClaimStatus.PROVEN,
            evidence_refs=base_evidence,
            derivation_ref="taskblock:count.by_basis@1.0.0",
            source_snapshot_ids=scope.snapshot_ids,
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        claims.append(claim)
        table_rows.append((QuantityBasis.DRAWING_OCCURRENCE.value, value, claim.status.value))

    labels: dict[str, list[tuple[str, tuple[str, ...]]]] = defaultdict(list)
    for bound in representations:
        representation = bound.representation
        for assertion in representation.properties:
            if assertion.property_id != "core.label_text":
                continue
            if assertion.normalized_value is None:
                continue
            label = str(assertion.normalized_value).strip()
            if not label:
                continue
            refs = tuple(item.evidence_id for item in assertion.evidence.all_refs)
            labels[label.casefold()].append((representation.resolution_id, refs))
    labeled_representation_ids = {
        representation_id
        for values in labels.values()
        for representation_id, _ in values
    }
    unlabeled_count = len(representations) - len(labeled_representation_ids)
    tag_evidence = tuple(
        sorted(
            {
                *base_evidence,
                *(
                    ref
                    for values in labels.values()
                    for _, refs in values
                    for ref in refs
                ),
            }
        )
    )
    if QuantityBasis.UNIQUE_TAG in requested:
        unique_value = len(labels)
        unique_claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="UNIQUE_TAG_COUNT",
            subject_ref=f"class:{context.spec.target.semantic_class}",
            predicate="count",
            value=unique_value,
            unit="tag",
            scope_ref=scope.scope_id,
            truth_basis=TruthBasis.DRAWING_EXPRESSION,
            quantity_basis=QuantityBasis.UNIQUE_TAG,
            status=ClaimStatus.SUPPORTED,
            evidence_refs=tag_evidence,
            assumptions=(
                "label coverage includes attached label properties only; nearby independent text remains separate",
            ),
            derivation_ref="taskblock:count.by_basis@1.0.0",
            source_snapshot_ids=scope.snapshot_ids,
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        coverage_value = (
            len(labeled_representation_ids) / len(representations)
            if representations
            else 0
        )
        coverage_claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="TAG_COVERAGE",
            subject_ref=f"class:{context.spec.target.semantic_class}",
            predicate="coverage",
            value={
                "ratio": coverage_value,
                "labeled_representation_count": len(labeled_representation_ids),
                "unlabeled_representation_count": unlabeled_count,
                "total_representation_count": len(representations),
            },
            unit=None,
            scope_ref=scope.scope_id,
            truth_basis=TruthBasis.DRAWING_EXPRESSION,
            quantity_basis=QuantityBasis.UNIQUE_TAG,
            status=ClaimStatus.PROVEN,
            evidence_refs=tag_evidence,
            derivation_ref="taskblock:count.tag_coverage@1.0.0",
            source_snapshot_ids=scope.snapshot_ids,
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        claims.extend((unique_claim, coverage_claim))
        table_rows.append((QuantityBasis.UNIQUE_TAG.value, unique_value, unique_claim.status.value))

    if QuantityBasis.BOM_DECLARED in requested:
        gap = CapabilityGap.create(
            capability_id="schedule.quantity",
            missing="schedule.row_segmentation",
            reason="A table-grid representation is not a row-level declared quantity fact.",
            claim_type="BOM_DECLARED_COUNT",
            data_gap="schedule.row_segmentation",
            evidence_refs=graph_evidence(context, state),
        )
        claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="BOM_DECLARED_COUNT",
            subject_ref=f"class:{context.spec.target.semantic_class}",
            predicate="count",
            value=None,
            unit=None,
            scope_ref=scope.scope_id,
            truth_basis=TruthBasis.BOM_DECLARATION,
            quantity_basis=QuantityBasis.BOM_DECLARED,
            status=ClaimStatus.ABSTAINED,
            evidence_refs=graph_evidence(context, state),
            assumptions=("table row count is not interpreted as a declared item quantity",),
            derivation_ref="taskblock:count.by_basis@1.0.0",
            source_snapshot_ids=scope.snapshot_ids,
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        claims.append(claim)
        gaps.append(gap)
        table_rows.append((QuantityBasis.BOM_DECLARED.value, None, claim.status.value))

    if QuantityBasis.PHYSICAL_INSTANCE in requested:
        lower, upper, physical_evidence, possible_edge_count = _physical_interval(
            context, state
        )
        assumptions = (
            "possible identity edges are not promoted to proven identity",
            f"unresolved_possible_identity_edge_count={possible_edge_count}",
        )
        if len(scope.source_ordinals) > 1:
            lower = 0
            gap = CapabilityGap.create(
                capability_id="identity.cross_file",
                missing="cross_file_identity",
                reason="Independent drawing stores have no proven cross-file identity relation.",
                claim_type="PHYSICAL_INSTANCE_COUNT",
                data_gap="cross_file_identity",
                evidence_refs=physical_evidence or graph_evidence(context, state),
            )
            gaps.append(gap)
            physical_status = ClaimStatus.ABSTAINED
            assumptions = (*assumptions, "the interval includes unresolved cross-file merging")
        else:
            physical_status = ClaimStatus.AMBIGUOUS
        claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="PHYSICAL_INSTANCE_COUNT",
            subject_ref=f"class:{context.spec.target.semantic_class}",
            predicate="count_interval",
            value=None,
            value_interval=(lower, upper),
            unit="instance",
            scope_ref=scope.scope_id,
            truth_basis=TruthBasis.PHYSICAL_REALITY,
            quantity_basis=QuantityBasis.PHYSICAL_INSTANCE,
            status=physical_status,
            evidence_refs=physical_evidence or graph_evidence(context, state),
            assumptions=assumptions,
            derivation_ref="taskblock:count.physical_interval@1.0.0",
            source_snapshot_ids=scope.snapshot_ids,
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        claims.append(claim)
        table_rows.append(
            (
                QuantityBasis.PHYSICAL_INSTANCE.value,
                (lower, upper),
                claim.status.value,
            )
        )

    artifact = Artifact.create(
        task_run_id=context.task_run_id,
        artifact_type=ArtifactType.STRUCTURED_TABLE,
        media_type="application/vnd.xiaoliang.quantity-table+json",
        payload={
            "columns": ("quantity_basis", "value", "status"),
            "rows": tuple(table_rows),
            "assembly_policy": context.spec.assembly_policy.value,
            "group_representations": tuple(
                bound.representation.resolution_id
                for bound in group_representations
            ),
        },
        evidence_refs={ref for claim in claims for ref in claim.evidence_refs},
    )
    return merge_fragment(
        state,
        claims=claims,
        artifacts=(artifact,),
        gaps=gaps,
        records=(("quantity_rows", tuple(table_rows)),),
    )


def reconcile_counts(context: BlockContext, state: TaskWorkState) -> TaskWorkState:
    counted = count_by_basis(context, state)
    claims = tuple(
        claim
        for claim in counted.fragment.claims
        if claim.claim_type.endswith("_COUNT")
    )
    numeric = {
        claim.quantity_basis.value: claim.value
        for claim in claims
        if claim.quantity_basis is not None and isinstance(claim.value, (int, float))
    }
    numeric_values = tuple(numeric.values())
    conflicted = len(set(numeric_values)) > 1
    reconciled_rows = tuple(
        (
            None if claim.quantity_basis is None else claim.quantity_basis.value,
            claim.value,
            claim.value_interval,
            claim.status.value,
        )
        for claim in claims
    )
    evidence = tuple(sorted({ref for claim in claims for ref in claim.evidence_refs}))
    scope = counted.resolved_scope
    if scope is None:
        raise RuntimeError("Count reconciliation requires a resolved scope")
    reconciliation = Claim.create(
        task_run_id=context.task_run_id,
        claim_type="COUNT_RECONCILIATION",
        subject_ref=f"class:{context.spec.target.semantic_class}",
        predicate="reconciles_quantity_bases",
        value=reconciled_rows,
        unit=None,
        scope_ref=scope.scope_id,
        truth_basis=context.spec.truth_basis,
        status=ClaimStatus.CONFLICTED if conflicted else ClaimStatus.SUPPORTED,
        evidence_refs=evidence or graph_evidence(context, counted),
        derivation_ref="taskblock:count.reconcile@1.0.0",
        source_snapshot_ids=scope.snapshot_ids,
        recipe_id=context.recipe_id,
        recipe_version=context.recipe_version,
        rule_ids=("generic.count_reconciliation",),
    )
    issues = []
    if conflicted:
        rule = context.rules.require("generic.count_reconciliation")
        issues.append(
            AuditIssue.create(
                task_run_id=context.task_run_id,
                rule_id=rule.rule_id,
                rule_version=rule.version,
                affected_object_refs=(f"class:{context.spec.target.semantic_class}",),
                observation_claim_ids=tuple(claim.claim_id for claim in claims),
                applicability_status=ApplicabilityStatus.APPLICABLE,
                conclusion_status=ConclusionStatus.OBSERVATION,
                severity=Severity.INFO,
                evidence_refs=evidence or graph_evidence(context, counted),
                recommendation="Review the explicit identity basis and label coverage before using one quantity downstream.",
                source_rule_ref=rule.source_ref,
            )
        )
    return merge_fragment(counted, claims=(reconciliation,), issues=issues)


def register_count_blocks(registry: TaskBlockRegistry) -> None:
    registry.register(
        TaskBlockSpec(
            "count.by_basis",
            "1.0.0",
            "compute",
            "task_work_state",
            "task_work_state",
            ("semantic.query",),
            "read",
            "memory",
            True,
        ),
        count_by_basis,
    )
    registry.register(
        TaskBlockSpec(
            "count.reconcile",
            "1.0.0",
            "compute",
            "task_work_state",
            "task_work_state",
            ("semantic.query",),
            "read",
            "memory",
            True,
        ),
        reconcile_counts,
    )
