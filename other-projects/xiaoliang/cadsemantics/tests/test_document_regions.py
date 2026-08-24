from __future__ import annotations

from pathlib import Path

import ezdxf

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.topology import compile_topology
from cadpatterns.runtime import PatternRuntime

from cadsemantics.contracts import (
    IdentityEdgeType,
    RepresentationMode,
    SemanticStatus,
)
from cadsemantics.runtime import SemanticRuntime


_PHYSICAL_MODES = {
    RepresentationMode.INSTANCE_VIEW,
    RepresentationMode.SCHEMATIC_INSTANCE,
    RepresentationMode.AGGREGATED_REPRESENTATION,
}


def _build(document, drawing: Path, profile_name: str):
    document.saveas(drawing)
    tolerance = ToleranceProfile(endpoint_snap=0.01, profile_name=profile_name)
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=tolerance,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1000.0),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    patterns = PatternRuntime().build(snapshot, topology)
    return snapshot, patterns


def _labels(representation) -> set[str]:
    return {
        str(item.normalized_value)
        for item in representation.properties
        if item.property_id == "core.label_text"
    }


def test_symbol_inside_legend_region_demotes_out_of_physical_objects(tmp_path: Path) -> None:
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()
    model.add_line((0.0, 0.0), (30.0, 0.0))
    model.add_line((30.0, 0.0), (30.0, 20.0))
    model.add_line((30.0, 20.0), (0.0, 20.0))
    model.add_line((0.0, 20.0), (0.0, 0.0))
    model.add_text("LEGEND", dxfattribs={"insert": (2.0, 18.0), "height": 1.0})
    block = document.blocks.new(name="MOTIF_B")
    block.add_line((0.0, 0.0), (2.0, 0.0))
    block.add_line((2.0, 0.0), (1.0, 2.0))
    block.add_line((1.0, 2.0), (0.0, 0.0))
    model.add_blockref("MOTIF_B", (5.0, 5.0))
    model.add_blockref("MOTIF_B", (60.0, 5.0))
    snapshot, patterns = _build(document, tmp_path / "legend.dxf", "legend-region")

    result = SemanticRuntime().build(snapshot, patterns)
    representations = result.drawing_graph.representations
    legend = next(
        item
        for item in representations
        if item.semantic_class == "documentation.Legend"
        and item.status is SemanticStatus.SUPPORTED
    )
    symbols = tuple(
        item
        for item in representations
        if item.semantic_class == "generic.SymbolicComponent" and item.bounds is not None
    )
    inside = tuple(item for item in symbols if item.bounds[2] <= 30.0)
    outside = tuple(item for item in symbols if item.bounds[0] >= 60.0)
    assert inside and outside
    assert all(
        item.representation_mode is RepresentationMode.LEGEND_SYMBOL for item in inside
    )
    assert all(
        item.representation_mode is RepresentationMode.SCHEMATIC_INSTANCE
        for item in outside
    )
    assert any(
        relation.relation_type == "core.REFERENCED_IN"
        and relation.target_id == legend.resolution_id
        for relation in result.drawing_graph.relations
        for item in inside
        if relation.source_id == item.resolution_id
    )
    physical_members = {
        representation_id
        for item in result.project_graph.project_objects
        for representation_id in item.representation_ids
    }
    assert all(item.resolution_id not in physical_members for item in inside)


def test_schedule_record_merges_into_the_named_physical_instance(tmp_path: Path) -> None:
    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()
    for x in (0.0, 20.0, 40.0):
        model.add_line((x, 0.0), (x, 20.0))
    for y in (0.0, 10.0, 20.0):
        model.add_line((0.0, y), (40.0, y))
    model.add_text("SCHEDULE", dxfattribs={"insert": (5.0, 15.0), "height": 1.0})
    model.add_text("T1", dxfattribs={"insert": (25.0, 15.0), "height": 1.0})
    model.add_text("T9", dxfattribs={"insert": (5.0, 5.0), "height": 1.0})
    block = document.blocks.new(name="PUMP")
    block.add_line((0.0, 0.0), (2.0, 0.0))
    block.add_line((2.0, 0.0), (1.0, 2.0))
    block.add_line((1.0, 2.0), (0.0, 0.0))
    block.add_attdef("TAG", (0.0, -1.5), dxfattribs={"height": 1.0})
    first = model.add_blockref("PUMP", (60.0, 0.0))
    first.add_attrib("TAG", "T1", (60.0, -1.5), dxfattribs={"height": 1.0})
    second = model.add_blockref("PUMP", (80.0, 0.0))
    second.add_attrib("TAG", "T2", (80.0, -1.5), dxfattribs={"height": 1.0})
    snapshot, patterns = _build(document, tmp_path / "schedule.dxf", "schedule-region")

    result = SemanticRuntime().build(snapshot, patterns)
    representations = result.drawing_graph.representations
    assert any(
        item.semantic_class == "documentation.Schedule"
        and item.status is SemanticStatus.SUPPORTED
        for item in representations
    )
    # Everything the generic pack classifies inside the schedule frame is
    # schedule content, never a physical instance.
    assert all(
        item.representation_mode is RepresentationMode.SCHEDULE_RECORD
        for item in representations
        if item.domain_pack_id == "generic_engineering"
        and item.semantic_class is not None
        and item.bounds is not None
        and 0.0 <= item.bounds[0]
        and item.bounds[2] <= 40.0
        and 0.0 <= item.bounds[1]
        and item.bounds[3] <= 20.0
    )
    schedule = next(
        item
        for item in representations
        if item.semantic_class == "generic.ScheduleRecord"
        and item.status is SemanticStatus.SUPPORTED
    )
    symbols = {
        next(iter(_labels(item) & {"T1", "T2"})): item
        for item in representations
        if item.semantic_class == "generic.SymbolicComponent"
        and item.representation_mode is RepresentationMode.SCHEMATIC_INSTANCE
        and _labels(item) & {"T1", "T2"}
    }
    assert set(symbols) == {"T1", "T2"}
    assert any(
        assertion.edge_type is IdentityEdgeType.SAME_OBJECT_SUPPORTED
        and assertion.status is SemanticStatus.SUPPORTED
        and {assertion.source_representation_id, assertion.target_representation_id}
        == {symbols["T1"].resolution_id, schedule.resolution_id}
        for assertion in result.drawing_graph.identity_assertions
    )
    objects_by_id = {
        item.project_object_id: item for item in result.project_graph.project_objects
    }
    merged = tuple(
        item
        for item in objects_by_id.values()
        if symbols["T1"].resolution_id in item.representation_ids
    )
    assert len(merged) == 1
    assert schedule.resolution_id in merged[0].representation_ids
    assert merged[0].semantic_class == "generic.SymbolicComponent"
    lone = tuple(
        item
        for item in objects_by_id.values()
        if symbols["T2"].resolution_id in item.representation_ids
    )
    assert len(lone) == 1
    assert schedule.resolution_id not in lone[0].representation_ids
    # A schedule row naming no shown instance stays unattached and never
    # becomes a project object on its own.
    t9_label = next(
        item
        for item in representations
        if item.representation_mode is RepresentationMode.SCHEDULE_RECORD
        and _labels(item) == {"T9"}
    )
    assert t9_label.identity_cluster_id is None
    assert all(
        t9_label.resolution_id not in item.representation_ids
        for item in objects_by_id.values()
    )
    modes_by_id = {item.resolution_id: item.representation_mode for item in representations}
    assert all(
        any(modes_by_id[member] in _PHYSICAL_MODES for member in item.representation_ids)
        for item in objects_by_id.values()
    )
