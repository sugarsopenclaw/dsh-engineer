from __future__ import annotations

import os
from pathlib import Path

import pytest

from cadkernel.indexes import SnapshotStore
from cadkernel.topology import load_topology

from cadpatterns.evaluation import candidate_distribution
from cadpatterns.runtime import PatternRuntime


@pytest.mark.corpus
def test_external_snapshot_corpus_builds_deterministically() -> None:
    configured = os.environ.get("CADPATTERNS_CORPUS_SNAPSHOTS")
    if not configured:
        pytest.skip("Set CADPATTERNS_CORPUS_SNAPSHOTS to an immutable snapshot root")
    root = Path(configured)
    snapshot_paths = tuple(
        sorted(
            path.parent
            for path in root.rglob("manifest.json")
            if (path.parent / "snapshot.sqlite3").is_file()
        )
    )
    if not snapshot_paths:
        pytest.fail("No immutable first-layer snapshots were found in the corpus root")
    runtime = PatternRuntime()
    for snapshot_path in snapshot_paths:
        snapshot = SnapshotStore.load(snapshot_path)
        topology = load_topology(snapshot_path, snapshot)
        assert topology.value is not None
        first = runtime.build(snapshot, topology.value, snapshot_path=snapshot_path)
        second = runtime.build(snapshot, topology.value, snapshot_path=snapshot_path)
        assert first.to_json() == second.to_json()
        assert candidate_distribution(first) == candidate_distribution(second)
