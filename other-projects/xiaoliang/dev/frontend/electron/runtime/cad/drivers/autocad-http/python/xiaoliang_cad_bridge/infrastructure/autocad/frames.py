"""Heuristic drawing-frame detection over serialized entities.

Adapted from pi-engineering engineering/cad-bridge at
9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff (MIT).
"""

from __future__ import annotations

from dataclasses import dataclass

from xiaoliang_cad_bridge.domain.geometry import (
    BBox,
    a_series_score,
    bbox_area,
    bbox_contains,
    bbox_from_points,
    bbox_iou,
    is_near_rectangle,
    normalize_bbox,
)


FRAME_HINTS = ("图框", "tk", "frame", "title")
FRAME_LIMIT = 99


@dataclass(frozen=True)
class FrameCandidate:
    bbox: BBox
    source: str
    score: float


def contains_frame_hint(value: object) -> bool:
    normalized = str(value or "").casefold()
    return any(hint in normalized for hint in FRAME_HINTS)


def candidate_from_record(record: dict[str, object]) -> FrameCandidate | None:
    type_name = str(record.get("type", ""))
    layer_hint = contains_frame_hint(record.get("layer"))
    bbox = normalize_bbox(record.get("bbox"))
    source: str | None = None
    base_score = 0.0
    if type_name == "lwpolyline" and bool(record.get("closed")) and is_near_rectangle(record.get("vertices")):
        raw_vertices = record.get("vertices")
        bbox = bbox or bbox_from_points(raw_vertices if isinstance(raw_vertices, list) else [])
        source, base_score = "polyline", 0.62
    elif type_name == "block_reference" and contains_frame_hint(record.get("name")):
        source, base_score = "block", 0.72
    elif layer_hint:
        source, base_score = "layer", 0.52
    if source is None or bbox is None:
        return None
    return FrameCandidate(
        bbox=bbox,
        source=source,
        score=min(0.99, base_score + a_series_score(bbox) * 0.27),
    )


def detect_frames(records: list[dict[str, object]], extents: object) -> list[dict[str, object]]:
    candidates = [
        candidate
        for record in records
        if (candidate := candidate_from_record(record)) is not None
    ]
    candidates.sort(key=lambda candidate: (-bbox_area(candidate.bbox), -candidate.score, candidate.source))
    selected: list[FrameCandidate] = []
    for candidate in candidates:
        if any(bbox_iou(candidate.bbox, existing.bbox) >= 0.9 for existing in selected):
            continue
        if any(bbox_contains(existing.bbox, candidate.bbox) for existing in selected):
            continue
        selected.append(candidate)
    if not selected:
        fallback = normalize_bbox(extents)
        if fallback is None:
            return []
        selected = [FrameCandidate(fallback, "extents", 0.25)]
    selected.sort(key=lambda candidate: (candidate.bbox["min"][1], candidate.bbox["min"][0]))
    return [
        {
            "frame_id": f"frame-{index:02d}",
            "bbox": candidate.bbox,
            "source": candidate.source,
            "confidence": round(candidate.score, 3),
        }
        for index, candidate in enumerate(selected[:FRAME_LIMIT], 1)
    ]
