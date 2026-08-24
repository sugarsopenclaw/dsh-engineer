from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import threading

import ezdxf
import pytest

import cadstack.bind as bind_module
import cadstack.build as build_module
import cadstack.ingest as ingest_module
from cadstack.ask import _compact_json, ask_project
from cadstack.bind import bind_project
from cadstack.build import build_drawing
from cadstack.ingest import ingest_drawing
from cadstack.layout import FactsLayout, drawing_artifact_key, normalize_project_relative_path
from cadstack.lookup import probe_drawing
from cadstack.status import project_status
from cadstack.state import state_lock


def _drawing(project: Path) -> tuple[str, str, Path, Path]:
    relative = "drawings/sample.dxf"
    target = project / "drawings" / "sample.dxf"
    target.parent.mkdir(parents=True)
    document = ezdxf.new("R2018")
    model = document.modelspace()
    model.add_line((0, 0), (10, 0))
    model.add_line((10, 0), (10, 5))
    model.add_line((10, 5), (0, 5))
    model.add_line((0, 5), (0, 0))
    model.add_text("ROOM-101", dxfattribs={"insert": (2, 2)})
    document.saveas(target)
    mlight = project / ".xiaoliang" / "cad" / "drawings" / "fixture" / "entities" / "entities.raw.jsonl"
    mlight.parent.mkdir(parents=True)
    records = [
        {"type": "line", "layer": "0"},
        {"type": "line", "layer": "0"},
        {"type": "line", "layer": "0"},
        {"type": "line", "layer": "0"},
        {"type": "text", "layer": "0"},
    ]
    mlight.write_text(
        "".join(json.dumps(item) + "\n" for item in records),
        encoding="utf-8",
    )
    return relative, drawing_artifact_key("sample.dxf", relative), target, mlight


