from __future__ import annotations

from dataclasses import replace
from importlib import resources
from pathlib import Path

import pytest

from cadkernel.contracts import Decision, stable_json_dumps, stable_json_loads
from cadkernel.indexes import SnapshotStore
from cadkernel.topology import load_topology

from cadpatterns.contracts import PatternStatus, ProofGrade, ScopeType
from cadpatterns.cli.main import main as cli_main
from cadpatterns.evaluation import candidate_distribution, deterministic_reproduction
from cadpatterns.graph import PatternGraph
from cadpatterns.ontology import (
    GENERIC_ENCLOSURE_CANDIDATE,
    GENERIC_NETWORK_JUNCTION,
    GENERIC_NETWORK_TERMINAL,
    GENERIC_PATH_NETWORK,
    GENERIC_REPEATED_MOTIF_GROUP,
    GENERIC_SYMBOL_LIKE_CLUSTER,
    GENERIC_TABLE_GRID,
    GENERIC_TEXT_BLOCK,
    pattern_spec_from_mapping,
)
from cadpatterns.runtime import PatternRuntime
from cadpatterns.storage import PatternStore


def test_full_pipeline_is_deterministic_and_keeps_source_snapshot_clean(pattern_snapshot) -> None:
    snapshot, topology, snapshot_path = pattern_snapshot
    runtime = PatternRuntime()

    first = runtime.build(snapshot, topology, snapshot_path=snapshot_path)
    second = runtime.build(snapshot, topology, snapshot_path=snapshot_path)

    assert first.to_json() == second.to_json()
    assert first.pattern_graph_id == second.pattern_graph_id
    assert SnapshotStore.verify(snapshot_path) == ()
    assert {scope.scope_type for scope in first.scopes} == set(ScopeType)
    observed_types = {item.pattern_type for item in first.instances}
    assert {
        GENERIC_ENCLOSURE_CANDIDATE,
        GENERIC_NETWORK_JUNCTION,
        GENERIC_NETWORK_TERMINAL,
        GENERIC_PATH_NETWORK,
        GENERIC_REPEATED_MOTIF_GROUP,
        GENERIC_SYMBOL_LIKE_CLUSTER,
        GENERIC_TABLE_GRID,
        GENERIC_TEXT_BLOCK,
    }.issubset(observed_types)
    assert all(
        item.feature("inferred_grid_edges") == ()
        for item in first.instances
        if item.pattern_type == GENERIC_TABLE_GRID
    )
    assert any(
        item.virtual_geometry_ids
        for item in first.instances
        if item.pattern_type == GENERIC_ENCLOSURE_CANDIDATE
    )
    assert all(
        item.status is not PatternStatus.CANDIDATE for item in first.instances
    )


def test_pattern_store_round_trip(pattern_snapshot, tmp_path: Path) -> None:
    snapshot, topology, snapshot_path = pattern_snapshot
    graph = PatternRuntime().build(snapshot, topology, snapshot_path=snapshot_path)
    source_hashes_before = SnapshotStore.describe(snapshot_path).file_sha256

    location = PatternStore.create(
        tmp_path / "pattern-output",
        graph,
        snapshot_path=snapshot_path,
    )
    loaded = PatternStore.load(location.path)

    assert PatternStore.verify(location.path, snapshot_path=snapshot_path) == ()
    assert stable_json_dumps(loaded) == stable_json_dumps(graph)
    assert SnapshotStore.describe(snapshot_path).file_sha256 == source_hashes_before
    assert candidate_distribution(loaded).rows
    spatial_hits = PatternStore.query_region(
        location.path,
        (-1.0, -1.0, 21.0, 21.0),
        status=PatternStatus.SUPPORTED,
    )
    assert any(item.pattern_type == GENERIC_TABLE_GRID for item in spatial_hits)

    second_location = PatternStore.create(
        tmp_path / "second-pattern-output",
        graph,
        snapshot_path=snapshot_path,
    )
    assert location.file_sha256 == second_location.file_sha256


def test_empty_pattern_graph_round_trip(pattern_snapshot, tmp_path: Path) -> None:
    snapshot, topology, snapshot_path = pattern_snapshot
    graph = PatternGraph.create(
        snapshot_id=snapshot.snapshot_id,
        topology_graph_id=topology.snap_plan.graph_id,
        arrangement_id=topology.arrangement.arrangement_id,
        dcel_id=topology.dcel.dcel_id,
        pattern_tolerance_profile_id="pattern-tolerance:empty",
    )

    location = PatternStore.create(
        tmp_path / "empty-output",
        graph,
        snapshot_path=snapshot_path,
    )

    assert PatternStore.load(location.path).to_json() == graph.to_json()

    with pytest.raises(ValueError, match="outside the immutable source snapshot"):
        PatternStore.create(snapshot_path, graph, snapshot_path=snapshot_path)


def test_topology_loader_and_determinism_evaluation(pattern_snapshot) -> None:
    snapshot, _, snapshot_path = pattern_snapshot
    loaded = load_topology(snapshot_path, snapshot)
    assert loaded.value is not None
    runtime = PatternRuntime()
    metric = deterministic_reproduction(
        lambda: runtime.build(snapshot, loaded.value, snapshot_path=snapshot_path)
    )
    assert metric.reproducible
    assert len(set(metric.graph_ids)) == 1


