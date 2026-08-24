from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from cadtasks.contracts import (
    CapabilityGap,
    EvidencePolicy,
    QuantityBasis,
    TaskRequest,
    TaskScope,
    TaskSpec,
    TaskTarget,
    TaskType,
)


@dataclass(frozen=True, slots=True)
class CompilationResult:
    spec: TaskSpec | None
    missing_slots: tuple[str, ...]
    ambiguities: tuple[str, ...]

    @property
    def complete(self) -> bool:
        return self.spec is not None and not self.missing_slots and not self.ambiguities


class TaskCompilerPort(Protocol):
    compiler_version: str

    def compile(
        self,
        request: TaskRequest | Mapping[str, Any],
        *,
        default_project_id: str | None = None,
    ) -> CompilationResult: ...


class StructuredTaskCompiler:
    """Validate structured slots without interpreting natural language."""

    compiler_version = "structured-task-compiler:1.0.0"

    def compile(
        self,
        request: TaskRequest | Mapping[str, Any],
        *,
        default_project_id: str | None = None,
    ) -> CompilationResult:
        payload = dict(request.payload) if isinstance(request, TaskRequest) else dict(request)
        missing = []
        ambiguities = []
        raw_type = payload.get("task_type")
        if raw_type is None:
            missing.append("task_type")
        raw_target = payload.get("target")
        semantic_class = payload.get("target_class")
        selectors: Any = payload.get("selectors", {})
        if isinstance(raw_target, Mapping):
            semantic_class = raw_target.get("semantic_class", semantic_class)
            selectors = raw_target.get("selectors", selectors)
        elif isinstance(raw_target, str):
            semantic_class = raw_target
        elif isinstance(raw_target, (list, tuple)):
            ambiguities.append("target")
        if semantic_class is None:
            missing.append("target.semantic_class")
        raw_scope = payload.get("scope", {})
        if raw_scope is None:
            raw_scope = {}
        if not isinstance(raw_scope, Mapping):
            ambiguities.append("scope")
            raw_scope = {}
        project_id = raw_scope.get("project_id", payload.get("project_id", default_project_id))
        if project_id is None:
            missing.append("scope.project_id")
        if missing or ambiguities:
            return CompilationResult(None, tuple(sorted(set(missing))), tuple(sorted(set(ambiguities))))
        task_type = TaskType(str(raw_type).casefold())
        quantity_bases = payload.get("quantity_bases", ())
        if task_type in {TaskType.COUNT, TaskType.RECONCILE} and not quantity_bases:
            quantity_bases = tuple(item.value for item in QuantityBasis)
        scope = TaskScope.create(
            scope_type=str(raw_scope.get("scope_type", raw_scope.get("type", "project"))).casefold(),
            project_id=str(project_id),
            files=raw_scope.get("files", ()),
            sheets=raw_scope.get("sheets", ()),
            views=raw_scope.get("views", ()),
            regions=raw_scope.get("regions", ()),
            systems=raw_scope.get("systems", ()),
            storeys=raw_scope.get("storeys", ()),
            object_refs=raw_scope.get("object_refs", ()),
        )
        raw_evidence_policy = payload.get("evidence_policy", {})
        if not isinstance(raw_evidence_policy, Mapping):
            return CompilationResult(None, (), ("evidence_policy",))
        spec = TaskSpec.create(
            task_type=task_type,
            target=TaskTarget.create(str(semantic_class), selectors),
            scope=scope,
            revision_policy=str(payload.get("revision_policy", "pinned")),
            truth_basis=str(payload.get("truth_basis", "drawing_expression")).casefold(),
            quantity_bases=quantity_bases,
            constraints=payload.get("constraints", ()),
            evidence_policy=EvidencePolicy(
                minimum_grade=str(
                    raw_evidence_policy.get(
                        "minimum_grade", "deterministic_rule_derived"
                    )
                ),
                allow_model_inferred=bool(
                    raw_evidence_policy.get("allow_model_inferred", False)
                ),
                allow_assumptions=bool(
                    raw_evidence_policy.get("allow_assumptions", False)
                ),
                partial_result_allowed=bool(
                    raw_evidence_policy.get("partial_result_allowed", True)
                ),
            ),
            output_contract=payload.get("output_contract", ("answer",)),
            mutation_policy=str(payload.get("mutation_policy", "read_only")).casefold(),
            risk_tier=str(payload.get("risk_tier", "low")).casefold(),
            assembly_policy=str(payload.get("assembly_policy", "count_members")).casefold(),
        )
        return CompilationResult(spec, (), ())


@dataclass(frozen=True, slots=True)
class PlanCompositionResult:
    supported: bool
    candidate: Any | None
    gap: CapabilityGap | None


class PlanComposerPort(Protocol):
    composer_version: str

    def compose(self, spec: TaskSpec) -> PlanCompositionResult: ...


class DisabledPlanComposer:
    composer_version = "disabled-plan-composer:1.0.0"

    def compose(self, spec: TaskSpec) -> PlanCompositionResult:
        return PlanCompositionResult(
            False,
            None,
            CapabilityGap.create(
                capability_id="plan.compose",
                missing=f"recipe_for:{spec.task_type.value}",
                reason="The deterministic default composer does not invent unregistered recipes.",
            ),
        )
