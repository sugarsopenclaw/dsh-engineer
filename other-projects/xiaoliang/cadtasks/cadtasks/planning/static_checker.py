from __future__ import annotations

from dataclasses import dataclass

from cadtasks.blocks import TaskBlockRegistry
from cadtasks.capabilities import CapabilityRegistry
from cadtasks.contracts import MutationPolicy, TaskSpec
from cadtasks.planning.dag import dependency_outputs, topological_order
from cadtasks.planning.execution_plan import ExecutionPlan
from cadtasks.recipes import RecipeManifest
from cadtasks.rules import RuleRegistry


@dataclass(frozen=True, slots=True)
class StaticCheckReport:
    errors: tuple[str, ...]
    warnings: tuple[str, ...] = ()

    @property
    def valid(self) -> bool:
        return not self.errors

    def require_valid(self) -> None:
        if self.errors:
            raise ValueError("Execution plan static check failed: " + "; ".join(self.errors))


class PlanStaticChecker:
    version = "1.0.0"

    def check(
        self,
        plan: ExecutionPlan,
        *,
        spec: TaskSpec,
        recipe: RecipeManifest,
        blocks: TaskBlockRegistry,
        capabilities: CapabilityRegistry,
        rules: RuleRegistry,
        ontology_versions: tuple[str, ...] = (),
        pack_versions: tuple[str, ...] = (),
    ) -> StaticCheckReport:
        errors = []
        warnings = []
        try:
            ordered = topological_order(plan.nodes)
        except ValueError as error:
            return StaticCheckReport((str(error),))
        if plan.task_spec_key != spec.task_spec_key:
            errors.append("plan belongs to another TaskSpec")
        if (plan.recipe_id, plan.recipe_version) != (recipe.recipe_id, recipe.version):
            errors.append("plan recipe identity does not match selected manifest")
        if ontology_versions and plan.ontology_versions != tuple(
            sorted(set(ontology_versions))
        ):
            errors.append("plan semantic ontology versions are stale")
        if pack_versions and plan.pack_versions != tuple(sorted(set(pack_versions))):
            errors.append("plan semantic pack versions are stale")
        if spec.mutation_policy not in recipe.supported_mutation_policies:
            errors.append("recipe does not allow the TaskSpec mutation policy")
        if not recipe.target_parameterized:
            errors.append("first-release recipes must keep target class parameterized")

        node_ids = {node.node_id for node in ordered}
        if node_ids != {node.node_id for node in recipe.nodes}:
            errors.append("compiled plan nodes differ from recipe nodes")
        for node in ordered:
            try:
                block, _ = blocks.resolve(node.block_id)
            except KeyError:
                errors.append(f"unknown task block: {node.block_id}")
                continue
            if block.version != node.block_version:
                errors.append(f"task block version drift: {node.block_id}")
            if block.input_type != node.input_type or block.output_type != node.output_type:
                errors.append(f"task block schema drift: {node.block_id}")
            outputs = dependency_outputs(node, ordered)
            if outputs and any(output != node.input_type for output in outputs):
                errors.append(f"dependency output type mismatch at node: {node.node_id}")
            if spec.mutation_policy is MutationPolicy.READ_ONLY and node.read_write != "read":
                errors.append(f"read-only task contains a write block: {node.block_id}")
            if not node.deterministic:
                errors.append(f"non-deterministic block is not allowed: {node.block_id}")
            for capability_id in node.required_capabilities:
                if capability_id not in capabilities:
                    errors.append(f"missing capability: {capability_id}")
        for capability_id in recipe.required_capabilities:
            if capability_id not in capabilities:
                errors.append(f"recipe capability is unavailable: {capability_id}")
        for rule_id in recipe.required_rules:
            try:
                rules.require(rule_id)
            except KeyError:
                errors.append(f"recipe rule is unavailable: {rule_id}")

        stages = {node.stage for node in ordered}
        for stage in ("resolve", "compute", "decide", "act", "validate"):
            if stage not in stages:
                errors.append(f"recipe omits required execution stage: {stage}")
        maximum_nodes = spec.constraint("max_nodes")
        if maximum_nodes is not None and len(ordered) > int(maximum_nodes):
            errors.append("execution plan exceeds the TaskSpec node budget")
        known_capability_versions = dict(capabilities.versions())
        if any(
            known_capability_versions.get(capability_id) != version
            for capability_id, version in plan.capability_versions
        ):
            errors.append("execution plan capability versions are stale")
        known_rule_versions = dict(rules.versions())
        if any(
            known_rule_versions.get(rule_id) != version
            for rule_id, version in plan.rule_versions
        ):
            errors.append("execution plan rule versions are stale")
        return StaticCheckReport(tuple(sorted(set(errors))), tuple(sorted(set(warnings))))
