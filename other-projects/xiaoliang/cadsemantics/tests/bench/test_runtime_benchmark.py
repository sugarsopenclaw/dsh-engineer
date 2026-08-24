from __future__ import annotations

import pytest

from cadsemantics.runtime import SemanticRuntime


@pytest.mark.bench
def test_semantic_runtime_smoke_baseline(semantic_sources) -> None:
    snapshot, graph, snapshot_path, pattern_path = semantic_sources
    result = SemanticRuntime().build(
        snapshot,
        graph,
        snapshot_path=snapshot_path,
        pattern_path=pattern_path,
    )
    assert result.drawing_graph.representations
    assert result.coverage.evidence_coverage == 1.0

