from __future__ import annotations

from cadtasks.binding import ProjectBinding, ProjectFactBundle
from cadtasks.contracts import (
    ConclusionStatus,
    ReadinessStatus,
    TaskScope,
    TaskSpec,
    TaskStatus,
    TaskTarget,
)
from cadtasks.runtime import TaskRuntime


def _spec(
    binding: ProjectBinding,
    task_type: str,
    target_class: str,
    *,
    selectors=None,
    constraints=None,
) -> TaskSpec:
    return TaskSpec.create(
        task_type=task_type,
        target=TaskTarget.create(target_class, selectors or {}),
        scope=TaskScope.create(project_id=binding.project_id),
        constraints=constraints or {},
        output_contract=("answer", "source_highlights", "structured_table"),
    )


def test_locate_and_trace_follow_real_cross_layer_references(
    project_binding: ProjectBinding,
) -> None:
    facts = ProjectFactBundle.load(project_binding)
    seed = next(
        bound.instance
        for bound in facts.detection_index.values()
        if bound.instance.feature("geometry_signature") is not None
    )
    runtime = TaskRuntime()
    located = runtime.run(
        project_binding,
        _spec(
            project_binding,
            "locate",
            "generic.SymbolicComponent",
            selectors={"detection_id": seed.detection_id},
        ),
    ).bundle
    claim = next(claim for claim in located.claims if claim.claim_type == "SIMILAR_STRUCTURE_SET")
    assert claim.value
    assert any(artifact.artifact_type.value == "source_highlights" for artifact in located.artifacts)

    traced = runtime.run(
        project_binding,
        _spec(
            project_binding,
            "trace",
            "generic.SymbolicComponent",
            selectors={"subject_ref": seed.detection_id},
        ),
    ).bundle
    lineage = next(claim for claim in traced.claims if claim.claim_type == "EVIDENCE_LINEAGE")
    assert lineage.value["node_count"] >= 1
    assert lineage.value["edge_count"] >= 1


def test_area_and_parameterized_condition_use_persisted_facts(
    project_binding: ProjectBinding,
) -> None:
    runtime = TaskRuntime()
    measured = runtime.run(
        project_binding,
        _spec(project_binding, "measure", "generic.EnclosedSpace"),
    ).bundle
    areas = tuple(claim for claim in measured.claims if claim.claim_type == "ENCLOSED_AREA")
    assert areas
    assert all(
        "pattern.area" in claim.derivation_ref
        or "topology.face.area" in claim.derivation_ref
        for claim in areas
    )

    checked = runtime.run(
        project_binding,
        _spec(
            project_binding,
            "check",
            "generic.EnclosedSpace",
            constraints={"op": "gte", "threshold": 0},
        ),
    ).bundle
    assert checked.issues
    assert all(
        issue.conclusion_status is ConclusionStatus.PASS
        for issue in checked.issues
        if issue.rule_id == "generic.numeric_threshold_gte"
    )


def test_duplicate_label_audit_is_formalized(
    project_binding: ProjectBinding,
) -> None:
    result = TaskRuntime().run(
        project_binding,
        _spec(project_binding, "audit", "generic.SymbolicComponent"),
    ).bundle
    claim = next(claim for claim in result.claims if claim.claim_type == "LABEL_DISTINCTNESS")
    assert isinstance(claim.value, bool)
    for issue in result.issues:
        assert issue.rule_id == "generic.distinct_labels"
        assert issue.conclusion_status is ConclusionStatus.FAIL


def test_identify_describe_and_reconcile_complete_the_registered_surface(
    project_binding: ProjectBinding,
) -> None:
    facts = ProjectFactBundle.load(project_binding)
    representation = next(iter(facts.resolution_index.values())).representation
    runtime = TaskRuntime()
    identified = runtime.run(
        project_binding,
        _spec(project_binding, "identify", "*"),
    ).bundle
    assert any(
        claim.claim_type == "IDENTIFIED_OBJECT_SET" for claim in identified.claims
    )

    described = runtime.run(
        project_binding,
        _spec(
            project_binding,
            "describe",
            representation.semantic_class or "*",
            selectors={"subject_ref": representation.resolution_id},
        ),
    ).bundle
    assert any(claim.claim_type == "OBJECT_DESCRIPTION" for claim in described.claims)

    reconciled = runtime.run(
        project_binding,
        TaskSpec.create(
            task_type="reconcile",
            target=TaskTarget.create("generic.SymbolicComponent"),
            scope=TaskScope.create(project_id=project_binding.project_id),
        ),
    ).bundle
    assert any(
        claim.claim_type == "COUNT_RECONCILIATION"
        for claim in reconciled.claims
    )


