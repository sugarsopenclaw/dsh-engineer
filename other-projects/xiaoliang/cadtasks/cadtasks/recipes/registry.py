from __future__ import annotations

from importlib import resources
from threading import RLock
from typing import Any, Mapping

import yaml

from cadtasks.recipes.manifest import RecipeManifest


class RecipeRegistry:
    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: dict[str, RecipeManifest] = {}

    def register(self, recipe: RecipeManifest) -> None:
        with self._lock:
            current = self._entries.get(recipe.recipe_id)
            if current is not None and current != recipe:
                raise ValueError(
                    f"Recipe {recipe.recipe_id!r} is already registered as version "
                    f"{current.version}"
                )
            self._entries[recipe.recipe_id] = recipe

    def require(self, recipe_id: str) -> RecipeManifest:
        with self._lock:
            try:
                return self._entries[recipe_id]
            except KeyError as error:
                raise KeyError(f"Unknown recipe: {recipe_id}") from error

    def recipes(self) -> tuple[RecipeManifest, ...]:
        with self._lock:
            return tuple(self._entries[key] for key in sorted(self._entries))

    def versions(self) -> tuple[tuple[str, str], ...]:
        return tuple((recipe.recipe_id, recipe.version) for recipe in self.recipes())


def recipe_from_mapping(
    value: Mapping[str, Any],
    *,
    source_ref: str,
) -> RecipeManifest:
    return RecipeManifest.from_mapping(value, source_ref=source_ref)


def _yaml_resources(root: Any):
    for item in sorted(root.iterdir(), key=lambda value: value.name):
        if item.is_dir():
            yield from _yaml_resources(item)
        elif item.name.endswith(".yaml"):
            yield item


def load_builtin_recipes() -> tuple[RecipeManifest, ...]:
    root = resources.files("cadtasks.recipes")
    recipes = []
    for item in _yaml_resources(root):
        value = yaml.safe_load(item.read_text(encoding="utf-8"))
        if not isinstance(value, Mapping):
            raise TypeError(f"Recipe document root must be an object: {item.name}")
        recipes.append(
            recipe_from_mapping(
                value,
                source_ref=f"package:cadtasks.recipes/{item.parent.name}/{item.name}",
            )
        )
    return tuple(sorted(recipes, key=lambda recipe: recipe.recipe_id))


def create_builtin_recipe_registry() -> RecipeRegistry:
    registry = RecipeRegistry()
    for recipe in load_builtin_recipes():
        registry.register(recipe)
    return registry