def test_layout_matches_electron_artifact_key_and_rejects_escape(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative = "图纸/总图 01.dwg"
    key = drawing_artifact_key("总图 01.dwg", relative)
    assert key.startswith("总图-01--")
    assert len(key.rsplit("--", 1)[1]) == 12
    assert normalize_project_relative_path("./图纸\\总图 01.dwg") == relative
    layout = FactsLayout.from_project_root(project)
    layout.ensure()
    assert layout.relative(layout.coverage_json(key)).endswith(f"drawings/{key}/coverage.json")

    for invalid in (
        "../outside.dwg",
        "././outside.dwg",
        "/absolute.dwg",
        "C:/absolute.dwg",
        "C:drive-relative.dwg",
        "bad\x00name.dwg",
        "x" * 4_097,
    ):
        try:
            normalize_project_relative_path(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe path was accepted: {invalid}")


def test_layout_does_not_create_through_an_escaping_link(tmp_path: Path) -> None:
    project = tmp_path / "project"
    outside = tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    try:
        (project / ".xiaoliang").symlink_to(outside, target_is_directory=True)
    except OSError as error:
        pytest.skip(f"directory symlinks are unavailable: {error}")

    with pytest.raises(ValueError, match="escaped the project root"):
        FactsLayout.from_project_root(project).ensure()
    assert list(outside.iterdir()) == []


def test_task_summary_compaction_is_bounded_and_reports_total_count() -> None:
    compacted = _compact_json(list(range(100)))
    assert compacted == {
        "items": list(range(50)),
        "total_count": 100,
        "truncated": True,
    }


def test_coverage_gaps_aggregate_repeated_diagnostics() -> None:
    report = {
        "coverage": {
            "diagnostics": [
                {
                    "code": "COLLAPSED_SOURCE_EDGE",
                    "message": "Both endpoints resolve to one cluster.",
                    "required_action": "inspect_topology_stage",
                },
                {
                    "code": "COLLAPSED_SOURCE_EDGE",
                    "message": "Both endpoints resolve to one cluster.",
                    "required_action": "inspect_topology_stage",
                },
            ]
        }
    }
    gaps = ingest_module._known_capability_gaps(report)
    collapsed = [
        gap for gap in gaps if gap.get("missing") == "COLLAPSED_SOURCE_EDGE"
    ]
    assert collapsed == [
        {
            "capability_id": "cadkernel.coverage",
            "missing": "COLLAPSED_SOURCE_EDGE",
            "occurrence_count": 2,
            "reason": "Both endpoints resolve to one cluster.",
            "required_action": "inspect_topology_stage",
        }
    ]


def test_ingest_rejects_an_input_that_changes_during_l1(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, _ = _drawing(project)
    original_sha256_file = ingest_module._sha256_file
    calls = 0

    def unstable_sha256_file(path: Path) -> str:
        nonlocal calls
        digest = original_sha256_file(path)
        if path.resolve() == dxf.resolve():
            calls += 1
            if calls > 1:
                return "0" * 64
        return digest

    monkeypatch.setattr(ingest_module, "_sha256_file", unstable_sha256_file)
    with pytest.raises(RuntimeError, match="input changed while L1 facts were building"):
        ingest_drawing(
            project_root=project,
            drawing_key=key,
            dxf=dxf,
            logical_source=relative,
        )

    layout = FactsLayout.from_project_root(project)
    assert not layout.l1_markdown(key).exists()
    assert not layout.coverage_json(key).exists()
    assert not layout.project_json.exists()


def test_four_layer_roundtrip_and_manifest_verification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, mlight = _drawing(project)

    ingested = ingest_drawing(
        project_root=project,
        drawing_key=key,
        dxf=dxf,
        logical_source=relative,
        mlight_index=mlight,
    )
    assert ingested["layers"]["l1"] == "ready"
    assert ingested["coverage"]["indexed_ratio"] == 1.0
    assert ingested["conformance"]["matches"] is True
    assert len(ingested["mlight_index_sha256"]) == 64

    built = build_drawing(project_root=project, drawing_key=key)
    assert built["layers"]["l2"] == "ready"
    assert built["layers"]["l3"] == "ready"

    menu_started = threading.Event()
    release_menu = threading.Event()
    original_write_menu = bind_module.write_menu

    def delayed_write_menu(binding: object, target: Path) -> None:
        menu_started.set()
        if not release_menu.wait(timeout=5):
            raise TimeoutError("test did not release menu export")
        original_write_menu(binding, target)

    monkeypatch.setattr(bind_module, "write_menu", delayed_write_menu)
    outcome: dict[str, object] = {}

    def run_bind() -> None:
        try:
            outcome["value"] = bind_project(project_root=project)
        except BaseException as error:
            outcome["error"] = error

    thread = threading.Thread(target=run_bind, daemon=True)
    thread.start()
    assert menu_started.wait(timeout=5)
    layout = FactsLayout.from_project_root(project)
    try:
        with state_lock(layout, timeout_seconds=0.5):
            pass
    finally:
        release_menu.set()
    thread.join(timeout=10)
    assert not thread.is_alive()
    if "error" in outcome:
        raise outcome["error"]  # type: ignore[misc]
    bound = outcome["value"]
    assert isinstance(bound, dict)
    assert bound["drawing_keys"] == [key]
    assert bound["source_count"] == 1

    status = project_status(project_root=project, drawing_key=key)
    assert status["status"] == "ready"
    assert status["drawings"][0]["layers"] == {
        "l1": "ready",
        "l2": "ready",
        "l3": "ready",
        "l4": "ready",
    }
    assert status["drawings"][0]["integrity_errors"] == []

    evidence = probe_drawing(
        project_root=project,
        drawing_key=key,
        bbox=(-1, -1, 11, 6),
    )
    assert evidence["mode"] == "bbox"
    assert evidence["evidence"]["value"]["candidate_count"] >= 4

    request = project / "request.json"
    request.write_text(
        json.dumps(
            {
                "task_type": "identify",
                "target": {"semantic_class": "generic.Component"},
                "scope": {"type": "project"},
                "output_contract": ["answer", "evidence_trace"],
            }
        ),
        encoding="utf-8",
    )
    answer = ask_project(project_root=project, request_path=request)
    assert answer["status"] in {
        "completed",
        "partial",
        "blocked",
        "unsupported",
        "review_required",
    }
    assert answer["task_run_id"].startswith("task-run:")
    assert (project / answer["facts_paths"]["bundle"]).is_file()

    request.write_text(
        json.dumps(
            {
                "task_type": "count",
                "target": {"semantic_class": "generic.Component"},
                "scope": {"type": "project"},
                "quantity_bases": ["bom_declared"],
                "output_contract": ["answer", "evidence_trace"],
            }
        ),
        encoding="utf-8",
    )
    unavailable = ask_project(project_root=project, request_path=request)
    assert unavailable["capability_gap"]
    assert "row_segmentation" in json.dumps(unavailable["capability_gap"])
    assert any("BOM-declared" in item for item in unavailable["fallback_suggestions"])

    project_document = json.loads(layout.project_json.read_text(encoding="utf-8"))
    assert project_document["drawings"][key]["source_sha256"] == ingested["source_sha256"]
    assert layout.project_index.is_file()
    assert (layout.menu_root / "index.txt").is_file()

    binding_document = json.loads(layout.binding_json.read_text(encoding="utf-8"))
    outside_snapshot = tmp_path / "outside-snapshot"
    shutil.copytree(
        Path(binding_document["sources"][0]["snapshot_path"]),
        outside_snapshot,
    )
    binding_document["sources"][0]["snapshot_path"] = str(outside_snapshot)
    layout.binding_json.write_text(
        json.dumps(binding_document),
        encoding="utf-8",
    )
    rejected = project_status(project_root=project, drawing_key=key)
    assert rejected["drawings"][0]["layers"]["l4"] == "missing"
    assert any("escapes its project facts store" in item for item in rejected["binding_errors"])
    with pytest.raises(ValueError, match="escapes its project facts store"):
        ask_project(project_root=project, request_path=request)


def test_status_reports_manifest_tampering(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, _ = _drawing(project)
    ingested = ingest_drawing(
        project_root=project,
        drawing_key=key,
        dxf=dxf,
        logical_source=relative,
    )
    assert ingested["conformance"] is None
    assert ingested["mlight_index_sha256"] is None
    layout = FactsLayout.from_project_root(project)
    snapshot = project / json.loads(layout.project_json.read_text(encoding="utf-8"))["drawings"][key]["stores"]["snapshot"]
    database = snapshot / "snapshot.sqlite3"
    database.write_bytes(database.read_bytes() + b"tamper")

    status = project_status(project_root=project, drawing_key=key)
    drawing = status["drawings"][0]
    assert drawing["layers"]["l1"] == "missing"
    assert any(item.startswith("snapshot:size:") for item in drawing["integrity_errors"])


def test_build_commits_l2_before_an_l3_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, _ = _drawing(project)
    ingest_drawing(
        project_root=project,
        drawing_key=key,
        dxf=dxf,
        logical_source=relative,
    )

    def fail_semantics(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("semantic fixture failure")

    monkeypatch.setattr(
        build_module.SemanticRuntime,
        "build_and_store",
        fail_semantics,
    )
    with pytest.raises(RuntimeError, match="semantic fixture failure"):
        build_drawing(project_root=project, drawing_key=key)

    drawing = project_status(project_root=project, drawing_key=key)["drawings"][0]
    assert drawing["layers"] == {
        "l1": "ready",
        "l2": "ready",
        "l3": "failed",
        "l4": "missing",
    }
    assert drawing["last_error"]["stage"] == "l3"
    state = json.loads(
        FactsLayout.from_project_root(project).project_json.read_text(encoding="utf-8")
    )
    stores = state["drawings"][key]["stores"]
    assert "pattern" in stores
    assert "semantic" not in stores


def test_status_hides_facts_paths_of_unbuilt_layers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, _ = _drawing(project)
    ingest_drawing(
        project_root=project,
        drawing_key=key,
        dxf=dxf,
        logical_source=relative,
    )

    def fail_patterns(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("pattern fixture failure")

    monkeypatch.setattr(
        build_module.PatternRuntime,
        "build_and_store",
        fail_patterns,
    )
    with pytest.raises(RuntimeError, match="pattern fixture failure"):
        build_drawing(project_root=project, drawing_key=key)

    drawing = project_status(project_root=project, drawing_key=key)["drawings"][0]
    assert drawing["layers"] == {
        "l1": "ready",
        "l2": "failed",
        "l3": "missing",
        "l4": "missing",
    }
    assert drawing["facts_paths"] == {
        "l1": f".xiaoliang/cad/facts/drawings/{key}/L1.md",
        "coverage": f".xiaoliang/cad/facts/drawings/{key}/coverage.json",
    }
    for relative_path in drawing["facts_paths"].values():
        assert (project / relative_path).exists()
    # The planned semantic path stays in project state for internal use; only
    # the agent-facing status output is filtered.
    state = json.loads(
        FactsLayout.from_project_root(project).project_json.read_text(encoding="utf-8")
    )
    assert "semantic" in state["drawings"][key]["facts_paths"]

    monkeypatch.undo()
    build_drawing(project_root=project, drawing_key=key)
    recovered = project_status(project_root=project, drawing_key=key)["drawings"][0]
    assert recovered["layers"]["l3"] == "ready"
    assert recovered["facts_paths"]["semantic"] == (
        f".xiaoliang/cad/facts/drawings/{key}/semantic"
    )
    for relative_path in recovered["facts_paths"].values():
        assert (project / relative_path).exists()


def test_cli_emits_one_final_json_object(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from cadstack.cli.main import main

    project = tmp_path / "project"
    project.mkdir()
    exit_code = main(["status", "--project-root", str(project)])
    stdout = capsys.readouterr().out
    lines = [line for line in stdout.splitlines() if line.strip()]
    assert exit_code == 0
    assert len(lines) == 1
    payload = json.loads(lines[-1])
    assert payload["ok"] is True
    assert payload["command"] == "status"
    assert payload["status"] == "missing"
    assert payload["drawings"] == []
    assert payload["project_id"].startswith("project:")
    assert payload["facts_paths"]["project_index"] == ".xiaoliang/cad/facts/INDEX.md"


def test_cli_serializes_unexpected_command_errors(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import cadstack.cli.main as cli_module

    project = tmp_path / "project"
    project.mkdir()

    def fail(_args: object) -> dict[str, object]:
        raise AssertionError("unexpected fixture failure")

    monkeypatch.setattr(cli_module, "_execute", fail)
    exit_code = cli_module.main(["status", "--project-root", str(project)])
    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 1
    assert payload == {
        "command": "status",
        "error": {
            "message": "unexpected fixture failure",
            "type": "AssertionError",
        },
        "ok": False,
    }


@pytest.mark.e2e
def test_real_drawing_four_layer_roundtrip(tmp_path: Path) -> None:
    required = {
        "project_root": os.environ.get("XIAOLIANG_CADSTACK_E2E_PROJECT_ROOT"),
        "logical_source": os.environ.get("XIAOLIANG_CADSTACK_E2E_LOGICAL_SOURCE"),
        "dxf": os.environ.get("XIAOLIANG_CADSTACK_E2E_DXF"),
        "mlight_index": os.environ.get("XIAOLIANG_CADSTACK_E2E_MLIGHT_INDEX"),
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        pytest.skip(
            "real corpus paths are opt-in; missing " + ", ".join(sorted(missing))
        )

    source_root = Path(required["project_root"] or "").resolve(strict=True)
    source_relative = normalize_project_relative_path(required["logical_source"] or "")
    source = source_root.joinpath(*source_relative.split("/"))
    dxf = Path(required["dxf"] or "").resolve(strict=True)
    mlight = Path(required["mlight_index"] or "").resolve(strict=True)
    assert source.is_file()
    assert dxf.is_file()
    assert mlight.is_file()

    project = tmp_path / "real-project"
    logical_copy = project.joinpath(*source_relative.split("/"))
    dxf_copy = project / ".inputs" / "mlight-export.dxf"
    mlight_copy = project / ".inputs" / "entities.raw.jsonl"
    for target in (logical_copy, dxf_copy, mlight_copy):
        target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, logical_copy)
    shutil.copy2(dxf, dxf_copy)
    shutil.copy2(mlight, mlight_copy)

    key = drawing_artifact_key(logical_copy.name, source_relative)
    ingested = ingest_drawing(
        project_root=project,
        drawing_key=key,
        dxf=dxf_copy,
        logical_source=source_relative,
        mlight_index=mlight_copy,
    )
    built = build_drawing(project_root=project, drawing_key=key)
    bound = bind_project(project_root=project)
    status = project_status(project_root=project, drawing_key=key)

    assert ingested["layers"]["l1"] == "ready"
    assert ingested["coverage"]["total_source_entities"] > 0
    assert built["layers"] == {
        "l1": "ready",
        "l2": "ready",
        "l3": "ready",
        "l4": "missing",
    }
    assert key in bound["drawing_keys"]
    assert status["status"] == "ready"
    assert status["drawings"][0]["integrity_errors"] == []

    request = project / "identify-request.json"
    request.write_text(
        json.dumps(
            {
                "task_type": "identify",
                "target": {"semantic_class": "generic.Component"},
                "scope": {"type": "project"},
                "output_contract": ["answer", "evidence_trace"],
            }
        ),
        encoding="utf-8",
    )
    answer = ask_project(project_root=project, request_path=request)
    assert answer["task_run_id"].startswith("task-run:")
    assert (project / answer["facts_paths"]["bundle"]).is_file()

    layout = FactsLayout.from_project_root(project)
    index_text = layout.project_index.read_text(encoding="utf-8")
    menu_text = (layout.menu_root / "index.txt").read_text(encoding="utf-8")
    assert key in index_text
    assert "| ready | ready | ready | ready |" in index_text
    assert "quantity readiness:" in menu_text

    conformance = json.loads(layout.coverage_json(key).read_text(encoding="utf-8"))[
        "mlight_conformance"
    ]
    assert conformance is not None
    unexplained = [
        difference
        for difference in conformance["differences"]
        if not difference.get("explanation")
    ]
    assert ingested["conformance"]["unexplained_difference_count"] == len(unexplained)
    if unexplained:
        assert any(
            gap["missing"] == "mlight_conformance"
            for gap in ingested["capability_gaps"]
        )


def test_bind_failure_marks_l4_failed_and_recovers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, _ = _drawing(project)
    ingest_drawing(
        project_root=project,
        drawing_key=key,
        dxf=dxf,
        logical_source=relative,
    )
    build_drawing(project_root=project, drawing_key=key)

    def fail_bind(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("binding fixture failure")

    monkeypatch.setattr(bind_module.ProjectBinding, "bind", fail_bind)
    with pytest.raises(RuntimeError, match="binding fixture failure"):
        bind_project(project_root=project)

    drawing = project_status(project_root=project, drawing_key=key)["drawings"][0]
    assert drawing["layers"] == {
        "l1": "ready",
        "l2": "ready",
        "l3": "ready",
        "l4": "failed",
    }
    assert drawing["last_error"]["stage"] == "l4"
    assert "binding fixture failure" in drawing["last_error"]["message"]

    monkeypatch.undo()
    bound = bind_project(project_root=project)
    assert bound["drawing_keys"] == [key]
    recovered = project_status(project_root=project, drawing_key=key)["drawings"][0]
    assert recovered["layers"]["l4"] == "ready"
    assert recovered["last_error"] is None


def test_bind_success_keeps_last_error_of_unbound_drawings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    relative, key, dxf, _ = _drawing(project)
    other_relative = "drawings/other.dxf"
    other_dxf = project / "drawings" / "other.dxf"
    other_document = ezdxf.new("R2018")
    other_document.modelspace().add_line((0, 0), (3, 4))
    other_document.saveas(other_dxf)
    other_key = drawing_artifact_key("other.dxf", other_relative)
    for drawing_key, dxf_path, source in (
        (key, dxf, relative),
        (other_key, other_dxf, other_relative),
    ):
        ingest_drawing(
            project_root=project,
            drawing_key=drawing_key,
            dxf=dxf_path,
            logical_source=source,
        )
    build_drawing(project_root=project, drawing_key=key)

    def fail_semantics(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("semantic fixture failure")

    monkeypatch.setattr(
        build_module.SemanticRuntime,
        "build_and_store",
        fail_semantics,
    )
    with pytest.raises(RuntimeError, match="semantic fixture failure"):
        build_drawing(project_root=project, drawing_key=other_key)
    monkeypatch.undo()

    bound = bind_project(project_root=project)
    assert bound["drawing_keys"] == [key]

    drawings = {
        item["drawing_key"]: item
        for item in project_status(project_root=project)["drawings"]
    }
    assert drawings[key]["layers"]["l4"] == "ready"
    assert drawings[other_key]["layers"]["l3"] == "failed"
    assert drawings[other_key]["layers"]["l4"] == "missing"
    assert drawings[other_key]["last_error"]["stage"] == "l3"
    assert "semantic fixture failure" in drawings[other_key]["last_error"]["message"]
