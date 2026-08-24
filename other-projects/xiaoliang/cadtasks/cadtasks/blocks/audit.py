from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import math
from typing import Any, Mapping

from cadtasks.binding import BoundRepresentation
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
    Artifact,
    ArtifactType,
    AuditIssue,
    CapabilityGap,
    Claim,
    ClaimStatus,
    ConclusionStatus,
    Severity,
)


@dataclass(frozen=True, slots=True)
class AreaObservation:
    value: float
    unit: str
    evidence_refs: tuple[str, ...]
    assumptions: tuple[str, ...]
    source_kind: str


def _area_observation(
    context: BlockContext,
    bound: BoundRepresentation,
) -> AreaObservation | None:
    representation = bound.representation
    pattern_values: dict[float, set[str]] = {}
    for pattern_key in representation.source_pattern_keys:
        for pattern_bound in context.facts.pattern_key_index.get(pattern_key, ()):
            if pattern_bound.source_ordinal != bound.source_ordinal:
                continue
            instance = pattern_bound.instance
            value = instance.feature("area")
            if value is None:
                continue
            numeric = float(value)
            if not math.isfinite(numeric):
                continue
            pattern_values.setdefault(numeric, set()).update(
                {
                    instance.pattern_key,
                    instance.detection_id,
                    *(member.ref.ref_id for member in instance.members),
                }
            )
    if len(pattern_values) == 1:
        value, refs = next(iter(pattern_values.items()))
        source = context.facts.source(bound.source_ordinal)
        return AreaObservation(
            value,
            f"{source.snapshot.unit_status}^2",
            tuple(sorted({*refs, *semantic_evidence(representation)})),
            ("area is read from the supported L2 enclosure feature",),
            "pattern.area",
        )
    if len(pattern_values) > 1:
        return None
    if representation.bounds is None:
        return None
    source = context.facts.source(bound.source_ordinal)
    outcome = context.capabilities.invoke(
        "topology.query_faces",
        source,
        representation.bounds,
    )
    batch = outcome.value
    if batch is None:
        return None
    expected_face_ids = {
        str(face_id)
        for pattern_key in representation.source_pattern_keys
        for pattern_bound in context.facts.pattern_key_index.get(pattern_key, ())
        if pattern_bound.source_ordinal == bound.source_ordinal
        for face_id in (pattern_bound.instance.feature("face_id"),)
        if face_id is not None
    }
    hits = tuple(
        hit
        for hit in batch.hits
        if not expected_face_ids or hit.face_id in expected_face_ids
    )
    if len(hits) != 1:
        return None
    hit = hits[0]
    return AreaObservation(
        float(hit.area),
        f"{source.snapshot.unit_status}^2",
        tuple(
            sorted(
                {
                    *semantic_evidence(representation),
                    *outcome.evidence_refs,
                    hit.face_id,
                    *hit.boundary_occurrence_ids,
                }
            )
        ),
        tuple(
            sorted(
                {
                    *outcome.assumptions,
                    f"exactness={outcome.exactness}",
                    f"decision={outcome.decision}",
                    "area is read from one validated persisted L1 face",
                }
            )
        ),
        "topology.face.area",
    )


def measure_enclosed_area(
    context: BlockContext,
    state: TaskWorkState,
) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Area measurement requires a resolved scope")
    representations = scoped_representations(context, state)
    claims = []
    gaps = []
    rows = []
    for bound in representations:
        representation = bound.representation
        observation = _area_observation(context, bound)
        if observation is None:
            gaps.append(
                CapabilityGap.create(
                    capability_id="topology.query_faces",
                    missing="persisted_area_fact",
                    reason="No unique finite L2 area feature or validated L1 face is available.",
                    claim_type="ENCLOSED_AREA",
                    data_gap="persisted_area_fact",
                    evidence_refs=semantic_evidence(representation),
                )
            )
            continue
        claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="ENCLOSED_AREA",
            subject_ref=representation.resolution_id,
            predicate="area",
            value=observation.value,
            unit=observation.unit,
            scope_ref=scope.scope_id,
            truth_basis=context.spec.truth_basis,
            status=ClaimStatus.PROVEN,
            evidence_refs=observation.evidence_refs,
            assumptions=observation.assumptions,
            derivation_ref=f"taskblock:audit.measure_enclosed_area@1.0.0:{observation.source_kind}",
            source_snapshot_ids=(representation.source_snapshot_id,),
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
        )
        claims.append(claim)
        rows.append(
            (
                representation.resolution_id,
                observation.value,
                observation.unit,
                observation.source_kind,
            )
        )
    if not representations:
        gaps.append(
            CapabilityGap.create(
                capability_id="semantic.query",
                missing="target_representation",
                reason="No supported target representation exists in the resolved scope.",
                claim_type="ENCLOSED_AREA",
                evidence_refs=graph_evidence(context, state),
            )
        )
    artifacts = ()
    if rows:
        artifacts = (
            Artifact.create(
                task_run_id=context.task_run_id,
                artifact_type=ArtifactType.STRUCTURED_TABLE,
                media_type="application/vnd.xiaoliang.measurement-table+json",
                payload={
                    "columns": ("subject_ref", "value", "unit", "source_kind"),
                    "rows": tuple(rows),
                },
                evidence_refs={ref for claim in claims for ref in claim.evidence_refs},
            ),
        )
    return merge_fragment(state, claims=claims, artifacts=artifacts, gaps=gaps)


