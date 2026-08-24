from __future__ import annotations

from pathlib import Path

import ezdxf

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.topology import compile_topology
from cadpatterns.runtime import PatternRuntime

from cadsemantics.contracts import SemanticStatus
from cadsemantics.runtime import SemanticRuntime


def test_sheet_face_is_not_reclassified_as_view_legend_or_physical_space(
    tmp_path: Path,
) -> None:
    drawing = tmp_path / "semantic-sheet.dxf"
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
    tolerance = ToleranceProfile(endpoint_snap=0.01, profile_name="semantic-sheet")
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000.0),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    patterns = PatternRuntime().build(snapshot, topology)
    sheet_patterns = tuple(
        item
        for item in patterns.instances
        if item.pattern_type == "generic.sheet_boundary_candidate"
    )
    assert sheet_patterns
    sheet_faces = {item.feature("face_id") for item in sheet_patterns}
    result = SemanticRuntime().build(snapshot, patterns)
    supported_classes = {
        item.semantic_class
        for item in result.drawing_graph.representations
        if item.status is SemanticStatus.SUPPORTED
    }
    assert {"documentation.Sheet", "documentation.SheetBoundary"}.issubset(
        supported_classes
    )
    pattern_by_key = {item.pattern_key: item for item in patterns.instances}
    assert not any(
        item.status is SemanticStatus.SUPPORTED
        and item.semantic_class
        in {
            "documentation.DrawingView",
            "documentation.Legend",
            "generic.EnclosedSpace",
        }
        and any(
            pattern_by_key[key].feature("face_id") in sheet_faces
            for key in item.source_pattern_keys
        )
        for item in result.drawing_graph.representations
    )
