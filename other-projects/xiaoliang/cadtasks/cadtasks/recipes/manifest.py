from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from cadtasks.contracts import MutationPolicy, QuantityBasis, TaskType


@dataclass(frozen=True, slots=True)
class RecipeNode:
    node_id: str
    block_id: str
    depends_on: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RecipeManifest:
    recipe_id: str
    version: str
    summary: str
    task_type: TaskType
    target_parameterized: bool
    supported_mutation_policies: tuple[MutationPolicy, ...]
    quantity_bases: tuple[QuantityBasis, ...]
    required_capabilities: tuple[str, ...]
    required_rules: tuple[str, ...]
    nodes: tuple[RecipeNode, ...]
    source_ref: str

    @property
    def registry_id(self) -> str:
        return self.recipe_id

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
        *,
        source_ref: str,
    ) -> "RecipeManifest":
        raw_nodes = value.get("nodes", ())
        if not isinstance(raw_nodes, (list, tuple)):
            raise TypeError("Recipe nodes must be an array")
        nodes = tuple(
            RecipeNode(
                str(item["node_id"]),
                str(item["block_id"]),
                tuple(sorted(set(str(value) for value in item.get("depends_on", ())))),
            )
            for item in raw_nodes
            if isinstance(item, Mapping)
        )
        return cls(
            str(value["recipe_id"]),
            str(value["version"]),
            str(value.get("summary", "")),
            TaskType(str(value["task_type"]).casefold()),
            bool(value.get("target_parameterized", True)),
            tuple(
                sorted(
                    {
                        MutationPolicy(str(item).casefold())
                        for item in value.get("supported_mutation_policies", ("read_only",))
                    },
                    key=lambda item: item.value,
                )
            ),
            tuple(
                sorted(
                    {
                        QuantityBasis(str(item).casefold())
                        for item in value.get("quantity_bases", ())
                    },
                    key=lambda item: item.value,
                )
            ),
            tuple(sorted(set(str(item) for item in value.get("required_capabilities", ())))),
            tuple(sorted(set(str(item) for item in value.get("required_rules", ())))),
            nodes,
            source_ref,
        )

