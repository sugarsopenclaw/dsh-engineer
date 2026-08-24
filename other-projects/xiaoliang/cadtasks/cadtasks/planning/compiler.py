from __future__ import annotations

from cadtasks.blocks import TaskBlockRegistry
from cadtasks.capabilities import CapabilityRegistry
from cadtasks.contracts import TaskSpec, TaskType
from cadtasks.planning.dag import topological_order
from cadtasks.planning.execution_plan import ExecutionNode, ExecutionPlan
from cadtasks.planning.static_checker import PlanStaticChecker
from cadtasks.recipes import RecipeManifest
from cadtasks.rules import RuleRegistry


class PlanCompiler:
    version = "1.0.0"

    def __init__(self, checker: PlanStaticChecker | None = None) -> None:
        self.checker = checker or PlanStaticChecker()

    def compile(
        self,
        *,
        spec: TaskSpec,
        project_snapshot_set_id: str,
        recipe: RecipeManifest,
        blocks: TaskBlockRegistry,
        capabilities: CapabilityRegistry,
        rules: RuleRegistry,
        ontology_versions: tuple[str, ...] = (),
        pack_versions: tuple[str, ...] = (),
    ) -> ExecutionPlan:
        nodes = []
        for recipe_node in recipe.nodes:
            block, _ = blocks.resolve(recipe_node.block_id)
            nodes.append(
                ExecutionNode(
                    recipe_node.node_id,
                    block.block_id,
                    block.version,
                    recipe_node.depends_on,
                    block.input_type,
                    block.output_type,
                    block.stage,
                    block.required_capabilities,
                    block.read_write,
                    block.resource_class,
                    block.deterministic,
                )
            )
        ordered = topological_order(nodes)
        rule_versions = dict(rules.versions())
        selected_rules = set(recipe.required_rules)
        if spec.task_type is TaskType.CHECK:
            op = str(spec.constraint("op", "gte"))
            selected_rules.add(
                str(spec.constraint("rule_id", f"generic.numeric_threshold_{op}"))
            )
        for rule_id in selected_rules:
            if rule_id not in rule_versions:
                raise ValueError(f"Execution plan requires an unknown rule: {rule_id}")
        plan = ExecutionPlan.create(
            task_spec_key=spec.task_spec_key,
            project_snapshot_set_id=project_snapshot_set_id,
            recipe_id=recipe.recipe_id,
            recipe_version=recipe.version,
            nodes=ordered,
            capability_versions=capabilities.versions(),
            rule_versions=(
                (rule_id, rule_versions[rule_id])
                for rule_id in sorted(selected_rules)
            ),
            compiler_version=self.version,
            ontology_versions=ontology_versions,
            pack_versions=pack_versions,
        )
        self.checker.check(
            plan,
            spec=spec,
            recipe=recipe,
            blocks=blocks,
            capabilities=capabilities,
            rules=rules,
            ontology_versions=ontology_versions,
            pack_versions=pack_versions,
        ).require_valid()
        return plan
