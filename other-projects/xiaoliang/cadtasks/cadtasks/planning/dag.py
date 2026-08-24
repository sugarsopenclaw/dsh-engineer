from __future__ import annotations

from typing import Iterable

from cadtasks.planning.execution_plan import ExecutionNode


def topological_order(nodes: Iterable[ExecutionNode]) -> tuple[ExecutionNode, ...]:
    values = tuple(nodes)
    by_id = {node.node_id: node for node in values}
    if len(by_id) != len(values):
        raise ValueError("Execution DAG node ids must be unique")
    missing = tuple(
        sorted(
            {
                dependency
                for node in values
                for dependency in node.depends_on
                if dependency not in by_id
            }
        )
    )
    if missing:
        raise ValueError("Execution DAG has unknown dependencies: " + ", ".join(missing))
    indegree = {node.node_id: len(node.depends_on) for node in values}
    dependents: dict[str, list[str]] = {node.node_id: [] for node in values}
    for node in values:
        for dependency in node.depends_on:
            dependents[dependency].append(node.node_id)
    ready = sorted(node_id for node_id, degree in indegree.items() if degree == 0)
    result = []
    while ready:
        node_id = ready.pop(0)
        result.append(by_id[node_id])
        for dependent in sorted(dependents[node_id]):
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                ready.append(dependent)
                ready.sort()
    if len(result) != len(values):
        cyclic = tuple(sorted(node_id for node_id, degree in indegree.items() if degree))
        raise ValueError("Execution DAG contains a cycle: " + ", ".join(cyclic))
    return tuple(result)


def dependency_outputs(
    node: ExecutionNode,
    nodes: Iterable[ExecutionNode],
) -> tuple[str, ...]:
    by_id = {value.node_id: value for value in nodes}
    return tuple(by_id[dependency].output_type for dependency in node.depends_on)

