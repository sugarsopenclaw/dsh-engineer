from __future__ import annotations

from typing import Any

from cadpatterns.contracts import PatternStatus

from cadtasks.blocks.helpers import (
    graph_evidence,
    highlight_artifact,
    merge_fragment,
    pattern_evidence,
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
    Artifact,
    ArtifactType,
    CapabilityGap,
    Claim,
    ClaimStatus,
)
from cadtasks.evidence import trace_lineage


def _subject_ref(context: BlockContext) -> str | None:
    for name in ("detection_id", "representation_id", "subject_ref"):
        value = context.spec.target.selector(name)
        if value is not None:
            return str(value)
    return None


def locate_by_signature(
    context: BlockContext,
    state: TaskWorkState,
) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Signature lookup requires a resolved scope")
    seed_ref = _subject_ref(context)
    signatures: set[str] = set()
    seed_evidence: set[str] = set()
    if seed_ref in context.facts.detection_index:
        instance = context.facts.detection_index[seed_ref].instance
        signature = instance.feature("geometry_signature")
        if signature is not None:
            signatures.add(str(signature))
        seed_evidence.update(pattern_evidence(instance))
    elif seed_ref in context.facts.resolution_index:
        representation = context.facts.resolution_index[seed_ref].representation
        if representation.geometry_signature is not None:
            signatures.add(representation.geometry_signature)
        seed_evidence.update(semantic_evidence(representation))
    elif seed_ref is not None:
        gap = CapabilityGap.create(
            capability_id="semantic.query",
            missing="subject_ref",
            reason="The selected seed fact is absent from the bound facts.",
            claim_type="SIMILAR_STRUCTURE_SET",
            evidence_refs=graph_evidence(context, state),
        )
        return merge_fragment(state, gaps=(gap,))
    else:
        for bound in scoped_representations(context, state):
            representation = bound.representation
            if representation.geometry_signature is not None:
                signatures.add(representation.geometry_signature)
            seed_evidence.update(semantic_evidence(representation))

    if not signatures:
        gap = CapabilityGap.create(
            capability_id="pattern.signature.lookup",
            missing="pattern.geometry_signature",
            reason="The selected fact has no invariant geometry-signature feature.",
            claim_type="SIMILAR_STRUCTURE_SET",
            evidence_refs=seed_evidence or graph_evidence(context, state),
        )
        return merge_fragment(state, gaps=(gap,))

    matches = {}
    for signature in sorted(signatures):
        outcome = context.capabilities.invoke(
            "pattern.signature.lookup", context.facts, signature
        )
        for bound in outcome.value:
            instance = bound.instance
            if instance.status is not PatternStatus.SUPPORTED:
                continue
            if instance.snapshot_id not in scope.snapshot_ids:
                continue
            if not scope.includes_bounds(instance.bounds):
                continue
            if scope.layout_names and not any(
                context.facts.occurrence_index[member.ref.ref_id].layout_name
                in scope.layout_names
                for member in instance.members
                if member.ref.ref_id in context.facts.occurrence_index
            ):
                continue
            matches[instance.detection_id] = bound
    evidence = {
        *seed_evidence,
        *(
            ref
            for bound in matches.values()
            for ref in pattern_evidence(bound.instance)
        ),
    }
    if not evidence:
        evidence.update(graph_evidence(context, state))
    values = tuple(
        {
            "detection_id": bound.instance.detection_id,
            "pattern_key": bound.instance.pattern_key,
            "pattern_type": bound.instance.pattern_type,
            "snapshot_id": bound.instance.snapshot_id,
            "bounds": bound.instance.bounds,
            "proof_grade": bound.instance.proof_grade.value,
        }
        for bound in sorted(
            matches.values(),
            key=lambda item: (item.source_ordinal, item.instance.detection_id),
        )
    )
    claim = Claim.create(
        task_run_id=context.task_run_id,
        claim_type="SIMILAR_STRUCTURE_SET",
        subject_ref=seed_ref or f"class:{context.spec.target.semantic_class}",
        predicate="shares_geometry_signature",
        value=values,
        scope_ref=scope.scope_id,
        truth_basis=context.spec.truth_basis,
        status=ClaimStatus.PROVEN,
        evidence_refs=evidence,
        derivation_ref="taskblock:query.locate_by_signature@1.0.0",
        source_snapshot_ids=scope.snapshot_ids,
        recipe_id=context.recipe_id,
        recipe_version=context.recipe_version,
        assumptions=(
            "geometry signatures are translation and rotation invariant and length normalized",
        ),
    )
    highlight_items = []
    for bound in matches.values():
        instance = bound.instance
        occurrence_ids = tuple(
            sorted(
                member.ref.ref_id
                for member in instance.members
                if member.ref.ref_id in context.facts.occurrence_index
            )
        )
        if occurrence_ids:
            for occurrence_id in occurrence_ids:
                highlight_items.append(
                    {
                        "snapshot_id": instance.snapshot_id,
                        "source_ref": instance.detection_id,
                        "occurrence_id": occurrence_id,
                        "bounds": context.facts.occurrence_index[occurrence_id].bounds,
                        "viewport": instance.bounds,
                    }
                )
        else:
            highlight_items.append(
                {
                    "snapshot_id": instance.snapshot_id,
                    "source_ref": instance.detection_id,
                    "occurrence_id": None,
                    "bounds": instance.bounds,
                    "viewport": instance.bounds,
                }
            )
    artifact = highlight_artifact(context, highlight_items, evidence)
    return merge_fragment(state, claims=(claim,), artifacts=(artifact,))


