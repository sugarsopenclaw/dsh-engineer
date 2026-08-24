from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from cadkernel.contracts import stable_id

from cadtasks.artifacts import answer_artifact
from cadtasks.binding import ProjectBinding, ProjectFactBundle
from cadtasks.blocks import (
    BlockContext,
    TaskBlockRegistry,
    TaskWorkState,
    create_builtin_block_registry,
)
from cadtasks.capabilities import (
    CapabilityRegistry,
    create_builtin_capability_registry,
)
from cadtasks.contracts import (
    ArtifactType,
    ConclusionStatus,
    ID_LENGTH,
    ReadinessStatus,
    ResultDependencyGraph,
    TaskFragment,
    TaskResultBundle,
    TaskSpec,
    TaskStatus,
)
from cadtasks.planning import ExecutionPlan, PlanCompiler, topological_order
from cadtasks.ports import DeterministicResultPresenter, ResultPresenterPort
from cadtasks.readiness import CapabilityGate
from cadtasks.recipes import (
    RecipeRegistry,
    RecipeSelector,
    create_builtin_recipe_registry,
)
from cadtasks.rules import RuleRegistry, create_builtin_rule_registry
from cadtasks.runtime.state_machine import TaskStateMachine
from cadtasks.runtime.trace import TraceBuilder
from cadtasks.scope import ScopeResolver
from cadtasks.storage import TaskLocation, TaskStore
from cadtasks.validation import ResultValidator


def task_run_id(
    *,
    spec: TaskSpec,
    project_snapshot_set_id: str,
    recipe_id: str,
    recipe_version: str,
    capability_versions: Iterable[tuple[str, str]],
    block_versions: Iterable[tuple[str, str]],
    rule_versions: Iterable[tuple[str, str]],
    ontology_versions: Iterable[str],
    pack_versions: Iterable[str],
    compiler_version: str,
    model_versions: Iterable[tuple[str, str]] = (),
) -> str:
    digest = stable_id(
        "task-run",
        spec.task_spec_key,
        project_snapshot_set_id,
        recipe_id,
        recipe_version,
        tuple(sorted(set(capability_versions))),
        tuple(sorted(set(block_versions))),
        tuple(sorted(set(rule_versions))),
        tuple(sorted(set(ontology_versions))),
        tuple(sorted(set(pack_versions))),
        compiler_version,
        tuple(sorted(set(model_versions))),
        length=ID_LENGTH,
    )
    return "task-run:" + digest


@dataclass(frozen=True, slots=True)
class TaskRunResult:
    bundle: TaskResultBundle
    execution_plan: ExecutionPlan
    location: TaskLocation | None = None