def test_locate_with_unknown_seed_reports_a_subject_gap(
    project_binding: ProjectBinding,
) -> None:
    result = TaskRuntime().run(
        project_binding,
        _spec(
            project_binding,
            "locate",
            "generic.SymbolicComponent",
            selectors={"detection_id": "detection:does-not-exist"},
        ),
    ).bundle
    assert result.status is TaskStatus.BLOCKED
    assert not any(
        claim.claim_type == "SIMILAR_STRUCTURE_SET" for claim in result.claims
    )
    gaps = tuple(
        gap for gap in result.gaps if gap.claim_type == "SIMILAR_STRUCTURE_SET"
    )
    assert len(gaps) == 1
    assert gaps[0].missing == "subject_ref"
    readiness = next(
        item
        for item in result.readiness.claim_readiness
        if item.claim_type == "SIMILAR_STRUCTURE_SET"
    )
    assert readiness.status is ReadinessStatus.INSUFFICIENT_EVIDENCE
    assert readiness.missing == ("subject_ref",)


def test_between_threshold_shape_is_validated_without_crashing(
    project_binding: ProjectBinding,
) -> None:
    runtime = TaskRuntime()
    scalar = runtime.run(
        project_binding,
        _spec(
            project_binding,
            "check",
            "generic.EnclosedSpace",
            constraints={"op": "between", "threshold": 100},
        ),
    ).bundle
    scalar_issues = tuple(
        issue
        for issue in scalar.issues
        if issue.rule_id == "generic.numeric_threshold_between"
    )
    assert scalar_issues
    assert all(
        issue.conclusion_status is ConclusionStatus.INSUFFICIENT_INFORMATION
        for issue in scalar_issues
    )
    assert any(
        "parameter:threshold" in gap.missing for gap in scalar.gaps
    )

    bounded = runtime.run(
        project_binding,
        _spec(
            project_binding,
            "check",
            "generic.EnclosedSpace",
            constraints={"op": "between", "threshold": [0, 10**12]},
        ),
    ).bundle
    bounded_issues = tuple(
        issue
        for issue in bounded.issues
        if issue.rule_id == "generic.numeric_threshold_between"
    )
    assert bounded_issues
    assert any(
        issue.conclusion_status is ConclusionStatus.PASS for issue in bounded_issues
    )
    assert all(
        issue.conclusion_status is not ConclusionStatus.FAIL
        for issue in bounded_issues
    )


def test_count_scoped_by_subject_ref_remains_reproducible(
    project_binding: ProjectBinding,
) -> None:
    facts = ProjectFactBundle.load(project_binding)
    target = next(
        bound.representation
        for bound in facts.representations(
            semantic_class="generic.SymbolicComponent",
            supported_only=True,
        )
        if bound.representation.representation_mode.value
        != "aggregated_representation"
    )
    result = TaskRuntime().run(
        project_binding,
        TaskSpec.create(
            task_type="count",
            target=TaskTarget.create(
                "generic.SymbolicComponent",
                {"subject_ref": target.resolution_id},
            ),
            scope=TaskScope.create(project_id=project_binding.project_id),
            quantity_bases=("drawing_occurrence", "unique_tag"),
        ),
    ).bundle
    assert result.status is TaskStatus.COMPLETED
    drawing = next(
        claim for claim in result.claims if claim.claim_type == "DRAWING_OCCURRENCE_COUNT"
    )
    assert drawing.value == 1
    coverage = next(
        claim for claim in result.claims if claim.claim_type == "TAG_COVERAGE"
    )
    assert coverage.value["total_representation_count"] == 1
