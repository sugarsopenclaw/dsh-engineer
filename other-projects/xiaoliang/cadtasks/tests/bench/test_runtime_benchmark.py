from __future__ import annotations

import time

import pytest

from cadtasks.binding import ProjectBinding
from cadtasks.contracts import QuantityBasis, TaskScope, TaskSpec, TaskTarget
from cadtasks.runtime import TaskRuntime


@pytest.mark.bench
def test_count_runtime_smoke(project_binding: ProjectBinding) -> None:
    spec = TaskSpec.create(
        task_type="count",
        target=TaskTarget.create("generic.SymbolicComponent"),
        scope=TaskScope.create(project_id=project_binding.project_id),
        quantity_bases=tuple(QuantityBasis),
    )
    started = time.perf_counter()
    result = TaskRuntime().run(project_binding, spec)
    elapsed = time.perf_counter() - started
    assert result.bundle.claims
    assert elapsed < 10.0

