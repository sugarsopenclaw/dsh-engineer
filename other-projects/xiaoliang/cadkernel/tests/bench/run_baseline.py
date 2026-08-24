"""Reproducible 2k/20k/300k end-to-end performance baseline.

Run from the project root:

    uv run python -m tests.bench.run_baseline --tiers 2000 20000 300000 --output baseline.json
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import math
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import ezdxf
import numpy as np

from cadkernel._serialization import stable_json_dumps
from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.indexes import SnapshotStore, query_faces, query_region, search_text
from cadkernel.topology import compile_topology, make_topology_payload


@dataclass(frozen=True, slots=True)
class QueryBaseline:
    operation: str
    samples: int
    p50_ms: float
    p95_ms: float
    maximum_ms: float
    budget_ms: float
    meets_budget: bool


@dataclass(frozen=True, slots=True)
class TierBaseline:
    requested_entity_count: int
    parsed_source_entities: int
    build_seconds: float
    snapshot_size_bytes: int
    python_peak_memory_bytes: int | None
    process_peak_working_set_bytes: int | None
    stage_seconds: tuple[tuple[str, float], ...]
    arrangement_edge_count: int
    dcel_face_count: int
    queries: tuple[QueryBaseline, ...]
    build_budget_seconds: float | None
    snapshot_budget_bytes: int
    memory_budget_bytes: int
    meets_budget: bool


@dataclass(frozen=True, slots=True)
class BaselineReport:
    schema_version: int
    python_version: str
    tiers: tuple[TierBaseline, ...]


def _peak_working_set() -> int | None:
    if os.name != "nt":
        try:
            import resource

            value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
            return value * (1024 if value < 10**10 else 1)
        except (ImportError, OSError):
            return None
    try:
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        get_current_process = ctypes.windll.kernel32.GetCurrentProcess
        get_current_process.restype = wintypes.HANDLE
        get_process_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
        get_process_memory_info.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(ProcessMemoryCounters),
            wintypes.DWORD,
        ]
        get_process_memory_info.restype = wintypes.BOOL
        process = get_current_process()
        if not get_process_memory_info(
            process, ctypes.byref(counters), counters.cb
        ):
            return None
        return int(counters.PeakWorkingSetSize)
    except (AttributeError, OSError):
        return None


def _generate_dxf(path: Path, entity_count: int) -> tuple[int, int]:
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    document.layers.add("BENCH_GEOMETRY")
    document.layers.add("BENCH_TEXT")
    model = document.modelspace()
    text_count = max(1, entity_count // 1000)
    line_count = entity_count - text_count
    columns = max(1, int(math.ceil(math.sqrt(line_count))))
    for index in range(line_count):
        x = float((index % columns) * 2)
        y = float((index // columns) * 2)
        model.add_line((x, y), (x + 0.5, y), dxfattribs={"layer": "BENCH_GEOMETRY"})
    for index in range(text_count):
        model.add_text(
            f"benchmark label {index}",
            dxfattribs={
                "insert": (float((index % columns) * 2), -10.0 - float(index // columns)),
                "layer": "BENCH_TEXT",
            },
        )
    document.saveas(path)
    return line_count, text_count


def _query_baseline(operation: str, function, samples: int = 40) -> QueryBaseline:
    durations: list[float] = []
    for _ in range(samples):
        started = time.perf_counter()
        function()
        durations.append((time.perf_counter() - started) * 1000.0)
    values = np.asarray(durations, dtype=np.float64)
    p50 = float(np.percentile(values, 50))
    p95 = float(np.percentile(values, 95))
    maximum = float(values.max(initial=0.0))
    return QueryBaseline(operation, samples, p50, p95, maximum, 50.0, p95 <= 50.0)


def run_tier(root: Path, entity_count: int) -> TierBaseline:
    tier_root = root / str(entity_count)
    tier_root.mkdir(parents=True)
    drawing = tier_root / "baseline.dxf"
    line_count, _ = _generate_dxf(drawing, entity_count)
    tolerance = ToleranceProfile(endpoint_snap=0.001, profile_name="bench")
    precision = PrecisionModel(grid_size=0.001, max_region_span=100_000)
    started = time.perf_counter()
    stage_started = started
    adapter = DxfAdapter().build(drawing, tolerance=tolerance, precision=precision)
    stage_seconds: list[tuple[str, float]] = [
        ("adapter", time.perf_counter() - stage_started)
    ]
    stage_started = time.perf_counter()
    compilation = compile_topology(adapter.snapshot, tolerance=tolerance)
    stage_seconds.append(("topology", time.perf_counter() - stage_started))
    stage_started = time.perf_counter()
    payload = make_topology_payload(adapter.snapshot, compilation)
    stage_seconds.append(("payload", time.perf_counter() - stage_started))
    stage_started = time.perf_counter()
    snapshot_path = tier_root / "snapshot"
    location = SnapshotStore.create(
        snapshot_path,
        adapter.snapshot,
        derived_artifacts=(payload,),
    )
    stage_seconds.append(("snapshot_store", time.perf_counter() - stage_started))
    build_seconds = time.perf_counter() - started
    # tracemalloc changes this NumPy/SQLite-heavy workload by several multiples;
    # the OS peak working set is the acceptance measurement for production timing.
    python_peak = None
    process_peak = _peak_working_set()
    loaded = SnapshotStore.load(snapshot_path, verify=False)
    columns = max(1, int(math.ceil(math.sqrt(line_count))))
    middle = line_count // 2
    x = float((middle % columns) * 2)
    y = float((middle // columns) * 2)
    queries = (
        _query_baseline(
            "region",
            lambda: query_region(snapshot_path, loaded, (x - 0.1, y - 0.1, x + 0.6, y + 0.1)),
        ),
        _query_baseline("text", lambda: search_text(snapshot_path, loaded, "benchmark", limit=20)),
        _query_baseline("face", lambda: query_faces(snapshot_path, loaded, (x, y, x + 1, y + 1))),
    )
    build_budget = 60.0 if entity_count >= 300_000 else None
    snapshot_budget = 500 * 1024 * 1024
    memory_budget = 4 * 1024 * 1024 * 1024
    observed_memory = max(python_peak or 0, process_peak or 0)
    meets = (
        (build_budget is None or build_seconds <= build_budget)
        and location.size_bytes <= snapshot_budget
        and observed_memory <= memory_budget
        and all(query.meets_budget for query in queries)
    )
    return TierBaseline(
        requested_entity_count=entity_count,
        parsed_source_entities=adapter.statistics.parsed_source_entities,
        build_seconds=build_seconds,
        snapshot_size_bytes=location.size_bytes,
        python_peak_memory_bytes=python_peak,
        process_peak_working_set_bytes=process_peak,
        stage_seconds=tuple(stage_seconds),
        arrangement_edge_count=len(compilation.arrangement.edge_vertices),
        dcel_face_count=len(compilation.dcel.faces),
        queries=queries,
        build_budget_seconds=build_budget,
        snapshot_budget_bytes=snapshot_budget,
        memory_budget_bytes=memory_budget,
        meets_budget=meets,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tiers", type=int, nargs="+", default=[2_000, 20_000, 300_000])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--work-root", type=Path)
    args = parser.parse_args()
    if any(value < 2 for value in args.tiers):
        parser.error("every tier must contain at least two entities")
    if args.work_root:
        args.work_root.mkdir(parents=True, exist_ok=True)
        root_context = None
        root = args.work_root
    else:
        root_context = tempfile.TemporaryDirectory(prefix="cadkernel-bench-")
        root = Path(root_context.name)
    try:
        tiers = tuple(run_tier(root, value) for value in args.tiers)
        import platform

        report = BaselineReport(2, platform.python_version(), tiers)
        payload = stable_json_dumps(report, pretty=True)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(payload + "\n", encoding="utf-8", newline="\n")
        print(payload)
        return 0 if all(tier.meets_budget for tier in tiers) else 1
    finally:
        if root_context is not None:
            root_context.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
