from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import ezdxf
import numpy as np
import pytest

from cadkernel.adapters.conformance import compare_mlight_index
from cadkernel.adapters.dxf import (
    CommandDwgConverter,
    ConversionProvenance,
    DxfAdapter,
    TransformClass,
    classify_transform,
    convert_dwg,
)
from cadkernel.contracts import PrecisionModel, ToleranceProfile


def make_fixture(path: Path) -> None:
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    doc.layers.add("GEOMETRY")
    doc.layers.add("NOTES")
    nested = doc.blocks.new("NESTED")
    nested.add_circle((0, 0), radius=2, dxfattribs={"layer": "GEOMETRY"})
    block = doc.blocks.new("UNIT")
    block.add_line((0, 0), (10, 0), dxfattribs={"layer": "GEOMETRY"})
    block.add_blockref("NESTED", (5, 5), dxfattribs={"xscale": 2.0, "yscale": 1.0})
    model = doc.modelspace()
    model.add_line((0, 0), (100, 0), dxfattribs={"layer": "GEOMETRY"})
    model.add_lwpolyline(
        [(0, 0, 1.0), (10, 0, 0.0)],
        format="xyb",
        dxfattribs={"layer": "GEOMETRY"},
    )
    model.add_text("Panel A", dxfattribs={"insert": (1, 2), "layer": "NOTES"})
    insert = model.add_blockref("UNIT", (1000, 2000), dxfattribs={"layer": "GEOMETRY"})
    insert.grid((2, 2), (20, 30))
    doc.saveas(path)


def test_transform_classification_has_six_explicit_outcomes() -> None:
    identity = np.eye(4)
    assert classify_transform(identity).kind is TransformClass.RIGID
    similarity = np.diag([2.0, 2.0, 2.0, 1.0])
    assert classify_transform(similarity).kind is TransformClass.SIMILARITY
    non_uniform = np.diag([2.0, 1.0, 1.0, 1.0])
    assert classify_transform(non_uniform).kind is TransformClass.NON_UNIFORM_SCALE
    mirrored = np.diag([-1.0, 1.0, 1.0, 1.0])
    assert classify_transform(mirrored).kind is TransformClass.MIRRORED
    singular = np.diag([1.0, 0.0, 1.0, 1.0])
    assert classify_transform(singular).kind is TransformClass.SINGULAR
    affine = np.eye(4)
    affine[0, 1] = 0.5
    assert classify_transform(affine).kind is TransformClass.AFFINE


def test_adapter_preserves_definition_occurrence_paths_and_minsert(tmp_path: Path) -> None:
    drawing = tmp_path / "fixture.dxf"
    make_fixture(drawing)
    result = DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(curve_chord_error=0.01, max_curve_segment_length=10),
        precision=PrecisionModel(grid_size=0.001, max_region_span=10_000),
    )
    snapshot = result.snapshot
    assert snapshot.unit_status == "millimetre"
    assert len(snapshot.definitions) >= 7
    assert len(snapshot.occurrences) > len(snapshot.definitions)  # four block-grid instances
    assert result.statistics.approximation_count >= 5  # bulge plus four transformed nested circles
    paths = "\n".join(snapshot.occurrences.instance_paths.tolist())
    assert "grid:3" in paths
    assert "child:" in paths
    assert any(kind == "ELLIPSE" for kind in snapshot.geometry.source_types.tolist())
    chain_lengths = np.diff(snapshot.occurrences.transform_offsets)
    assert int(chain_lengths.max()) == 2
    assert snapshot.geometry.coordinates.flags.writeable is False
    assert not any(item.code == "VIRTUAL_SOURCE_UNRESOLVED" for item in result.diagnostics)


