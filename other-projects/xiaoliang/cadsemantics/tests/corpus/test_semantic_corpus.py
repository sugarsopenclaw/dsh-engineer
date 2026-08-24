from __future__ import annotations

import os
from pathlib import Path

import pytest

from cadkernel.indexes import SnapshotStore
from cadpatterns.storage import PatternStore

from cadsemantics.runtime import SemanticRuntime


@pytest.mark.corpus
def test_external_single_file_semantic_corpus() -> None:
    root_value = os.environ.get("CADSEMANTICS_CORPUS_CASES")
    if not root_value:
        pytest.skip("Set CADSEMANTICS_CORPUS_CASES to a directory of snapshot/pattern case folders")
    root = Path(root_value)
    cases = tuple(sorted(path for path in root.iterdir() if path.is_dir()))
    assert cases
    for case in cases:
        snapshot_path = case / "snapshot"
        pattern_path = case / "patterns"
        snapshot = SnapshotStore.load(snapshot_path)
        graph = PatternStore.load(pattern_path)
        result = SemanticRuntime().build(
            snapshot,
            graph,
            snapshot_path=snapshot_path,
            pattern_path=pattern_path,
        )
        assert result.coverage.evidence_coverage == 1.0
        assert result.coverage.domain_leakage_rate == 0.0
