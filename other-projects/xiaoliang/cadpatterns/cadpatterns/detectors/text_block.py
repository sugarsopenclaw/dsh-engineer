from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from cadpatterns.candidates import DetectionBatch, DetectionContext, make_candidate, member
from cadpatterns.contracts import (
    DetectorSpec,
    ProofGrade,
    ReferenceKind,
    ScopeType,
    TraceEvent,
    detector_registry,
)
from cadpatterns.ontology import GENERIC_TEXT_BLOCK


TEXT_BLOCK_SPEC = DetectorSpec(
    detector_id="text.block",
    version="1.0.0",
    pattern_type=GENERIC_TEXT_BLOCK,
    summary="Group text anchors into ordered lines and multiline blocks",
    requires_topology=False,
)


@dataclass(frozen=True, slots=True)
class _TextFact:
    occurrence_id: str
    content: str
    x: float
    y: float
    height: float
    rotation: float
    width: float


@dataclass(frozen=True, slots=True)
class _TextLine:
    facts: tuple[_TextFact, ...]
    along_min: float
    along_max: float
    normal: float
    height: float


def _angle_distance(left: float, right: float) -> float:
    return abs(math.atan2(math.sin(left - right), math.cos(left - right)))


def _project(fact: _TextFact, rotation: float) -> tuple[float, float]:
    cosine = math.cos(rotation)
    sine = math.sin(rotation)
    return (
        fact.x * cosine + fact.y * sine,
        -fact.x * sine + fact.y * cosine,
    )


def _scope_facts(context: DetectionContext, scope) -> tuple[_TextFact, ...]:
    text_row = {
        str(occurrence_id): index
        for index, occurrence_id in enumerate(context.snapshot.texts.occurrence_ids)
    }
    facts = []
    for occurrence_id in scope.text_occurrence_ids:
        row = text_row.get(occurrence_id)
        if row is None:
            continue
        content = str(context.snapshot.texts.plain_text[row]).strip()
        if not content:
            continue
        anchor = context.features.get(scope.scope_id, occurrence_id, "text.anchor")
        height = context.features.get(scope.scope_id, occurrence_id, "text.height")
        rotation = context.features.get(scope.scope_id, occurrence_id, "text.rotation")
        if anchor is None or height is None or rotation is None:
            continue
        width = (
            max(len(content), 1)
            * float(height)
            * context.profile.text_character_width_ratio
        )
        facts.append(
            _TextFact(
                occurrence_id=occurrence_id,
                content=content,
                x=float(anchor[0]),
                y=float(anchor[1]),
                height=float(height),
                rotation=float(rotation),
                width=width,
            )
        )
    return tuple(sorted(facts, key=lambda item: item.occurrence_id))


def _lines(context: DetectionContext, facts: tuple[_TextFact, ...]) -> tuple[_TextLine, ...]:
    remaining = list(facts)
    lines: list[_TextLine] = []
    while remaining:
        seed = remaining[0]
        seed_along, seed_normal = _project(seed, seed.rotation)
        baseline_members = []
        for fact in remaining:
            _, normal = _project(fact, seed.rotation)
            baseline_tolerance = (
                max(seed.height, fact.height)
                * context.profile.text_line_alignment_ratio
            )
            if (
                _angle_distance(seed.rotation, fact.rotation)
                <= context.profile.text_rotation_ratio
                and abs(normal - seed_normal) <= baseline_tolerance
            ):
                baseline_members.append(fact)
        baseline_members.sort(
            key=lambda item: (_project(item, seed.rotation)[0], item.occurrence_id)
        )
        for fact in baseline_members:
            remaining.remove(fact)
        current: list[_TextFact] = []
        current_right = 0.0
        for fact in baseline_members:
            along, _ = _project(fact, seed.rotation)
            left = along - fact.width / 2.0
            gap_limit = (
                max(fact.height, current[-1].height)
                * context.profile.text_inline_gap_ratio
                if current
                else 0.0
            )
            if current and left - current_right > gap_limit:
                lines.append(_make_line(current, seed.rotation))
                current = []
            current.append(fact)
            current_right = along + fact.width / 2.0
        if current:
            lines.append(_make_line(current, seed.rotation))
    return tuple(
        sorted(
            lines,
            key=lambda line: (-line.normal, line.along_min, line.facts[0].occurrence_id),
        )
    )