def test_ocs_curves_are_flattened_in_their_plane_then_converted_to_wcs(tmp_path: Path) -> None:
    drawing = tmp_path / "ocs-curves.dxf"
    document = ezdxf.new("R2018")
    model = document.modelspace()
    extrusion = (0.0, 1.0, 0.0)
    model.add_circle(
        (0.0, 0.0, 0.0),
        radius=5.0,
        dxfattribs={"layer": "OCS_CIRCLE", "extrusion": extrusion},
    )
    model.add_lwpolyline(
        [(0.0, 0.0, 1.0), (10.0, 0.0, 0.0)],
        format="xyb",
        dxfattribs={"layer": "OCS_BULGE", "extrusion": extrusion},
    )
    document.saveas(drawing)

    result = DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(curve_chord_error=0.01, max_curve_segment_length=1.0),
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    )
    snapshot = result.snapshot
    by_type = {}
    for row, source_type in enumerate(snapshot.geometry.source_types):
        start = int(snapshot.geometry.coordinate_offsets[row])
        end = int(snapshot.geometry.coordinate_offsets[row + 1])
        by_type[str(source_type)] = snapshot.geometry.coordinates[start:end]

    assert set(by_type) == {"CIRCLE", "LWPOLYLINE"}
    for coordinates in by_type.values():
        np.testing.assert_allclose(coordinates[:, 1], 0.0, atol=1e-12)
        assert np.ptp(coordinates[:, 2]) > 0.0
    assert not np.any(snapshot.geometry.topology_eligible)
    assert not any(item.code == "ENTITY_GEOMETRY_FAILED" for item in result.diagnostics)


def test_entity_specific_text_and_point_coordinate_conventions(tmp_path: Path) -> None:
    drawing = tmp_path / "entity-coordinate-conventions.dxf"
    document = ezdxf.new("R2018")
    model = document.modelspace()
    extrusion = (0.0, 1.0, 0.0)
    model.add_text(
        "OCS text",
        dxfattribs={"insert": (2.0, 3.0, 4.0), "extrusion": extrusion},
    )
    model.add_mtext(
        "WCS mtext",
        dxfattribs={"insert": (5.0, 6.0, 7.0), "extrusion": extrusion},
    )
    model.add_point(
        (8.0, 9.0, 10.0),
        dxfattribs={"extrusion": extrusion},
    )
    document.saveas(drawing)

    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    ).snapshot
    anchors: dict[str, np.ndarray] = {}
    for row, source_type in enumerate(snapshot.geometry.source_types):
        start = int(snapshot.geometry.coordinate_offsets[row])
        anchors[str(source_type)] = snapshot.geometry.coordinates[start]

    # Autodesk's DXF reference defines TEXT group 10 in OCS, but MTEXT group
    # 10 and POINT group 10 are world-space locations.
    reloaded = ezdxf.readfile(drawing)
    text_entity = next(entity for entity in reloaded.modelspace() if entity.dxftype() == "TEXT")
    np.testing.assert_allclose(
        anchors["TEXT"],
        np.asarray(text_entity.ocs().to_wcs(text_entity.dxf.insert)),
    )
    np.testing.assert_allclose(anchors["MTEXT"], (5.0, 6.0, 7.0))
    np.testing.assert_allclose(anchors["POINT"], (8.0, 9.0, 10.0))

    text_row = int(np.flatnonzero(snapshot.texts.raw_text == "OCS text")[0])
    mtext_row = int(np.flatnonzero(snapshot.texts.raw_text == "WCS mtext")[0])
    np.testing.assert_allclose(snapshot.texts.points[text_row], anchors["TEXT"])
    np.testing.assert_allclose(snapshot.texts.points[mtext_row], anchors["MTEXT"])


def test_spline_adapter_enforces_the_explicit_max_segment_length(tmp_path: Path) -> None:
    drawing = tmp_path / "spline.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_open_spline(
        [(0, 0, 0), (2, 4, 0), (6, -2, 0), (10, 0, 0)],
        degree=3,
    )
    document.saveas(drawing)
    maximum = 0.25
    snapshot = DxfAdapter().build(
        drawing,
        tolerance=ToleranceProfile(
            curve_chord_error=0.01,
            max_curve_segment_length=maximum,
        ),
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    ).snapshot
    assert snapshot.geometry.source_types.tolist() == ["SPLINE"]
    lengths = np.linalg.norm(np.diff(snapshot.geometry.coordinates, axis=0), axis=1)
    assert float(lengths.max()) <= maximum + 1e-12
    assert np.isposinf(snapshot.geometry.approximation_errors[0])
    diagnostics = json.loads(snapshot.diagnostics_json)
    assert [item["code"] for item in diagnostics] == ["SPLINE_APPROXIMATION_ERROR_UNBOUNDED"]


