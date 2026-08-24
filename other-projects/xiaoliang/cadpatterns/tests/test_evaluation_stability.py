from __future__ import annotations

from dataclasses import replace
import math
from pathlib import Path

import ezdxf

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.topology import compile_topology

from cadpatterns.contracts import PatternToleranceProfile
from cadpatterns.evaluation import (
    scale_stability,
    tolerance_stability,
    transform_stability,
)
from cadpatterns.runtime import PatternRuntime


def _variant_graph(
    path: Path,
    *,
    scale: float = 1.0,
    angle: float = 0.0,
    mirror: bool = False,
    translation: tuple[float, float] = (0.0, 0.0),
):
    cosine = math.cos(angle)
    sine = math.sin(angle)

    def transform(point: tuple[float, float]) -> tuple[float, float]:
        x = -point[0] if mirror else point[0]
        y = point[1]
        x *= scale
        y *= scale
        return (
            x * cosine - y * sine + translation[0],
            x * sine + y * cosine + translation[1],
        )

    document = ezdxf.new("R2018")
    document.header["$INSUNITS"] = 4
    model = document.modelspace()
    for x in (0.0, 10.0, 20.0):
        model.add_line(transform((x, 0.0)), transform((x, 20.0)))
    for y in (0.0, 10.0, 20.0):
        model.add_line(transform((0.0, y)), transform((20.0, y)))
    for text, point in zip(("A", "B", "C", "D"), ((5, 5), (15, 5), (5, 15), (15, 15))):
        model.add_text(
            text,
            dxfattribs={
                "insert": transform(point),
                "height": scale,
                "rotation": math.degrees(angle),
            },
        )
    # Path network: one degree-three junction plus three terminals.
    model.add_line(transform((30.0, 0.0)), transform((40.0, 0.0)))
    model.add_line(transform((40.0, 0.0)), transform((50.0, 0.0)))
    model.add_line(transform((40.0, 0.0)), transform((40.0, 10.0)))
    # Rectangle that only closes through tolerance gap bridging.
    model.add_line(transform((60.0, 0.0)), transform((70.0, 0.0)))
    model.add_line(transform((70.0, 0.0)), transform((70.0, 10.0)))
    model.add_line(transform((70.0, 10.0)), transform((60.0, 10.0)))
    model.add_line(transform((60.0, 10.0)), transform((60.0, 0.2)))
    # Two instances of one motif, one rotated, so repeated grouping is exercised.
    block = document.blocks.new(name="MOTIF_A")
    block.add_line((0.0, 0.0), (2.0 * scale, 0.0))
    block.add_line((2.0 * scale, 0.0), (1.0 * scale, 2.0 * scale))
    block.add_line((1.0 * scale, 2.0 * scale), (0.0, 0.0))
    rotation = math.degrees(angle)
    model.add_blockref(
        "MOTIF_A", transform((80.0, 0.0)), dxfattribs={"rotation": rotation}
    )
    model.add_blockref(
        "MOTIF_A", transform((90.0, 0.0)), dxfattribs={"rotation": rotation + 90.0}
    )
    document.saveas(path)
    tolerance = ToleranceProfile(
        endpoint_snap=0.01 * scale,
        curve_chord_error=0.01 * scale,
        max_curve_segment_length=100.0 * scale,
        profile_name="stability",
    )
    snapshot = DxfAdapter().build(
        path,
        tolerance=tolerance,
        precision=PrecisionModel(
            grid_size=0.001 * scale,
            max_region_span=10000.0 * scale,
        ),
    ).snapshot
    topology = compile_topology(snapshot, tolerance=tolerance)
    return snapshot, topology, PatternRuntime().build(snapshot, topology)


def test_transform_and_scale_stability_on_synthetic_grid(tmp_path: Path) -> None:
    _, _, reference = _variant_graph(tmp_path / "reference.dxf")
    _, _, translated = _variant_graph(
        tmp_path / "translated.dxf", translation=(100.0, -40.0)
    )
    _, _, rotated = _variant_graph(
        tmp_path / "rotated.dxf", angle=math.pi / 2.0
    )
    _, _, mirrored = _variant_graph(tmp_path / "mirrored.dxf", mirror=True)
    _, _, scaled = _variant_graph(tmp_path / "scaled.dxf", scale=1000.0)

    assert transform_stability(reference, translated, transform_name="translation").stable
    assert transform_stability(reference, rotated, transform_name="rotation").stable
    assert transform_stability(reference, mirrored, transform_name="mirror").stable
    assert scale_stability(reference, scaled, scale_name="unit-change").stable


# Ratio knobs with a detection-margin consumer on this fixture. Integer gates
# (junction_min_degree, motif_min_instances) and the mirror_invariant switch have
# no ratio semantics; scope_cluster_gap_ratio rebuilds the scope tree itself, so
# perturbing it is a scope-construction change rather than a detection-margin one.
_SWEPT_RATIO_FIELDS = (
    "gap_bridge_ratio",
    "text_height_ratio",
    "text_character_width_ratio",
    "text_inline_gap_ratio",
    "text_line_alignment_ratio",
    "text_line_spacing_ratio",
    "text_rotation_ratio",
    "title_height_ratio",
    "orthogonal_ratio",
    "grid_coordinate_merge_ratio",
    "cell_bounds_ratio",
    "crossing_boundary_ratio",
    "sheet_min_rectangularity",
    "sheet_min_peripherality",
    "sheet_min_internal_coverage",
    "sheet_min_whitespace_stability",
)

_CLAMPED_RATIO_FIELDS = ("nms_overlap_ratio", "nested_overlap_ratio")


def _perturbed_profile(
    base: PatternToleranceProfile, factor: float, name: str
) -> PatternToleranceProfile:
    changes = {field: getattr(base, field) * factor for field in _SWEPT_RATIO_FIELDS}
    changes.update(
        {
            field: min(1.0, getattr(base, field) * factor)
            for field in _CLAMPED_RATIO_FIELDS
        }
    )
    changes["profile_name"] = name
    return replace(base, **changes)


def test_pattern_tolerance_perturbation_uses_supported_set_jaccard(tmp_path: Path) -> None:
    snapshot, topology, _ = _variant_graph(tmp_path / "tolerance.dxf")
    base = PatternToleranceProfile(snapshot.tolerance_profile_id)
    lower = _perturbed_profile(base, 0.8, "minus-20-percent")
    upper = _perturbed_profile(base, 1.2, "plus-20-percent")
    reference = PatternRuntime(profile=base).build(snapshot, topology)
    lower_graph = PatternRuntime(profile=lower).build(snapshot, topology)
    upper_graph = PatternRuntime(profile=upper).build(snapshot, topology)

    assert tolerance_stability(
        reference, lower_graph, perturbation_name="minus-20-percent"
    ).stable
    assert tolerance_stability(
        reference, upper_graph, perturbation_name="plus-20-percent"
    ).stable