def identify_in_region(
    context: BlockContext,
    state: TaskWorkState,
) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Region identification requires a resolved scope")
    values = scoped_representations(context, state)
    evidence = {
        ref
        for bound in values
        for ref in semantic_evidence(bound.representation)
    }
    if not evidence:
        evidence.update(graph_evidence(context, state))
    identified = tuple(
        {
            "representation_id": bound.representation.resolution_id,
            "representation_key": bound.representation.representation_key,
            "semantic_class": bound.representation.semantic_class,
            "representation_mode": bound.representation.representation_mode.value,
            "status": bound.representation.status.value,
            "bounds": bound.representation.bounds,
            "snapshot_id": bound.representation.source_snapshot_id,
        }
        for bound in values
    )
    claim = Claim.create(
        task_run_id=context.task_run_id,
        claim_type="IDENTIFIED_OBJECT_SET",
        subject_ref=f"class:{context.spec.target.semantic_class}",
        predicate="identified_in_scope",
        value=identified,
        scope_ref=scope.scope_id,
        truth_basis=context.spec.truth_basis,
        status=ClaimStatus.SUPPORTED,
        evidence_refs=evidence,
        derivation_ref="taskblock:query.identify_in_region@1.0.0",
        source_snapshot_ids=scope.snapshot_ids,
        recipe_id=context.recipe_id,
        recipe_version=context.recipe_version,
    )
    highlights = highlight_artifact(
        context,
        (
            {
                "snapshot_id": bound.representation.source_snapshot_id,
                "source_ref": bound.representation.resolution_id,
                "occurrence_id": None,
                "bounds": bound.representation.bounds,
                "viewport": bound.representation.bounds,
            }
            for bound in values
        ),
        evidence,
    )
    return merge_fragment(state, claims=(claim,), artifacts=(highlights,))


def describe_object(context: BlockContext, state: TaskWorkState) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Object description requires a resolved scope")
    subject = _subject_ref(context)
    if subject is None and scope.object_refs:
        subject = scope.object_refs[0]
    if subject is None:
        values = scoped_representations(context, state)
        subject = values[0].representation.resolution_id if values else None
    description: dict[str, Any]
    evidence: tuple[str, ...]
    status = ClaimStatus.SUPPORTED
    if subject in context.facts.resolution_index:
        representation = context.facts.resolution_index[subject].representation
        description = {
            "semantic_class": representation.semantic_class,
            "representation_mode": representation.representation_mode.value,
            "properties": tuple(
                {
                    "property_id": item.property_id,
                    "value": item.normalized_value,
                    "unit": item.normalized_unit,
                    "status": item.status.value,
                }
                for item in representation.properties
            ),
            "functional_roles": representation.functional_roles,
            "bounds": representation.bounds,
            "source_pattern_keys": representation.source_pattern_keys,
            "source_detection_ids": representation.source_detection_ids,
        }
        evidence = semantic_evidence(representation)
    elif subject in context.facts.detection_index:
        instance = context.facts.detection_index[subject].instance
        description = {
            "pattern_type": instance.pattern_type,
            "proof_grade": instance.proof_grade.value,
            "status": instance.status.value,
            "features": instance.features,
            "bounds": instance.bounds,
            "member_refs": tuple(member.ref.ref_id for member in instance.members),
        }
        evidence = pattern_evidence(instance)
        status = ClaimStatus.PROVEN
    elif subject in context.facts.occurrence_index:
        occurrence = context.facts.occurrence_index[subject]
        description = {
            "geometry_row": occurrence.geometry_row,
            "bounds": occurrence.bounds,
            "snapshot_id": occurrence.snapshot_id,
        }
        evidence = (occurrence.occurrence_id,)
        status = ClaimStatus.PROVEN
    elif subject in context.facts.project_object_index:
        project_object = context.facts.project_object_index[subject].project_object
        description = {
            "semantic_class": project_object.semantic_class,
            "representation_ids": project_object.representation_ids,
            "source_snapshot_ids": project_object.source_snapshot_ids,
            "status": project_object.status.value,
        }
        evidence = tuple(
            sorted({project_object.project_object_id, *project_object.representation_ids})
        )
    else:
        gap = CapabilityGap.create(
            capability_id="semantic.query",
            missing="subject_ref",
            reason="No selected fact can be described without guessing.",
            claim_type="OBJECT_DESCRIPTION",
            evidence_refs=graph_evidence(context, state),
        )
        return merge_fragment(state, gaps=(gap,))
    claim = Claim.create(
        task_run_id=context.task_run_id,
        claim_type="OBJECT_DESCRIPTION",
        subject_ref=str(subject),
        predicate="described_as",
        value=description,
        scope_ref=scope.scope_id,
        truth_basis=context.spec.truth_basis,
        status=status,
        evidence_refs=evidence,
        derivation_ref="taskblock:query.describe_object@1.0.0",
        source_snapshot_ids=scope.snapshot_ids,
        recipe_id=context.recipe_id,
        recipe_version=context.recipe_version,
    )
    return merge_fragment(state, claims=(claim,))