def test_nested_occurrence_class_uses_the_cumulative_virtual_transform(tmp_path: Path) -> None:
    drawing = tmp_path / "cumulative-transform.dxf"
    document = ezdxf.new("R2018")
    leaf = document.blocks.new("LEAF")
    leaf.add_line((0, 0), (1, 0))
    inner = document.blocks.new("INNER")
    inner.add_blockref("LEAF", (3, 0), dxfattribs={"rotation": 30})
    document.modelspace().add_blockref(
        "INNER",
        (10, 20),
        dxfattribs={"xscale": 2.0, "yscale": 1.0, "rotation": 15},
    )
    document.saveas(drawing)

    snapshot = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    ).snapshot
    chain_lengths = np.diff(snapshot.occurrences.transform_offsets)
    nested = np.flatnonzero(chain_lengths == 2)
    assert len(nested) >= 1
    # ezdxf virtual INSERT matrices are cumulative.  Re-composing the stored
    # chain would apply the outer transform twice; classifying its tail is the
    # correct behavior and must retain the outer non-uniform scale.
    assert set(snapshot.occurrences.transform_classes[nested]) == {"non_uniform_scale"}


def test_mlight_conformance_compares_authored_modelspace_not_expansion(tmp_path: Path) -> None:
    drawing = tmp_path / "fixture.dxf"
    make_fixture(drawing)
    result = DxfAdapter().build(drawing, precision=PrecisionModel(max_region_span=10_000))
    records = [
        {"handle": "1", "type": "line", "layer": "GEOMETRY"},
        {"handle": "2", "type": "lwpolyline", "layer": "GEOMETRY"},
        {"handle": "3", "type": "text", "layer": "NOTES"},
        {"handle": "4", "type": "block_reference", "layer": "GEOMETRY"},
    ]
    index = tmp_path / "entities.raw.jsonl"
    index.write_text("\n".join(json.dumps(record) for record in records), encoding="utf-8")
    report = compare_mlight_index(result, index)
    assert report.matches
    assert report.adapter_total == report.mlight_total == 4


def test_mlight_conformance_ignores_non_model_space_records(tmp_path: Path) -> None:
    drawing = tmp_path / "fixture.dxf"
    make_fixture(drawing)
    result = DxfAdapter().build(drawing, precision=PrecisionModel(max_region_span=10_000))
    records = [
        {"handle": "1", "type": "line", "layer": "GEOMETRY", "owner_scope": "model_space"},
        {"handle": "2", "type": "lwpolyline", "layer": "GEOMETRY", "owner_scope": "model_space"},
        {"handle": "3", "type": "text", "layer": "NOTES", "owner_scope": "model_space"},
        {"handle": "4", "type": "block_reference", "layer": "GEOMETRY", "owner_scope": "model_space"},
        # scope=database captures also list block definitions and layouts; they
        # must not diff against the model-space-only adapter surface.
        {"handle": "5", "type": "line", "layer": "GEOMETRY", "owner_scope": "block_definition"},
        {"handle": "6", "type": "circle", "layer": "GEOMETRY", "owner_scope": "block_definition"},
        {"handle": "7", "type": "mtext", "layer": "SHEET", "owner_scope": "paper_space"},
        # Records without owner_scope predate scoped extraction and count as
        # model space, except DEFPOINTS rows which the adapter never counts.
        {"handle": "8", "type": "dimension", "layer": "DEFPOINTS"},
    ]
    index = tmp_path / "entities.raw.jsonl"
    index.write_text("\n".join(json.dumps(record) for record in records), encoding="utf-8")
    report = compare_mlight_index(result, index)
    assert report.matches
    assert report.adapter_total == report.mlight_total == 4


