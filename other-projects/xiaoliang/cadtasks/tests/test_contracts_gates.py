from __future__ import annotations

import ast
from pathlib import Path

import yaml

from cadtasks.blocks import create_builtin_block_registry
from cadtasks.capabilities import create_builtin_capability_registry
from cadtasks.contracts import TaskScope, TaskSpec, TaskTarget
from cadtasks.planning import PlanCompiler, topological_order
from cadtasks.recipes import RecipeSelector, create_builtin_recipe_registry
from cadtasks.rules import PREDICATE_WHITELIST, create_builtin_rule_registry


def _yaml_numbers(value: object):
    if isinstance(value, dict):
        for item in value.values():
            yield from _yaml_numbers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _yaml_numbers(item)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield value


def test_task_source_contains_no_professional_pack_vocabulary() -> None:
    package = Path(__file__).parents[1] / "cadtasks"
    forbidden = (
        "transformer",
        "room",
        "wall",
        "beam",
        "door",
        "window",
        "duct",
    )
    failures = []
    for path in package.rglob("*"):
        if not path.is_file() or path.suffix not in {".py", ".yaml"}:
            continue
        content = path.read_text(encoding="utf-8").casefold()
        failures.extend((path.name, word) for word in forbidden if word in content)
    assert failures == []


def test_rule_and_block_code_contains_no_bare_thresholds() -> None:
    package = Path(__file__).parents[1] / "cadtasks"
    failures = []
    for directory in ("rules", "blocks"):
        for path in (package / directory).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Constant)
                    and isinstance(node.value, (int, float))
                    and not isinstance(node.value, bool)
                    and node.value not in (0, 1, 2)
                ):
                    failures.append((path.name, node.lineno, node.value))
    for path in (package / "rules").rglob("*.yaml"):
        for number in _yaml_numbers(yaml.safe_load(path.read_text(encoding="utf-8"))):
            if number not in (0, 1, 2):
                failures.append((path.name, "yaml", number))
    assert failures == []


def test_rule_predicates_are_exactly_the_declared_whitelist() -> None:
    assert set(PREDICATE_WHITELIST) == {
        "gte",
        "lte",
        "eq",
        "ne",
        "between",
        "distinct",
    }
    rules = create_builtin_rule_registry()
    assert {rule.op for rule in rules.rules()} <= set(PREDICATE_WHITELIST)


def test_every_recipe_compiles_to_a_typed_acyclic_read_only_dag() -> None:
    recipes = create_builtin_recipe_registry()
    blocks = create_builtin_block_registry()
    capabilities = create_builtin_capability_registry()
    rules = create_builtin_rule_registry()
    selector = RecipeSelector()
    compiler = PlanCompiler()
    for recipe in recipes.recipes():
        constraints = {}
        if recipe.task_type.value == "check":
            constraints = {"threshold": 1}
        spec = TaskSpec.create(
            task_type=recipe.task_type,
            target=TaskTarget.create("generic.Target"),
            scope=TaskScope.create(project_id="project:test"),
            quantity_bases=recipe.quantity_bases,
            constraints=constraints,
        )
        assert selector.select(spec, recipes) == recipe
        plan = compiler.compile(
            spec=spec,
            project_snapshot_set_id="project-snapshot-set:" + "0" * 64,
            recipe=recipe,
            blocks=blocks,
            capabilities=capabilities,
            rules=rules,
        )
        assert topological_order(plan.nodes) == plan.nodes
        assert all(node.read_write == "read" for node in plan.nodes)
        assert all(node.input_type == node.output_type for node in plan.nodes)

