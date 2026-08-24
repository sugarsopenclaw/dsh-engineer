from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cadkernel.contracts import stable_id, stable_json_dumps

from cadtasks.contracts import ID_LENGTH


@dataclass(frozen=True, slots=True)
class ExecutionNode:
    node_id: str
    block_id: str
    block_version: str
    depends_on: tuple[str, ...]
    input_type: str
    output_type: str
    stage: str
    required_capabilities: tuple[str, ...]
    read_write: str
    resource_class: str
    deterministic: bool


@dataclass(frozen=True, slots=True)
class ExecutionPlan:
    execution_plan_id: str
    task_spec_key: str
    project_snapshot_set_id: str
    recipe_id: str
    recipe_version: str
    nodes: tuple[ExecutionNode, ...]
    capability_versions: tuple[tuple[str, str], ...]
    rule_versions: tuple[tuple[str, str], ...]
    compiler_version: str
    ontology_versions: tuple[str, ...] = ()
    pack_versions: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        *,
        task_spec_key: str,
        project_snapshot_set_id: str,
        recipe_id: str,
        recipe_version: str,
        nodes: Iterable[ExecutionNode],
        capability_versions: Iterable[tuple[str, str]],
        rule_versions: Iterable[tuple[str, str]],
        compiler_version: str,
        ontology_versions: Iterable[str] = (),
        pack_versions: Iterable[str] = (),
    ) -> "ExecutionPlan":
        ordered_nodes = tuple(nodes)
        capabilities = tuple(sorted(set(capability_versions)))
        rules = tuple(sorted(set(rule_versions)))
        ontologies = tuple(sorted(set(str(item) for item in ontology_versions)))
        packs = tuple(sorted(set(str(item) for item in pack_versions)))
        digest = stable_id(
            "task-execution-plan",
            task_spec_key,
            project_snapshot_set_id,
            recipe_id,
            recipe_version,
            ordered_nodes,
            capabilities,
            rules,
            compiler_version,
            ontologies,
            packs,
            length=ID_LENGTH,
        )
        return cls(
            "execution-plan:" + digest,
            task_spec_key,
            project_snapshot_set_id,
            recipe_id,
            recipe_version,
            ordered_nodes,
            capabilities,
            rules,
            compiler_version,
            ontologies,
            packs,
        )

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)