def _parameter_mapping(context: BlockContext) -> dict[str, Any]:
    raw = context.spec.constraint("parameters", {})
    values = dict(raw) if isinstance(raw, Mapping) else {}
    threshold = context.spec.constraint("threshold")
    if threshold is not None:
        values["threshold"] = threshold
    return values


def check_numeric_threshold(
    context: BlockContext,
    state: TaskWorkState,
) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Condition checking requires a resolved scope")
    op = str(context.spec.constraint("op", "gte"))
    rule_id = str(
        context.spec.constraint("rule_id", f"generic.numeric_threshold_{op}")
    )
    rule = context.rules.require(rule_id)
    parameters = _parameter_mapping(context)
    claims = []
    issues = []
    gaps = []
    representations = scoped_representations(context, state)
    for bound in representations:
        representation = bound.representation
        property_values = {
            assertion.property_id: assertion.normalized_value
            for assertion in representation.properties
            if assertion.normalized_value is not None
        }
        property_evidence = {
            item.evidence_id
            for assertion in representation.properties
            for item in assertion.evidence.all_refs
        }
        observation = _area_observation(context, bound)
        measurements = {} if observation is None else {"area": observation.value}
        evidence = tuple(
            sorted(
                {
                    *semantic_evidence(representation),
                    *property_evidence,
                    *(() if observation is None else observation.evidence_refs),
                }
            )
        )
        evaluation = context.rules.evaluate(
            rule_id,
            subject_ref=representation.resolution_id,
            properties=property_values,
            measurements=measurements,
            parameters=parameters,
            evidence_refs=evidence,
        )
        claim = Claim.create(
            task_run_id=context.task_run_id,
            claim_type="CONDITION_INPUT",
            subject_ref=representation.resolution_id,
            predicate=rule.left_ref,
            value=evaluation.left_value,
            unit=(observation.unit if observation is not None and rule.left_kind == "measurement" else None),
            scope_ref=scope.scope_id,
            truth_basis=context.spec.truth_basis,
            status=(
                ClaimStatus.PROVEN
                if evaluation.left_value is not None
                else ClaimStatus.UNKNOWN
            ),
            evidence_refs=evidence,
            assumptions=() if observation is None else observation.assumptions,
            derivation_ref="taskblock:audit.check_numeric_threshold@1.0.0",
            source_snapshot_ids=(representation.source_snapshot_id,),
            recipe_id=context.recipe_id,
            recipe_version=context.recipe_version,
            rule_ids=(rule.rule_id,),
        )
        claims.append(claim)
        issues.append(
            AuditIssue.create(
                task_run_id=context.task_run_id,
                rule_id=rule.rule_id,
                rule_version=rule.version,
                affected_object_refs=(representation.resolution_id,),
                observation_claim_ids=(claim.claim_id,),
                applicability_status=evaluation.applicability_status,
                conclusion_status=evaluation.conclusion_status,
                severity=rule.severity,
                evidence_refs=evidence,
                assumptions=evaluation.assumptions,
                recommendation=(
                    "Review missing inputs before applying this condition."
                    if evaluation.conclusion_status
                    is ConclusionStatus.INSUFFICIENT_INFORMATION
                    else "Review the checked value and the versioned request parameter."
                ),
                source_rule_ref=rule.source_ref,
            )
        )
        if evaluation.missing:
            gaps.append(
                CapabilityGap.create(
                    capability_id="rules.evaluate",
                    missing=",".join(evaluation.missing),
                    reason="The versioned rule cannot be evaluated without its declared inputs.",
                    claim_type="CONDITION_CHECK",
                    data_gap=evaluation.missing[0],
                    evidence_refs=evidence,
                )
            )
    if not representations:
        gaps.append(
            CapabilityGap.create(
                capability_id="semantic.query",
                missing="target_representation",
                reason="No supported target representation exists in the resolved scope.",
                claim_type="CONDITION_CHECK",
                evidence_refs=graph_evidence(context, state),
            )
        )
    return merge_fragment(state, claims=claims, issues=issues, gaps=gaps)