def test_build_query_and_report_cli(pattern_snapshot, tmp_path: Path, capsys) -> None:
    _, _, snapshot_path = pattern_snapshot
    output = tmp_path / "cli-output"

    assert cli_main(["build", str(snapshot_path), "--output", str(output)]) == 0
    built = stable_json_loads(capsys.readouterr().out)
    store_path = built["path"]

    assert cli_main(["query", store_path, "--status", "supported"]) == 0
    queried = stable_json_loads(capsys.readouterr().out)
    assert queried and all(item["status"] == "supported" for item in queried)

    assert (
        cli_main(
            [
                "query",
                store_path,
                "--type",
                GENERIC_TABLE_GRID,
                "--bounds",
                "-1",
                "-1",
                "21",
                "21",
            ]
        )
        == 0
    )
    spatial = stable_json_loads(capsys.readouterr().out)
    assert spatial and all(item["pattern_type"] == GENERIC_TABLE_GRID for item in spatial)

    assert cli_main(["report", store_path]) == 0
    report = stable_json_loads(capsys.readouterr().out)
    assert report["rows"]


def _builtin_spec_path(name: str) -> str:
    return str(resources.files("cadpatterns.specs") / name)


def test_build_with_open_spec_subset_fails_fast(pattern_snapshot, tmp_path: Path) -> None:
    _, _, snapshot_path = pattern_snapshot

    with pytest.raises(ValueError, match="not closed"):
        cli_main(
            [
                "build",
                str(snapshot_path),
                "--output",
                str(tmp_path / "network-only-output"),
                "--spec",
                _builtin_spec_path("generic.path_network.yaml"),
            ]
        )
    with pytest.raises(ValueError, match="not closed"):
        cli_main(
            [
                "build",
                str(snapshot_path),
                "--output",
                str(tmp_path / "cluster-only-output"),
                "--spec",
                _builtin_spec_path("generic.symbol_like_cluster.yaml"),
            ]
        )


def test_build_with_closed_spec_subsets(pattern_snapshot, tmp_path: Path, capsys) -> None:
    _, _, snapshot_path = pattern_snapshot

    text_output = tmp_path / "text-only-output"
    assert (
        cli_main(
            [
                "build",
                str(snapshot_path),
                "--output",
                str(text_output),
                "--spec",
                _builtin_spec_path("generic.text_block.yaml"),
            ]
        )
        == 0
    )
    text_store = stable_json_loads(capsys.readouterr().out)["path"]
    text_types = {item.pattern_type for item in PatternStore.query(text_store)}
    assert text_types == {GENERIC_TEXT_BLOCK}

    network_output = tmp_path / "network-output"
    assert (
        cli_main(
            [
                "build",
                str(snapshot_path),
                "--output",
                str(network_output),
                *(
                    argument
                    for name in (
                        "generic.path_network.yaml",
                        "generic.network_junction.yaml",
                        "generic.network_terminal.yaml",
                    )
                    for argument in ("--spec", _builtin_spec_path(name))
                ),
            ]
        )
        == 0
    )
    network_store = stable_json_loads(capsys.readouterr().out)["path"]
    network_types = {item.pattern_type for item in PatternStore.query(network_store)}
    assert {
        GENERIC_PATH_NETWORK,
        GENERIC_NETWORK_JUNCTION,
        GENERIC_NETWORK_TERMINAL,
    }.issubset(network_types)
    assert network_types <= {
        GENERIC_PATH_NETWORK,
        GENERIC_NETWORK_JUNCTION,
        GENERIC_NETWORK_TERMINAL,
    }


def test_unknown_resolver_name_is_rejected() -> None:
    spec = pattern_spec_from_mapping(
        {
            "schema_version": 1,
            "pattern_type": GENERIC_TEXT_BLOCK,
            "spec_version": "1.0.0",
            "feature_set_version": "1.0.0",
            "feature_precision": 8,
            "detectors": [{"id": "text.block", "version": "1.0.0"}],
            "required_features": [],
            "style_features": [],
            "resolver": "nearest_neighbour",
            "resolver_version": "1.0.0",
            "tolerance_fields": [],
            "hard_constraints": [],
        }
    )
    with pytest.raises(ValueError, match="Unknown resolver"):
        PatternRuntime(specs=[spec])


def test_ambiguous_topology_downgrades_proof_grades(pattern_snapshot) -> None:
    snapshot, topology, _ = pattern_snapshot
    ambiguous = replace(topology, decision=Decision.AMBIGUOUS)

    graph = PatternRuntime().build(snapshot, ambiguous)

    assert graph.instances
    assert all(
        item.proof_grade is not ProofGrade.STRUCTURALLY_PROVEN
        for item in graph.instances
    )
    assert any(
        "ambiguous" in assumption
        for item in graph.instances
        for assumption in item.assumptions
    )


def test_rejected_topology_marks_structural_detectors_unsupported(pattern_snapshot) -> None:
    snapshot, topology, _ = pattern_snapshot
    rejected = replace(topology, decision=Decision.REJECTED)

    graph = PatternRuntime().build(snapshot, rejected)

    gated = {
        GENERIC_ENCLOSURE_CANDIDATE,
        GENERIC_TABLE_GRID,
        GENERIC_PATH_NETWORK,
    }
    gated_instances = [
        item for item in graph.instances if item.pattern_type in gated
    ]
    assert gated_instances
    assert {item.pattern_type for item in gated_instances} == gated
    assert all(
        item.status is PatternStatus.UNSUPPORTED for item in gated_instances
    )