def test_mlight_attribute_exception_requires_exact_nested_count(tmp_path: Path) -> None:
    drawing = tmp_path / "attributes.dxf"
    document = ezdxf.new("R2018")
    block = document.blocks.new("TAGGED")
    block.add_attdef("TAG", (0, 0))
    insert = document.modelspace().add_blockref("TAGGED", (0, 0))
    insert.add_auto_attribs({"TAG": "value"})
    document.saveas(drawing)
    result = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(max_region_span=10_000),
    )
    index = tmp_path / "entities.raw.jsonl"

    index.write_text(
        json.dumps(
            {
                "handle": "1",
                "type": "block_reference",
                "layer": "0",
                "attributes": {"TAG": "value"},
            }
        ),
        encoding="utf-8",
    )
    matching = compare_mlight_index(result, index)
    assert matching.matches
    assert next(item for item in matching.differences if item.key == "attribute").delta == 1

    index.write_text(
        json.dumps(
            {
                "handle": "1",
                "type": "block_reference",
                "layer": "0",
                "attributes": {},
            }
        ),
        encoding="utf-8",
    )
    mismatching = compare_mlight_index(result, index)
    assert not mismatching.matches
    assert any(item.key == "attribute" for item in mismatching.unexplained_differences)


def test_command_converter_provenance_excludes_ephemeral_rendered_target(tmp_path: Path) -> None:
    source = tmp_path / "source.dwg"
    source.write_bytes(b"stable conversion fixture")
    command = (
        sys.executable,
        "-c",
        "import shutil,sys;shutil.copyfile(sys.argv[1],sys.argv[2])",
        "{source}",
        "{target}",
    )
    converter = CommandDwgConverter(command, "copy-fixture", "1")
    first = convert_dwg(source, tmp_path / "one" / "output.dxf", converter)
    second = convert_dwg(source, tmp_path / "two" / "output.dxf", converter)
    assert first.provenance == second.provenance
    assert first.provenance.command == command


def test_adapter_rejects_conversion_provenance_that_does_not_match_files(tmp_path: Path) -> None:
    drawing = tmp_path / "converted.dxf"
    make_fixture(drawing)
    source = tmp_path / "source.dwg"
    source.write_bytes(b"dwg fixture")
    provenance = ConversionProvenance(
        converter="fixture",
        converter_version="1",
        source_sha256="0" * 64,
        output_sha256="f" * 64,
        coordinate_decimal_places=None,
    )
    with pytest.raises(ValueError, match="output_sha256"):
        DxfAdapter().build(
            drawing,
            conversion_provenance=provenance,
            logical_source_path=source,
        )


def test_region_expansion_is_explicit_and_does_not_claim_grid_downgrade(tmp_path: Path) -> None:
    drawing = tmp_path / "wide.dxf"
    document = ezdxf.new("R2018")
    document.modelspace().add_line((0, 0), (2_000, 0))
    document.saveas(drawing)
    result = DxfAdapter().build(
        drawing,
        precision=PrecisionModel(grid_size=0.001, max_region_span=1_000),
    )
    assert result.effective_precision_model.grid_size == 0.001
    assert [item.code for item in result.diagnostics] == ["PRECISION_REGION_EXPANDED"]


def test_grid_downgrade_covers_the_checked_orient2d_boundary(tmp_path: Path) -> None:
    drawing = tmp_path / "overflow-boundary.dxf"
    precision = PrecisionModel(
        grid_size=1.0,
        max_region_span=1.0,
        overflow_safety_factor=0.5,
    )
    old_safe_delta = math.sqrt(
        np.iinfo(np.int64).max * precision.overflow_safety_factor / 2.0
    )
    # This lands immediately below the former nice-grid threshold.  The old
    # downgrade calculation kept grid_size=1 and the second frame build raised
    # CoordinateOverflowError under the newer 8*m^2 predicate bound.
    span = old_safe_delta / (1.0 + 1e-12)
    document = ezdxf.new("R2018")
    document.modelspace().add_line((0.0, 0.0), (span, 0.0))
    document.saveas(drawing)

    result = DxfAdapter().build(drawing, precision=precision)

    assert result.effective_precision_model.grid_size > precision.grid_size
    assert [item.code for item in result.diagnostics] == ["PRECISION_GRID_DOWNGRADED"]
