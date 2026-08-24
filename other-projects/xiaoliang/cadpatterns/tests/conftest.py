from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.indexes import SnapshotStore
from cadkernel.topology import compile_topology, make_topology_payload


@pytest.fixture
def pattern_snapshot(tmp_path: Path):
    drawing = tmp_path / "generic-patterns.dxf"
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()

    for x in (0.0, 10.0, 20.0):
        model.add_line((x, 0.0), (x, 20.0))
    for y in (0.0, 10.0, 20.0):
        model.add_line((0.0, y), (20.0, y))
    for text, point in zip(("A", "B", "C", "D"), ((5, 5), (15, 5), (5, 15), (15, 15))):
        model.add_text(text, dxfattribs={"insert": point, "height": 1.0})

    model.add_line((30.0, 0.0), (40.0, 0.0))
    model.add_line((40.0, 0.0), (50.0, 0.0))
    model.add_line((40.0, 0.0), (40.0, 10.0))

    model.add_line((60.0, 0.0), (70.0, 0.0))
    model.add_line((70.0, 0.0), (70.0, 10.0))
    model.add_line((70.0, 10.0), (60.0, 10.0))
    model.add_line((60.0, 10.0), (60.0, 0.2))

    block = document.blocks.new(name="MOTIF_A")
    block.add_line((0.0, 0.0), (2.0, 0.0))
    block.add_line((2.0, 0.0), (1.0, 2.0))
    block.add_line((1.0, 2.0), (0.0, 0.0))
    model.add_blockref("MOTIF_A", (80.0, 0.0))
    model.add_blockref("MOTIF_A", (90.0, 0.0), dxfattribs={"rotation": 90.0})
    model.add_blockref(
        "MOTIF_A",
        (100.0, 0.0),
        dxfattribs={"xscale": 2.0, "yscale": 2.0},
    )
    document.saveas(drawing)

    tolerance = ToleranceProfile(endpoint_snap=0.01, profile_name="patterns-test")
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000.0),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    snapshot_path = tmp_path / "snapshot"
    SnapshotStore.create(
        snapshot_path,
        snapshot,
        derived_artifacts=(make_topology_payload(snapshot, topology),),
    )
    return snapshot, topology, snapshot_path
