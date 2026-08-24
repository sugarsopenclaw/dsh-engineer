from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.bench.run_baseline import run_tier


@pytest.mark.bench
@pytest.mark.skipif(
    os.environ.get("CADKERNEL_RUN_BENCH") != "1",
    reason="set CADKERNEL_RUN_BENCH=1 to run the opt-in performance gate",
)
def test_2k_full_build_and_queries_meet_baseline(tmp_path: Path) -> None:
    result = run_tier(tmp_path, 2_000)
    assert result.meets_budget
    assert result.parsed_source_entities == 2_000

