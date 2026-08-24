from __future__ import annotations

from pathlib import Path

import ezdxf
from ezdxf.math import Vec2
from ezdxf.render.mleader import ConnectionSide

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile, stable_json_loads
from cadkernel.topology import compile_topology

from cadpatterns.ontology import GENERIC_SHEET_BOUNDARY_CANDIDATE
from cadpatterns.contracts import RelationType
from cadpatterns.cli.main import main as cli_main
from cadpatterns.runtime import PatternRuntime
from cadpatterns.storage import PatternStore


def test_peripheral_rectangular_face_becomes_sheet_boundary_candidate(tmp_path: Path) -> None:
    drawing = tmp_path / "sheet.dxf"
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()
    model.add_lwpolyline(
        [(0.0, 0.0), (100.0, 0.0), (100.0, 70.0), (0.0, 70.0)],
        close=True,
    )
    model.add_line((20.0, 20.0), (80.0, 20.0))
    model.add_line((20.0, 50.0), (80.0, 50.0))
    document.saveas(drawing)
    tolerance = ToleranceProfile(endpoint_snap=0.01, profile_name="sheet-test")
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000.0),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    graph = PatternRuntime().build(snapshot, topology)
    candidates = tuple(
        item
        for item in graph.instances
        if item.pattern_type == GENERIC_SHEET_BOUNDARY_CANDIDATE
    )
    assert candidates
    assert all(item.feature("rectangularity") >= 0.8 for item in candidates)
    assert all(item.feature("internal_coverage") >= 0.7 for item in candidates)


def test_signature_query_returns_scale_free_same_shape_instances(
    pattern_snapshot,
    tmp_path: Path,
    capsys,
) -> None:
    snapshot, topology, snapshot_path = pattern_snapshot
    graph = PatternRuntime().build(snapshot, topology, snapshot_path=snapshot_path)
    location = PatternStore.create(
        tmp_path / "signature-patterns",
        graph,
        snapshot_path=snapshot_path,
    )
    source = next(
        item for item in graph.instances if item.feature("geometry_signature") is not None
    )
    matches = PatternStore.query_signature(location.path, source.detection_id)
    assert source in matches
    assert len({item.pattern_key for item in matches}) >= 3
    assert all(
        item.feature("geometry_signature") == source.feature("geometry_signature")
        for item in matches
    )
    assert cli_main(
        ["query", location.path, "--signature-of", source.detection_id]
    ) == 0
    queried = stable_json_loads(capsys.readouterr().out)
    assert {item["detection_id"] for item in queried} == {
        item.detection_id for item in matches
    }


def test_multileader_arrow_is_resolved_to_points_to_relation(tmp_path: Path) -> None:
    drawing = tmp_path / "leader.dxf"
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()
    model.add_line((0.0, 0.0), (10.0, 0.0))
    model.add_lwpolyline(
        [(20.0, 0.0), (30.0, 0.0), (30.0, 10.0), (20.0, 10.0)],
        close=True,
    )
    multileader = model.add_multileader_mtext("Standard")
    multileader.set_content("TARGET")
    multileader.add_leader_line(
        ConnectionSide.left,
        [Vec2(0.0, 0.0), Vec2(3.0, 4.0)],
    )
    multileader.build(Vec2(8.0, 4.0))
    document.saveas(drawing)
    tolerance = ToleranceProfile(endpoint_snap=0.05, profile_name="leader-test")
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000.0),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    graph = PatternRuntime().build(snapshot, topology)
    points_to = tuple(edge for edge in graph.edges if edge.relation is RelationType.POINTS_TO)
    assert points_to
    assert all(edge.proof_grade.value == "tolerance_derived" for edge in points_to)
