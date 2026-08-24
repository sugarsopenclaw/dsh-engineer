from __future__ import annotations

from cadtasks.contracts import TaskSpec
from cadtasks.recipes.manifest import RecipeManifest
from cadtasks.recipes.registry import RecipeRegistry


class RecipeSelector:
    version = "1.0.0"

    def select(self, spec: TaskSpec, registry: RecipeRegistry) -> RecipeManifest:
        requested = spec.constraint("recipe_id")
        if requested is not None:
            recipe = registry.require(str(requested))
            self._validate(spec, recipe)
            return recipe
        candidates = tuple(
            recipe
            for recipe in registry.recipes()
            if recipe.task_type is spec.task_type
            and spec.mutation_policy in recipe.supported_mutation_policies
        )
        if not candidates:
            raise LookupError(
                f"No registered recipe supports task type {spec.task_type.value!r}"
            )
        if len(candidates) != 1:
            raise LookupError(
                "Recipe selection is ambiguous: "
                + ", ".join(recipe.recipe_id for recipe in candidates)
            )
        return candidates[0]

    @staticmethod
    def _validate(spec: TaskSpec, recipe: RecipeManifest) -> None:
        if recipe.task_type is not spec.task_type:
            raise ValueError("Requested recipe does not implement the TaskSpec type")
        if spec.mutation_policy not in recipe.supported_mutation_policies:
            raise ValueError("Requested recipe does not allow the mutation policy")
        unsupported_bases = set(spec.quantity_bases) - set(recipe.quantity_bases)
        if unsupported_bases:
            raise ValueError(
                "Requested recipe does not support quantity bases: "
                + ", ".join(sorted(item.value for item in unsupported_bases))
            )