def trace_evidence(context: BlockContext, state: TaskWorkState) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Evidence tracing requires a resolved scope")
    subject = _subject_ref(context)
    if subject is None and scope.object_refs:
        subject = scope.object_refs[0]
    if subject is None:
        gap = CapabilityGap.create(
            capability_id="semantic.query",
            missing="subject_ref",
            reason="Evidence tracing requires a concrete fact reference.",
            claim_type="EVIDENCE_LINEAGE",
            evidence_refs=graph_evidence(context, state),
        )
        return merge_fragment(state, gaps=(gap,))
    lineage = trace_lineage(context.facts, subject)
    if lineage.unresolved_refs:
        gap = CapabilityGap.create(
            capability_id="semantic.query",
            missing="evidence_lineage",
            reason="One or more lineage references are absent from the bound facts.",
            claim_type="EVIDENCE_LINEAGE",
            evidence_refs=(subject,) if context.facts.has_evidence(subject) else graph_evidence(context, state),
        )
        return merge_fragment(state, gaps=(gap,))
    evidence = tuple(node.ref_id for node in lineage.nodes)
    claim = Claim.create(
        task_run_id=context.task_run_id,
        claim_type="EVIDENCE_LINEAGE",
        subject_ref=subject,
        predicate="traces_to_source_facts",
        value={
            "lineage_id": lineage.lineage_id,
            "node_count": len(lineage.nodes),
            "edge_count": len(lineage.edges),
        },
        scope_ref=scope.scope_id,
        truth_basis=context.spec.truth_basis,
        status=ClaimStatus.PROVEN,
        evidence_refs=evidence,
        derivation_ref="taskblock:query.trace_evidence@1.0.0",
        source_snapshot_ids=scope.snapshot_ids,
        recipe_id=context.recipe_id,
        recipe_version=context.recipe_version,
    )
    artifact = Artifact.create(
        task_run_id=context.task_run_id,
        artifact_type=ArtifactType.EVIDENCE_TRACE,
        media_type="application/vnd.xiaoliang.lineage+json",
        payload={
            "claim_id": claim.claim_id,
            "lineage_id": lineage.lineage_id,
            "root_ref": lineage.root_ref,
            "claim_edges": (
                {
                    "source_ref": claim.claim_id,
                    "target_ref": lineage.root_ref,
                    "relation": "grounded_by",
                },
            ),
            "nodes": lineage.nodes,
            "edges": lineage.edges,
        },
        evidence_refs=evidence,
    )
    return merge_fragment(state, claims=(claim,), artifacts=(artifact,))


def register_query_blocks(registry: TaskBlockRegistry) -> None:
    definitions = (
        (
            "query.locate_by_signature",
            locate_by_signature,
            ("pattern.signature.lookup",),
        ),
        ("query.identify_in_region", identify_in_region, ("semantic.query",)),
        ("query.describe_object", describe_object, ("semantic.query",)),
        ("query.trace_evidence", trace_evidence, ("semantic.query",)),
    )
    for block_id, function, capabilities in definitions:
        registry.register(
            TaskBlockSpec(
                block_id,
                "1.0.0",
                "compute",
                "task_work_state",
                "task_work_state",
                capabilities,
                "read",
                "memory",
                True,
            ),
            function,
        )
