from __future__ import annotations

import time

import pytest

from cadpatterns.runtime import PatternRuntime


@pytest.mark.bench
def test_synthetic_full_pipeline_smoke_budget(pattern_snapshot) -> None:
    snapshot, topology, snapshot_path = pattern_snapshot
    started = time.perf_counter()

    graph = PatternRuntime().build(snapshot, topology, snapshot_path=snapshot_path)

    elapsed = time.perf_counter() - started
    assert graph.instances
    assert elapsed < 10.0
