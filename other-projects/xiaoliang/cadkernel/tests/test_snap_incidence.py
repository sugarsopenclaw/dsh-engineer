from __future__ import annotations

from pathlib import Path

import ezdxf
import numpy as np

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.repair import extract_endpoints, propose
from cadkernel.topology import build_incidence_graph, graph_facts


def graph_snapshot(tmp_path: Path):
    drawing = tmp_path / "graph.dxf"
    doc = ezdxf.new("R2018")
    model = doc.modelspace()
    # Square with a 0.0005 authored gap, plus a dangling spur and isolated point.
    model.add_line((0, 0), (10, 0))
    model.add_line((10.0005, 0), (10, 10))
    model.add_line((10, 10), (0, 10))
    model.add_line((0, 10), (0, 0))
    model.add_line((10, 10), (15, 10))
    model.add_point((100, 100))
    doc.saveas(drawing)
    return DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(endpoint_snap=0.001, profile_name="normal"),
        precision=PrecisionModel(grid_size=0.0001, max_region_span=1000),
    ).snapshot


def test_snap_plan_keeps_original_and_snapped_views_and_stable_graph_id(tmp_path: Path) -> None:
    snapshot = graph_snapshot(tmp_path)
    endpoints = extract_endpoints(snapshot)
    original_copy = endpoints.coordinates.copy()
    result = propose(snapshot, endpoints=endpoints)
    plan = result.value
    assert plan is not None
    np.testing.assert_array_equal(endpoints.coordinates, original_copy)
    original = plan.original_view(endpoints)
    snapped = plan.snapped_view(endpoints, snapshot)
    assert original.view_kind == "original"
    assert snapped.view_kind == "snapped"
    assert np.any(np.linalg.norm(original.coordinates - snapped.coordinates, axis=1) > 0)
    assert propose(snapshot, endpoints=endpoints).value.graph_id == plan.graph_id

    strict = ToleranceProfile(endpoint_snap=0.0001, profile_name="strict")
    strict_plan = propose(snapshot, tolerance=strict, endpoints=endpoints).value
    assert strict_plan is not None and strict_plan.graph_id != plan.graph_id


def test_incidence_graph_reports_cycles_dangling_bridge_and_isolated_point(tmp_path: Path) -> None:
    snapshot = graph_snapshot(tmp_path)
    endpoints = extract_endpoints(snapshot)
    plan = propose(snapshot, endpoints=endpoints).value
    assert plan is not None
    incidence = build_incidence_graph(snapshot, endpoints, plan).value
    assert incidence is not None
    facts = graph_facts(snapshot, incidence).value
    assert facts is not None
    assert facts.node_count == 6  # four square corners, spur end, isolated point
    assert facts.edge_count == 5
    assert len(facts.cycles) == 1
    assert len(facts.dangling_nodes) == 1
    assert len(facts.isolated_nodes) == 1
    assert len(facts.bridge_occurrence_ids) == 1
    assert len(facts.articulation_points) == 1


def test_multigraph_cycle_rank_counts_every_parallel_edge_and_self_loop(tmp_path: Path) -> None:
    drawing = tmp_path / "multigraph.dxf"
    document = ezdxf.new("R2018")
    model = document.modelspace()
    for _ in range(3):
        model.add_line((0, 0), (10, 0))
    for _ in range(2):
        model.add_circle((20, 0), radius=2)
    document.saveas(drawing)
    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    ).snapshot
    endpoints = extract_endpoints(snapshot)
    plan = propose(snapshot, endpoints=endpoints).value
    assert plan is not None
    incidence = build_incidence_graph(snapshot, endpoints, plan).value
    assert incidence is not None
    facts = graph_facts(snapshot, incidence).value
    assert facts is not None
    assert facts.edge_count == 5
    assert facts.cycle_count == 4  # 3 parallel edges => 2; two self-loops => 2.
    assert facts.minimum_cycle_basis_count == 4
    assert len(facts.cycles) == 4
