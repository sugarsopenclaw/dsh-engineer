from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from cadkernel.contracts import stable_json_dumps

from cadtasks.binding import ProjectBinding, ProjectFactBundle
from cadtasks.capabilities import CapabilityRegistry, create_builtin_capability_registry
from cadtasks.contracts import QuantityBasis, ScopeType, TaskType
from cadtasks.recipes import RecipeRegistry, create_builtin_recipe_registry
from cadtasks.rules import RuleRegistry, create_builtin_rule_registry


@dataclass(frozen=True, slots=True)
class CapabilityMenu:
    project_id: str
    project_snapshot_set_id: str
    source_snapshot_ids: tuple[str, ...]
    semantic_classes: tuple[str, ...]
    scope_types: tuple[str, ...]
    quantity_bases: tuple[tuple[str, str, tuple[str, ...]], ...]
    claim_readiness: tuple[tuple[str, str, tuple[str, ...]], ...]
    recipes: tuple[tuple[str, str, str, tuple[str, ...], tuple[str, ...]], ...]
    recipe_slots: tuple[tuple[str, tuple[str, ...]], ...]
    capabilities: tuple[tuple[str, str], ...]
    rules: tuple[tuple[str, str], ...]

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)


def build_menu(
    facts: ProjectFactBundle,
    *,
    capabilities: CapabilityRegistry | None = None,
    recipes: RecipeRegistry | None = None,
    rules: RuleRegistry | None = None,
) -> CapabilityMenu:
    capability_registry = capabilities or create_builtin_capability_registry()
    recipe_registry = recipes or create_builtin_recipe_registry()
    rule_registry = rules or create_builtin_rule_registry()
    quantity_rows = (
        (QuantityBasis.DRAWING_OCCURRENCE.value, "ready", ()),
        (QuantityBasis.UNIQUE_TAG.value, "ready_with_coverage", ()),
        (
            QuantityBasis.BOM_DECLARED.value,
            "insufficient_evidence",
            ("schedule.row_segmentation",),
        ),
        (
            QuantityBasis.PHYSICAL_INSTANCE.value,
            "ambiguous" if len(facts.sources) == 1 else "insufficient_evidence",
            () if len(facts.sources) == 1 else ("cross_file_identity",),
        ),
    )
    recipe_rows = tuple(
        (
            recipe.recipe_id,
            recipe.version,
            recipe.task_type.value,
            recipe.required_capabilities,
            recipe.required_rules,
        )
        for recipe in recipe_registry.recipes()
    )
    has_signature = bool(facts.signature_index)
    has_area = any(
        bound.instance.feature("area") is not None
        for bound in facts.detection_index.values()
    ) or bool(facts.face_index)
    claim_rows = (
        (
            "SIMILAR_STRUCTURE_SET",
            "ready" if has_signature else "insufficient_evidence",
            () if has_signature else ("pattern.geometry_signature",),
        ),
        ("IDENTIFIED_OBJECT_SET", "ready", ()),
        ("OBJECT_DESCRIPTION", "ready", ()),
        ("EVIDENCE_LINEAGE", "ready", ()),
        ("DRAWING_OCCURRENCE_COUNT", "ready", ()),
        ("UNIQUE_TAG_COUNT", "ready_with_coverage", ()),
        ("BOM_DECLARED_COUNT", "insufficient_evidence", ("schedule.row_segmentation",)),
        (
            "PHYSICAL_INSTANCE_COUNT",
            "ambiguous" if len(facts.sources) == 1 else "insufficient_evidence",
            () if len(facts.sources) == 1 else ("cross_file_identity",),
        ),
        (
            "ENCLOSED_AREA",
            "ready" if has_area else "insufficient_evidence",
            () if has_area else ("persisted_area_fact",),
        ),
        ("CONDITION_CHECK", "requires_parameters", ("constraints.threshold",)),
        ("LABEL_DISTINCTNESS", "ready", ()),
    )
    base_slots = ("target.semantic_class", "scope.project_id")
    recipe_slots = tuple(
        (
            recipe.recipe_id,
            tuple(
                sorted(
                    {
                        *base_slots,
                        *(
                            ("target.selectors.subject_ref",)
                            if recipe.task_type in {TaskType.DESCRIBE, TaskType.TRACE}
                            else ()
                        ),
                        *(
                            ("constraints.op", "constraints.threshold")
                            if recipe.task_type is TaskType.CHECK
                            else ()
                        ),
                    }
                )
            ),
        )
        for recipe in recipe_registry.recipes()
    )
    return CapabilityMenu(
        facts.binding.project_id,
        facts.binding.project_snapshot_set_id,
        facts.source_snapshot_ids,
        facts.semantic_classes,
        tuple(item.value for item in ScopeType),
        quantity_rows,
        claim_rows,
        recipe_rows,
        recipe_slots,
        capability_registry.versions(),
        rule_registry.versions(),
    )


def write_menu(
    binding: ProjectBinding,
    out: str | Path,
    *,
    capabilities: CapabilityRegistry | None = None,
    recipes: RecipeRegistry | None = None,
    rules: RuleRegistry | None = None,
) -> CapabilityMenu:
    facts = ProjectFactBundle.load(binding)
    menu = build_menu(
        facts,
        capabilities=capabilities,
        recipes=recipes,
        rules=rules,
    )
    target = Path(out)
    target.mkdir(parents=True, exist_ok=True)
    (target / "menu.json").write_text(
        menu.to_json(pretty=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    lines = [
        f"project: {menu.project_id}",
        f"snapshot set: {menu.project_snapshot_set_id}",
        "",
        "semantic classes:",
        *(f"  {item}" for item in menu.semantic_classes),
        "",
        "scope types:",
        *(f"  {item}" for item in menu.scope_types),
        "",
        "quantity readiness:",
        *(
            f"  {basis}: {status}"
            + (f" missing={','.join(missing)}" if missing else "")
            for basis, status, missing in menu.quantity_bases
        ),
        "",
        "claim readiness:",
        *(
            f"  {claim_type}: {status}"
            + (f" missing={','.join(missing)}" if missing else "")
            for claim_type, status, missing in menu.claim_readiness
        ),
        "",
        "recipes:",
        *(
            f"  {recipe_id}@{version} task={task_type}"
            for recipe_id, version, task_type, _, _ in menu.recipes
        ),
    ]
    (target / "index.txt").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return menu