class TaskRuntime:
    """Compile and execute deterministic read-only task recipes over pinned facts."""

    version = "1.0.0"

    def __init__(
        self,
        *,
        capabilities: CapabilityRegistry | None = None,
        blocks: TaskBlockRegistry | None = None,
        recipes: RecipeRegistry | None = None,
        rules: RuleRegistry | None = None,
        selector: RecipeSelector | None = None,
        compiler: PlanCompiler | None = None,
        gate: CapabilityGate | None = None,
        scope_resolver: ScopeResolver | None = None,
        presenter: ResultPresenterPort | None = None,
    ) -> None:
        self.capabilities = capabilities or create_builtin_capability_registry()
        self.blocks = blocks or create_builtin_block_registry()
        self.recipes = recipes or create_builtin_recipe_registry()
        self.rules = rules or create_builtin_rule_registry()
        self.selector = selector or RecipeSelector()
        self.compiler = compiler or PlanCompiler()
        self.gate = gate or CapabilityGate()
        self.scope_resolver = scope_resolver or ScopeResolver()
        self.presenter = presenter or DeterministicResultPresenter()

    def run(
        self,
        binding: ProjectBinding,
        spec: TaskSpec,
        *,
        output_root: str | Path | None = None,
    ) -> TaskRunResult:
        machine = TaskStateMachine()
        machine.transition(TaskStatus.SPECIFIED, reason="structured TaskSpec accepted")
        binding_errors = binding.verify()
        if binding_errors:
            raise ValueError(
                "Project binding integrity failure: " + ", ".join(binding_errors)
            )
        facts = ProjectFactBundle.load(binding)
        recipe = self.selector.select(spec, self.recipes)
        readiness = self.gate.evaluate(
            spec=spec,
            facts=facts,
            recipe=recipe,
            capabilities=self.capabilities,
        )
        machine.transition(TaskStatus.PREFLIGHTED, reason="capability gate evaluated")
        plan = self.compiler.compile(
            spec=spec,
            project_snapshot_set_id=binding.project_snapshot_set_id,
            recipe=recipe,
            blocks=self.blocks,
            capabilities=self.capabilities,
            rules=self.rules,
            ontology_versions=facts.ontology_versions,
            pack_versions=facts.pack_versions,
        )
        machine.transition(TaskStatus.PLANNED, reason="typed execution DAG accepted")
        run_id = task_run_id(
            spec=spec,
            project_snapshot_set_id=binding.project_snapshot_set_id,
            recipe_id=recipe.recipe_id,
            recipe_version=recipe.version,
            capability_versions=self.capabilities.versions(),
            block_versions=self.blocks.versions(),
            rule_versions=plan.rule_versions,
            ontology_versions=facts.ontology_versions,
            pack_versions=facts.pack_versions,
            compiler_version=self.compiler.version,
            model_versions=(
                ("result_presenter", self.presenter.presenter_version),
            ),
        )
        trace = TraceBuilder(run_id)
        trace.add(
            phase="acquire",
            subject_ref=binding.project_snapshot_set_id,
            status="completed",
            message="Verified and loaded every immutable source once.",
            details={"source_count": len(facts.sources)},
        )
        trace.add(
            phase="preflight",
            subject_ref=readiness.report_id,
            status=readiness.overall_status.value,
            message="Evaluated claim-level readiness without rejecting ready claims.",
        )
        trace.add(
            phase="plan",
            subject_ref=plan.execution_plan_id,
            status="completed",
            message="Compiled and statically checked the versioned recipe DAG.",
        )
        machine.transition(TaskStatus.RUNNING, reason="execution plan started")
        context = BlockContext(
            run_id,
            spec,
            facts,
            self.capabilities,
            self.rules,
            self.scope_resolver,
            recipe.recipe_id,
            recipe.version,
        )
        work = TaskWorkState.empty()
        for node in topological_order(plan.nodes):
            block_spec, function = self.blocks.resolve(node.block_id)
            work = function(context, work)
            trace.add(
                phase=block_spec.stage,
                subject_ref=node.node_id,
                status="completed",
                message=f"Executed deterministic task block {block_spec.block_id}@{block_spec.version}.",
                details={
                    "read_write": block_spec.read_write,
                    "resource_class": block_spec.resource_class,
                },
            )
        machine.transition(TaskStatus.VALIDATING, reason="independent validators started")
        executed_gap_keys = {
            (gap.claim_type, gap.missing, gap.data_gap) for gap in work.fragment.gaps
        }
        preflight_gaps = tuple(
            gap
            for gap in readiness.capability_gaps
            if (gap.claim_type, gap.missing, gap.data_gap) not in executed_gap_keys
        )
        fragment = TaskFragment.create(
            claims=work.fragment.claims,
            issues=work.fragment.issues,
            artifacts=work.fragment.artifacts,
            gaps=(*preflight_gaps, *work.fragment.gaps),
            records=work.fragment.records,
        )
        evidence_refs = tuple(
            sorted(
                {
                    *(ref for claim in fragment.claims for ref in claim.evidence_refs),
                    *(ref for issue in fragment.issues for ref in issue.evidence_refs),
                    *(ref for gap in fragment.gaps for ref in gap.evidence_refs),
                }
            )
        )
        artifacts = fragment.artifacts
        if ArtifactType.ANSWER in spec.output_contract:
            artifacts = (
                *artifacts,
                answer_artifact(
                    task_run_id=run_id,
                    text=self.presenter.present(
                        spec=spec,
                        claims=fragment.claims,
                        issues=fragment.issues,
                        gaps=fragment.gaps,
                    ),
                    evidence_refs=evidence_refs,
                ),
            )
        if readiness.overall_status is ReadinessStatus.UNSUPPORTED:
            terminal = TaskStatus.UNSUPPORTED
        elif any(
            issue.conclusion_status is ConclusionStatus.REVIEW_REQUIRED
            for issue in fragment.issues
        ):
            terminal = TaskStatus.REVIEW_REQUIRED
        elif fragment.gaps and fragment.claims:
            terminal = TaskStatus.PARTIAL
        elif fragment.gaps:
            terminal = TaskStatus.BLOCKED
        else:
            terminal = TaskStatus.COMPLETED
        machine.transition(terminal, reason="structured result independently validated")
        trace.add(
            phase="validate",
            subject_ref=run_id,
            status=terminal.value,
            message="Applied claim, issue, and result validation gates.",
            details={
                "claim_count": len(fragment.claims),
                "issue_count": len(fragment.issues),
                "gap_count": len(fragment.gaps),
            },
        )
        dependency_graph = ResultDependencyGraph.create(
            project_snapshot_set_id=binding.project_snapshot_set_id,
            claims=fragment.claims,
            upstream_manifest_sha256=binding.manifest_sha256,
        )
        bundle = TaskResultBundle.create(
            task_run_id=run_id,
            task_spec=spec,
            project_snapshot_set_id=binding.project_snapshot_set_id,
            recipe_id=recipe.recipe_id,
            recipe_version=recipe.version,
            status=terminal,
            readiness=readiness,
            claims=fragment.claims,
            issues=fragment.issues,
            artifacts=artifacts,
            gaps=fragment.gaps,
            trace=trace.records,
            dependency_graph=dependency_graph,
            capability_versions=self.capabilities.versions(),
            rule_versions=plan.rule_versions,
            ontology_versions=facts.ontology_versions,
            pack_versions=facts.pack_versions,
            model_versions=(
                ("result_presenter", self.presenter.presenter_version),
            ),
        )
        ResultValidator(self.rules).validate(bundle, facts=facts)
        location = (
            None
            if output_root is None
            else TaskStore.create(output_root, bundle, binding=binding)
        )
        return TaskRunResult(bundle, plan, location)