def _make_line(facts: list[_TextFact], rotation: float) -> _TextLine:
    along_values = []
    normal_values = []
    for fact in facts:
        along, normal = _project(fact, rotation)
        along_values.extend((along - fact.width / 2.0, along + fact.width / 2.0))
        normal_values.append(normal)
    return _TextLine(
        facts=tuple(facts),
        along_min=min(along_values),
        along_max=max(along_values),
        normal=float(np.median(np.asarray(normal_values, dtype=np.float64))),
        height=float(np.median(np.asarray([fact.height for fact in facts], dtype=np.float64))),
    )


def _blocks(context: DetectionContext, lines: tuple[_TextLine, ...]) -> tuple[tuple[_TextLine, ...], ...]:
    blocks: list[list[_TextLine]] = []
    for line in lines:
        selected = None
        for block in blocks:
            previous = block[-1]
            spacing = abs(previous.normal - line.normal)
            limit = max(previous.height, line.height) * context.profile.text_line_spacing_ratio
            horizontal_gap = max(
                0.0,
                max(previous.along_min, line.along_min)
                - min(previous.along_max, line.along_max),
            )
            horizontal_limit = max(previous.height, line.height) * context.profile.text_inline_gap_ratio
            if spacing <= limit and horizontal_gap <= horizontal_limit:
                selected = block
                break
        if selected is None:
            blocks.append([line])
        else:
            selected.append(line)
    return tuple(tuple(block) for block in blocks)


def _block_bounds(block: tuple[_TextLine, ...]) -> tuple[float, float, float, float]:
    min_x = min(fact.x - fact.width / 2.0 for line in block for fact in line.facts)
    min_y = min(fact.y - fact.height / 2.0 for line in block for fact in line.facts)
    max_x = max(fact.x + fact.width / 2.0 for line in block for fact in line.facts)
    max_y = max(fact.y + fact.height / 2.0 for line in block for fact in line.facts)
    return min_x, min_y, max_x, max_y


@detector_registry.detector(TEXT_BLOCK_SPEC)
def detect_text_blocks(context: DetectionContext) -> DetectionBatch:
    scopes = context.scopes.of_type(ScopeType.LAYOUT)
    if not scopes:
        scopes = context.scopes.of_type(ScopeType.DRAWING)
    instances = []
    for scope in scopes:
        facts = _scope_facts(context, scope)
        if not facts:
            continue
        lines = _lines(context, facts)
        all_heights = np.asarray([fact.height for fact in facts], dtype=np.float64)
        median_height = float(np.median(all_heights))
        for block in _blocks(context, lines):
            ordered_facts = tuple(fact for line in block for fact in line.facts)
            block_height = float(
                np.median(
                    np.asarray([fact.height for fact in ordered_facts], dtype=np.float64)
                )
            )
            title_denominator = max(
                context.profile.title_height_ratio - 1.0,
                np.finfo(np.float64).eps,
            )
            height_ratio = block_height / max(median_height, np.finfo(np.float64).eps)
            title_likelihood = max(
                0.0,
                min(1.0, (height_ratio - 1.0) / title_denominator),
            )
            spread = float(np.std(np.asarray([line.normal for line in block], dtype=np.float64)))
            cohesion = 1.0 / (
                1.0 + spread / max(block_height, np.finfo(np.float64).eps)
            )
            instances.append(
                make_candidate(
                    context,
                    TEXT_BLOCK_SPEC,
                    pattern_type=GENERIC_TEXT_BLOCK,
                    scope_id=scope.scope_id,
                    members=tuple(
                        member(
                            context,
                            "text_run",
                            ReferenceKind.TEXT,
                            fact.occurrence_id,
                            ordinal=ordinal,
                        )
                        for ordinal, fact in enumerate(ordered_facts)
                    ),
                    proof_grade=ProofGrade.TOLERANCE_DERIVED,
                    score=max(0.0, min(1.0, cohesion)),
                    features=(
                        ("detection_method", "baseline_and_spacing"),
                        ("line_count", len(block)),
                        ("reading_order", tuple(fact.occurrence_id for fact in ordered_facts)),
                        ("text_count", len(ordered_facts)),
                        ("title_likelihood", title_likelihood),
                    ),
                    bounds=_block_bounds(block),
                    assumptions=(
                        "text height and rotation use first-layer values when present and a local-scale fallback otherwise",
                    ),
                )
            )
    return DetectionBatch(
        instances=tuple(instances),
        trace=(
            TraceEvent.create(
                "detector",
                TEXT_BLOCK_SPEC.detector_id,
                "text anchors grouped into deterministic reading blocks",
                (("candidate_count", len(instances)),),
            ),
        ),
    )
