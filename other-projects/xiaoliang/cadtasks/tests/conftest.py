from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.indexes import SnapshotStore
from cadkernel.topology import compile_topology, make_topology_payload
from cadpatterns.runtime import PatternRuntime
from cadpatterns.storage import PatternStore
from cadsemantics.runtime import SemanticRuntime
from cadsemantics.storage import SemanticStore

from cadtasks.binding import ProjectBinding


def build_source(root: Path, *, offset: float = 0.0):
    root.mkdir(parents=True, exist_ok=True)
    drawing = root / "source.dxf"
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()
    for x in (0.0, 10.0, 20.0):
        model.add_line((x + offset, 0.0), (x + offset, 20.0))
    for y in (0.0, 10.0, 20.0):
        model.add_line((offset, y), (offset + 20.0, y))
    for text, point in zip(
        ("LEGEND", "A", "B", "1600"),
        ((5 + offset, 5), (15 + offset, 5), (5 + offset, 15), (15 + offset, 15)),
    ):
        model.add_text(text, dxfattribs={"insert": point, "height": 1.0})
    model.add_line((30 + offset, 0.0), (40 + offset, 0.0))
    model.add_line((40 + offset, 0.0), (50 + offset, 0.0))
    model.add_line((40 + offset, 0.0), (40 + offset, 10.0))
    block = document.blocks.new(name="MOTIF_A")
    block.add_line((0.0, 0.0), (2.0, 0.0))
    block.add_line((2.0, 0.0), (1.0, 2.0))
    block.add_line((1.0, 2.0), (0.0, 0.0))
    block.add_attdef("TAG", (1.0, 1.0), height=0.5)
    model.add_blockref("MOTIF_A", (60.0 + offset, 0.0)).add_auto_attribs({"TAG": "M-1"})
    model.add_blockref(
        "MOTIF_A",
        (70.0 + offset, 0.0),
        dxfattribs={"rotation": 90.0},
    ).add_auto_attribs({"TAG": "M-1"})
    model.add_blockref(
        "MOTIF_A",
        (80.0 + offset, 0.0),
        dxfattribs={"xscale": 2.0, "yscale": 2.0},
    ).add_auto_attribs({"TAG": "M-2"})
    document.saveas(drawing)

    tolerance = ToleranceProfile(endpoint_snap=0.01, profile_name="tasks-test")
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000.0),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    snapshot_path = root / "snapshot"
    SnapshotStore.create(
        snapshot_path,
        snapshot,
        derived_artifacts=(make_topology_payload(snapshot, topology),),
    )
    pattern_graph = PatternRuntime().build(
        snapshot,
        topology,
        snapshot_path=snapshot_path,
    )
    pattern_location = PatternStore.create(
        root / "patterns",
        pattern_graph,
        snapshot_path=snapshot_path,
    )
    semantic_result = SemanticRuntime().build(
        snapshot,
        pattern_graph,
        snapshot_path=snapshot_path,
        pattern_path=pattern_location.path,
        project_id="project:test",
    )
    semantic_location = SemanticStore.create(
        root / "semantics",
        semantic_result.bundle,
        snapshot_path=snapshot_path,
        pattern_path=pattern_location.path,
    )
    return snapshot_path, Path(pattern_location.path), Path(semantic_location.path)


@pytest.fixture(scope="session")
def project_binding(tmp_path_factory: pytest.TempPathFactory) -> ProjectBinding:
    root = tmp_path_factory.mktemp("cadtasks-source")
    paths = build_source(root)
    return ProjectBinding.bind(project_id="project:test", sources=(paths,))


@pytest.fixture(scope="session")
def two_source_binding(tmp_path_factory: pytest.TempPathFactory) -> ProjectBinding:
    root = tmp_path_factory.mktemp("cadtasks-two-source")
    first = build_source(root / "first")
    second = build_source(root / "second", offset=100.0)
    return ProjectBinding.bind(
        project_id="project:test",
        sources=(first, second),
    )