def audit_duplicate_labels(
    context: BlockContext,
    state: TaskWorkState,
) -> TaskWorkState:
    scope = state.resolved_scope
    if scope is None:
        raise RuntimeError("Label auditing requires a resolved scope")
    rule = context.rules.require("generic.distinct_labels")
    representations = scoped_representations(context, state)
    grouped: dict[str, list[tuple[str, str, tuple[str, ...]]]] = defaultdict(list)
    evidence = set()
    for bound in representations:
        representation = bound.representation
        evidence.update(semantic_evidence(representation))
        for assertion in representation.properties:
            if assertion.property_id != "core.label_text" or assertion.normalized_value is None:
                continue
            literal = str(assertion.normalized_value).strip()
            if not literal:
                continue
            refs = tuple(item.evidence_id for item in assertion.evidence.all_refs)
            evidence.update(refs)
            grouped[literal.casefold()].append(
                (literal, representation.resolution_id, refs)
            )
    if not evidence:
        evidence.update(graph_evidence(context, state))
    labels = tuple(
        item[0]
        for _, values in sorted(grouped.items())
        for item in values
    )
    evaluation = context.rules.evaluate(
        rule.rule_id,
        subject_ref=f"class:{context.spec.target.semantic_class}",
        values={"labels": labels},
        evidence_refs=evidence,
    )
    claim = Claim.create(
        task_run_id=context.task_run_id,
        claim_type="LABEL_DISTINCTNESS",
        subject_ref=f"class:{context.spec.target.semantic_class}",
        predicate="labels_are_distinct",
        value=bool(evaluation.predicate_result),
        unit=None,
        scope_ref=scope.scope_id,
        truth_basis=context.spec.truth_basis,
        status=ClaimStatus.PROVEN,
        evidence_refs=evidence,
        derivation_ref="taskblock:audit.duplicate_labels@1.0.0",
        source_snapshot_ids=scope.snapshot_ids,
        recipe_id=context.recipe_id,
        recipe_version=context.recipe_version,
        rule_ids=(rule.rule_id,),
    )
    issues = []
    for normalized, values in sorted(grouped.items()):
        if len(values) < 2:
            continue
        affected = tuple(item[1] for item in values)
        duplicate_evidence = tuple(
            sorted({ref for _, _, refs in values for ref in refs} | set(affected))
        )
        issues.append(
            AuditIssue.create(
                task_run_id=context.task_run_id,
                rule_id=rule.rule_id,
                rule_version=rule.version,
                affected_object_refs=affected,
                observation_claim_ids=(claim.claim_id,),
                applicability_status=ApplicabilityStatus.APPLICABLE,
                conclusion_status=ConclusionStatus.FAIL,
                severity=rule.severity,
                evidence_refs=duplicate_evidence,
                recommendation=f"Resolve the duplicate normalized label {normalized!r} without changing unrelated facts.",
                source_rule_ref=rule.source_ref,
            )
        )
    return merge_fragment(state, claims=(claim,), issues=issues)


def register_audit_blocks(registry: TaskBlockRegistry) -> None:
    definitions = (
        (
            "audit.measure_enclosed_area",
            measure_enclosed_area,
            ("semantic.query", "topology.query_faces"),
        ),
        (
            "audit.check_numeric_threshold",
            check_numeric_threshold,
            ("semantic.query", "topology.query_faces"),
        ),
        (
            "audit.duplicate_labels",
            audit_duplicate_labels,
            ("semantic.query",),
        ),
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
