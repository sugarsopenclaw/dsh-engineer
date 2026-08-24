from __future__ import annotations

import json
from pathlib import Path

import ezdxf

from cadkernel.cli.main import main
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.coverage import build_capability_report


def report_drawing(path: Path) -> None:
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    model = doc.modelspace()
    for start, end in [
        ((0, 0), (10, 0)),
        ((10, 0), (10, 10)),
        ((10, 10), (0, 10)),
        ((0, 10), (0, 0)),
    ]:
        model.add_line(start, end, dxfattribs={"layer": "BOUNDARY"})
    model.add_text("Transformer T-01", dxfattribs={"insert": (5, 5), "layer": "LABELS"})
    doc.saveas(path)


def test_report_contains_all_cross_discipline_fact_families(tmp_path: Path) -> None:
    drawing = tmp_path / "report.dxf"
    report_drawing(drawing)
    report = build_capability_report(
        drawing,
        tmp_path / "snapshots",
        tolerance=ToleranceProfile(),
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000),
    )
    assert report.coverage.execution_status == "complete"
    assert report.coverage.parsed_ratio == 1.0
    assert report.coverage.indexed == 5
    assert report.topology.edge_count == 4
    assert len(report.topology.cycles) == 1
    assert report.faces.closed_face_count == 1
    assert report.faces.area_distribution.total == 100.0
    assert report.faces.compilation_decision == "computed"
    assert report.faces.compilation_diagnostics == ()
    assert report.text.fts_term_count > 0
    assert report.scale.snapshot_size_bytes > 0
    assert {timing.stage for timing in report.timings} == {
        "adapter",
        "snapshot_indexes",
        "snap_plan",
        "incidence_graph",
        "arrangement",
        "dcel",
        "report_facts",
    }
    payload = json.loads(report.to_json())
    assert payload["coverage"]["topology_eligible_ratio"] == 0.8
    assert payload["faces"]["dcel_valid"] is True


def test_report_exposes_an_ambiguous_topology_compilation(tmp_path: Path) -> None:
    drawing = tmp_path / "collapsed-source-edge.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_line((0.0, 0.0), (0.0005, 0.0))
    document.saveas(drawing)

    report = build_capability_report(
        drawing,
        tmp_path / "snapshots",
        tolerance=ToleranceProfile(endpoint_snap=0.001, profile_name="conflict"),
        precision=PrecisionModel(grid_size=0.0001, max_region_span=1_000),
    )

    assert report.schema_version == 3
    assert report.coverage.execution_status == "partial"
    assert report.faces.dcel_valid
    assert report.faces.compilation_decision == "ambiguous"
    assert [item.code for item in report.faces.compilation_diagnostics] == [
        "COLLAPSED_SOURCE_EDGE"
    ]
    assert any(
        item.code == "COLLAPSED_SOURCE_EDGE"
        and item.required_action == "inspect_topology_stage"
        for item in report.coverage.diagnostics
    )


def test_cli_report_and_query_are_standalone(tmp_path: Path, capsys) -> None:
    drawing = tmp_path / "cli.dxf"
    report_drawing(drawing)
    output = tmp_path / "report.json"
    snapshot_root = tmp_path / "snapshots"
    exit_code = main(
        [
            "report",
            str(drawing),
            "--snapshot-root",
            str(snapshot_root),
            "--output",
            str(output),
            "--pretty",
            "--max-region-span",
            "1000",
        ]
    )
    assert exit_code == 0
    report = json.loads(output.read_text(encoding="utf-8"))
    snapshot_path = snapshot_root / report["snapshot_id"]
    capsys.readouterr()

    query_exit = main(["query", str(snapshot_path), "--text", "transformer"])
    assert query_exit == 0
    query = json.loads(capsys.readouterr().out)
    assert query["status"] == "success"
    assert len(query["value"]["hits"]) == 1

    face_exit = main(
        ["query", str(snapshot_path), "--faces-bbox", "1", "1", "2", "2"]
    )
    assert face_exit == 0
    face_query = json.loads(capsys.readouterr().out)
    assert face_query["status"] == "success"
    assert len(face_query["value"]["hits"]) == 1


def test_cli_requires_explicit_dwg_conversion_route(tmp_path: Path, capsys) -> None:
    source = tmp_path / "not-opened.dwg"
    exit_code = main(
        [
            "report",
            str(source),
            "--snapshot-root",
            str(tmp_path / "snapshots"),
        ]
    )
    assert exit_code == 2
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "conversion_required"
    assert "--autocad-com" in payload["supported_routes"]
