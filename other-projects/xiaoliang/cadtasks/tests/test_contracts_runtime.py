from __future__ import annotations

from pathlib import Path

import pytest

from cadkernel.indexes import SnapshotStore
from cadpatterns.storage import PatternStore
from cadsemantics.storage import SemanticStore

from cadtasks.binding import ProjectBinding, ProjectFactBundle
from cadtasks.capabilities import create_builtin_capability_registry
from cadtasks.contracts import (
    ClaimStatus,
    QuantityBasis,
    TaskScope,
    TaskSpec,
    TaskTarget,
)
from cadtasks.runtime import TaskRuntime
from cadtasks.storage import TaskStore


def count_spec(project_id: str) -> TaskSpec:
    return TaskSpec.create(
        task_type="count",
        target=TaskTarget.create("generic.SymbolicComponent"),
        scope=TaskScope.create(project_id=project_id),
        quantity_bases=tuple(QuantityBasis),
        output_contract=("answer", "structured_table"),
    )


def test_capability_registry_is_an_allowlist() -> None:
    registry = create_builtin_capability_registry()
    assert "measure.area" not in registry
    with pytest.raises(ValueError, match="not allowed"):
        registry.resolve("measure.area")
    with pytest.raises(ValueError, match="not allowed"):
        registry.resolve("unknown.operation")


def test_binding_loads_all_layers_once_and_indexes_real_facts(
    project_binding: ProjectBinding,
) -> None:
    facts = ProjectFactBundle.load(project_binding)
    assert facts.sources
    assert facts.detection_index
    assert facts.resolution_index
    assert facts.occurrence_index
    assert all(facts.has_evidence(ref) for ref in facts.resolution_index)


def test_count_bases_are_separate_deterministic_and_storable(
    project_binding: ProjectBinding,
    tmp_path: Path,
) -> None:
    runtime = TaskRuntime()
    spec = count_spec(project_binding.project_id)
    first = runtime.run(project_binding, spec, output_root=tmp_path / "tasks")
    second = runtime.run(project_binding, spec, output_root=tmp_path / "tasks")
    assert first.bundle.to_json() == second.bundle.to_json()
    assert first.location == second.location
    by_basis = {
        claim.quantity_basis: claim
        for claim in first.bundle.claims
        if claim.quantity_basis is not None and claim.claim_type.endswith("_COUNT")
    }
    assert by_basis[QuantityBasis.BOM_DECLARED].status is ClaimStatus.ABSTAINED
    assert by_basis[QuantityBasis.BOM_DECLARED].value is None
    physical = by_basis[QuantityBasis.PHYSICAL_INSTANCE]
    assert physical.status is ClaimStatus.AMBIGUOUS
    assert physical.value_interval is not None
    assert physical.status is not ClaimStatus.PROVEN
    assert first.location is not None
    assert TaskStore.verify(first.location.path, binding=project_binding) == ()
    assert TaskStore.load(first.location.path).to_json() == first.bundle.to_json()
    for source in project_binding.sources:
        assert SnapshotStore.verify(source.snapshot_path) == ()
        assert PatternStore.verify(source.pattern_path, snapshot_path=source.snapshot_path) == ()
        assert SemanticStore.verify(
            source.semantic_path,
            snapshot_path=source.snapshot_path,
            pattern_path=source.pattern_path,
        ) == ()


def test_multi_source_physical_count_abstains(
    two_source_binding: ProjectBinding,
) -> None:
    result = TaskRuntime().run(
        two_source_binding,
        count_spec(two_source_binding.project_id),
    ).bundle
    physical = next(
        claim
        for claim in result.claims
        if claim.quantity_basis is QuantityBasis.PHYSICAL_INSTANCE
    )
    assert physical.status is ClaimStatus.ABSTAINED
    assert physical.value_interval is not None
    assert any(gap.data_gap == "cross_file_identity" for gap in result.gaps)


def test_default_assembly_policy_counts_members_and_reports_groups_separately(
    project_binding: ProjectBinding,
) -> None:
    facts = ProjectFactBundle.load(project_binding)
    groups = tuple(
        bound
        for bound in facts.resolution_index.values()
        if bound.representation.representation_mode.value
        == "aggregated_representation"
        and bound.representation.status.value == "supported"
    )
    assert groups
    spec = TaskSpec.create(
        task_type="count",
        target=TaskTarget.create("*"),
        scope=TaskScope.create(project_id=project_binding.project_id),
        quantity_bases=(QuantityBasis.DRAWING_OCCURRENCE,),
    )
    result = TaskRuntime().run(project_binding, spec).bundle
    group_claim = next(
        claim for claim in result.claims if claim.claim_type == "ASSEMBLY_GROUP_COUNT"
    )
    drawing_claim = next(
        claim
        for claim in result.claims
        if claim.claim_type == "DRAWING_OCCURRENCE_COUNT"
    )
    assert group_claim.value == len(groups)
    assert drawing_claim.value + group_claim.value == len(
        tuple(
            bound
            for bound in facts.resolution_index.values()
            if bound.representation.status.value == "supported"
            and bound.representation.representation_mode.value
            in {
                "instance_view",
                "schematic_instance",
                "aggregated_representation",
            }
        )
    )


def test_file_scope_requires_bound_identifiers(
    two_source_binding: ProjectBinding,
) -> None:
    runtime = TaskRuntime()
    with pytest.raises(ValueError, match="files do not identify"):
        runtime.run(
            two_source_binding,
            TaskSpec.create(
                task_type="count",
                target=TaskTarget.create("generic.SymbolicComponent"),
                scope=TaskScope.create(
                    project_id=two_source_binding.project_id,
                    files=("snapshot",),
                ),
                quantity_bases=(QuantityBasis.DRAWING_OCCURRENCE,),
            ),
        )
    first_snapshot_id = two_source_binding.sources[0].snapshot_id
    result = runtime.run(
        two_source_binding,
        TaskSpec.create(
            task_type="count",
            target=TaskTarget.create("generic.SymbolicComponent"),
            scope=TaskScope.create(
                project_id=two_source_binding.project_id,
                files=(first_snapshot_id,),
            ),
            quantity_bases=(QuantityBasis.PHYSICAL_INSTANCE,),
        ),
    ).bundle
    physical = next(
        claim
        for claim in result.claims
        if claim.quantity_basis is QuantityBasis.PHYSICAL_INSTANCE
    )
    assert physical.status is ClaimStatus.AMBIGUOUS
    assert physical.source_snapshot_ids == (first_snapshot_id,)
    assert not any(gap.data_gap == "cross_file_identity" for gap in result.gaps)


def test_gate_and_execution_do_not_emit_duplicate_gaps(
    project_binding: ProjectBinding,
    two_source_binding: ProjectBinding,
) -> None:
    runtime = TaskRuntime()
    single = runtime.run(
        project_binding, count_spec(project_binding.project_id)
    ).bundle
    assert (
        len([gap for gap in single.gaps if gap.data_gap == "schedule.row_segmentation"])
        == 1
    )
    multi = runtime.run(
        two_source_binding, count_spec(two_source_binding.project_id)
    ).bundle
    assert (
        len([gap for gap in multi.gaps if gap.data_gap == "schedule.row_segmentation"])
        == 1
    )
    assert (
        len([gap for gap in multi.gaps if gap.data_gap == "cross_file_identity"])
        == 1
    )
