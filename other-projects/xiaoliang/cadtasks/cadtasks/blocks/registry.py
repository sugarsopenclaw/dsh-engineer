from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from threading import RLock
from typing import Any

from cadtasks.binding import ProjectFactBundle
from cadtasks.capabilities import CapabilityRegistry
from cadtasks.contracts import TaskFragment, TaskSpec
from cadtasks.scope import ResolvedScope, ScopeResolver


@dataclass(frozen=True, slots=True)
class TaskWorkState:
    fragment: TaskFragment
    resolved_scope: ResolvedScope | None = None

    @classmethod
    def empty(cls) -> "TaskWorkState":
        return cls(TaskFragment.create())

    def with_scope(self, scope: ResolvedScope) -> "TaskWorkState":
        return replace(self, resolved_scope=scope)

    def with_fragment(self, fragment: TaskFragment) -> "TaskWorkState":
        return replace(self, fragment=fragment)


@dataclass(frozen=True, slots=True)
class BlockContext:
    task_run_id: str
    spec: TaskSpec
    facts: ProjectFactBundle
    capabilities: CapabilityRegistry
    rules: Any
    scope_resolver: ScopeResolver
    recipe_id: str
    recipe_version: str


TaskBlockFunction = Callable[[BlockContext, TaskWorkState], TaskWorkState]


@dataclass(frozen=True, slots=True)
class TaskBlockSpec:
    block_id: str
    version: str
    stage: str
    input_type: str
    output_type: str
    required_capabilities: tuple[str, ...]
    read_write: str
    resource_class: str
    deterministic: bool

    @property
    def registry_id(self) -> str:
        return self.block_id


class TaskBlockRegistry:
    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: dict[str, tuple[TaskBlockSpec, TaskBlockFunction]] = {}

    def register(self, spec: TaskBlockSpec, function: TaskBlockFunction) -> None:
        with self._lock:
            current = self._entries.get(spec.block_id)
            if current is not None and current[0] != spec:
                raise ValueError(
                    f"Task block {spec.block_id!r} is already registered as "
                    f"version {current[0].version}"
                )
            self._entries[spec.block_id] = (spec, function)

    def resolve(self, block_id: str) -> tuple[TaskBlockSpec, TaskBlockFunction]:
        with self._lock:
            try:
                return self._entries[block_id]
            except KeyError as error:
                raise KeyError(f"Unknown task block: {block_id}") from error

    def specs(self) -> tuple[TaskBlockSpec, ...]:
        with self._lock:
            return tuple(self._entries[key][0] for key in sorted(self._entries))

    def versions(self) -> tuple[tuple[str, str], ...]:
        return tuple((spec.block_id, spec.version) for spec in self.specs())

    def __iter__(self) -> Iterator[TaskBlockSpec]:
        return iter(self.specs())

