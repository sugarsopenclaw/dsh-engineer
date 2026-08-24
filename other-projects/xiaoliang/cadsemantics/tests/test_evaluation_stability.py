from __future__ import annotations

from dataclasses import replace
import math
from pathlib import Path

import ezdxf

from cadkernel.adapters.dxf import DxfAdapter
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.topology import compile_topology
from cadpatterns.runtime import PatternRuntime

from cadsemantics.contracts import SemanticToleranceProfile
from cadsemantics.evaluation import scale_stability, tolerance_stability, transform_stability
from cadsemantics.runtime import SemanticRuntime


def _semantic_variant(
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
    model.add_line(transform((30.0, 0.0)), transform((40.0, 0.0)))
    model.add_line(transform((40.0, 0.0)), transform((50.0, 0.0)))
    model.add_line(transform((40.0, 0.0)), transform((40.0, 10.0)))
    document.saveas(path)
    tolerance = ToleranceProfile(
        endpoint_snap=0.01 * scale,
        curve_chord_error=0.01 * scale,
        max_curve_segment_length=100.0 * scale,
        profile_name="semantic-stability",
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
    patterns = PatternRuntime().build(snapshot, topology)
    return snapshot, patterns


def test_transform_scale_and_semantic_tolerance_stability(tmp_path: Path) -> None:
    snapshot, patterns = _semantic_variant(tmp_path / "reference.dxf")
    translated_snapshot, translated_patterns = _semantic_variant(
        tmp_path / "translated.dxf",
        translation=(100.0, -40.0),
    )
    rotated_snapshot, rotated_patterns = _semantic_variant(
        tmp_path / "rotated.dxf",
        angle=math.pi / 2.0,
    )
    mirrored_snapshot, mirrored_patterns = _semantic_variant(
        tmp_path / "mirrored.dxf",
        mirror=True,
    )
    scaled_snapshot, scaled_patterns = _semantic_variant(
        tmp_path / "scaled.dxf",
        scale=1000.0,
    )
    runtime = SemanticRuntime()
    reference = runtime.build(snapshot, patterns).drawing_graph
    translated = runtime.build(translated_snapshot, translated_patterns).drawing_graph
    rotated = runtime.build(rotated_snapshot, rotated_patterns).drawing_graph
    mirrored = runtime.build(mirrored_snapshot, mirrored_patterns).drawing_graph
    scaled = runtime.build(scaled_snapshot, scaled_patterns).drawing_graph
    assert transform_stability(reference, translated, transform_name="translation").stable
    assert transform_stability(reference, rotated, transform_name="rotation").stable
    assert transform_stability(reference, mirrored, transform_name="mirror").stable
    assert scale_stability(reference, scaled, scale_name="unit-change").stable

    base_profile = SemanticToleranceProfile()
    lower = SemanticRuntime(
        profile=replace(base_profile, supported_should_ratio=0.4, profile_name="minus-20-percent")
    ).build(snapshot, patterns).drawing_graph
    upper = SemanticRuntime(
        profile=replace(base_profile, supported_should_ratio=0.6, profile_name="plus-20-percent")
    ).build(snapshot, patterns).drawing_graph
    assert tolerance_stability(reference, lower, perturbation_name="minus-20-percent").stable
    assert tolerance_stability(reference, upper, perturbation_name="plus-20-percent").stable
