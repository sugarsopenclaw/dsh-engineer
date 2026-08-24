"""Deterministic geometry used by frame, quadrant and detail capture.

Adapted from pi-engineering engineering/cad-bridge at
9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff (MIT).
"""

from __future__ import annotations

import math
from collections.abc import Sequence


BBox = dict[str, list[float]]
DETAIL_MAX_ASPECT_RATIO = 4.0


def point2(value: object) -> list[float] | None:
    if not isinstance(value, (list, tuple)):
        try:
            value = list(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
    if len(value) < 2:
        return None
    try:
        x, y = float(value[0]), float(value[1])
    except (IndexError, TypeError, ValueError):
        return None
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return [round(x, 6), round(y, 6)]


def normalize_bbox(value: object) -> BBox | None:
    if not isinstance(value, dict):
        return None
    minimum = point2(value.get("min"))
    maximum = point2(value.get("max"))
    if minimum is None or maximum is None:
        return None
    min_x, max_x = sorted((minimum[0], maximum[0]))
    min_y, max_y = sorted((minimum[1], maximum[1]))
    if max_x - min_x <= 1e-9 or max_y - min_y <= 1e-9:
        return None
    return {"min": [min_x, min_y], "max": [max_x, max_y]}


def bbox_from_points(points: Sequence[Sequence[float]]) -> BBox | None:
    normalized = [point2(point) for point in points]
    usable = [point for point in normalized if point is not None]
    if len(usable) < 2:
        return None
    return normalize_bbox(
        {
            "min": [min(point[0] for point in usable), min(point[1] for point in usable)],
            "max": [max(point[0] for point in usable), max(point[1] for point in usable)],
        }
    )


def detail_window(
    anchor_bboxes: Sequence[object],
    window: object | None = None,
    padding_ratio: float = 0.15,
) -> BBox:
    if isinstance(padding_ratio, bool) or not isinstance(padding_ratio, (int, float)):
        raise ValueError("padding_ratio must be a number between 0 and 0.5")
    ratio = float(padding_ratio)
    if not math.isfinite(ratio) or not 0 <= ratio <= 0.5:
        raise ValueError("padding_ratio must be a number between 0 and 0.5")

    points: list[list[float]] = []
    for value in [*anchor_bboxes, *([window] if window is not None else [])]:
        if not isinstance(value, dict):
            raise ValueError("detail anchors and window must contain min/max coordinates")
        minimum = point2(value.get("min"))
        maximum = point2(value.get("max"))
        if minimum is None or maximum is None:
            raise ValueError("detail anchors and window must contain finite min/max coordinates")
        points.extend((minimum, maximum))
    if not points:
        raise ValueError("at least one anchor bbox or window is required")

    min_x = min(point[0] for point in points)
    min_y = min(point[1] for point in points)
    max_x = max(point[0] for point in points)
    max_y = max(point[1] for point in points)
    base = max(max_x - min_x, max_y - min_y)
    if base <= 1e-9:
        raise ValueError("detail anchors and window cannot all resolve to the same point")

    padding = ratio * base
    min_x -= padding
    min_y -= padding
    max_x += padding
    max_y += padding
    width = max_x - min_x
    height = max_y - min_y
    if width > height * DETAIL_MAX_ASPECT_RATIO:
        target_height = width / DETAIL_MAX_ASPECT_RATIO
        expansion = (target_height - height) / 2
        min_y -= expansion
        max_y += expansion
    elif height > width * DETAIL_MAX_ASPECT_RATIO:
        target_width = height / DETAIL_MAX_ASPECT_RATIO
        expansion = (target_width - width) / 2
        min_x -= expansion
        max_x += expansion

    normalized = normalize_bbox({"min": [min_x, min_y], "max": [max_x, max_y]})
    if normalized is None:
        raise ValueError("detail window must have positive width and height")
    return normalized


def bbox_area(bbox: BBox) -> float:
    return max(0.0, bbox["max"][0] - bbox["min"][0]) * max(
        0.0, bbox["max"][1] - bbox["min"][1]
    )


def bbox_contains(outer: BBox, inner: BBox, tolerance: float = 1e-6) -> bool:
    return (
        outer["min"][0] <= inner["min"][0] + tolerance
        and outer["min"][1] <= inner["min"][1] + tolerance
        and outer["max"][0] >= inner["max"][0] - tolerance
        and outer["max"][1] >= inner["max"][1] - tolerance
    )


def bbox_iou(left: BBox, right: BBox) -> float:
    min_x = max(left["min"][0], right["min"][0])
    min_y = max(left["min"][1], right["min"][1])
    max_x = min(left["max"][0], right["max"][0])
    max_y = min(left["max"][1], right["max"][1])
    intersection = max(0.0, max_x - min_x) * max(0.0, max_y - min_y)
    union = bbox_area(left) + bbox_area(right) - intersection
    return intersection / union if union > 0 else 0.0


def is_near_rectangle(vertices: object, orthogonal_tolerance_degrees: float = 6.0) -> bool:
    if not isinstance(vertices, list):
        return False
    points = [point2(vertex) for vertex in vertices]
    usable = [point for point in points if point is not None]
    if len(usable) == 5 and math.dist(usable[0], usable[-1]) <= 1e-6:
        usable.pop()
    if len(usable) != 4 or bbox_from_points(usable) is None:
        return False
    vectors: list[tuple[float, float]] = []
    for index in range(4):
        current, following = usable[index], usable[(index + 1) % 4]
        vector = (following[0] - current[0], following[1] - current[1])
        if math.hypot(*vector) <= 1e-9:
            return False
        vectors.append(vector)
    sine_tolerance = math.sin(math.radians(orthogonal_tolerance_degrees))
    for index, vector in enumerate(vectors):
        following = vectors[(index + 1) % 4]
        cosine = abs(vector[0] * following[0] + vector[1] * following[1]) / (
            math.hypot(*vector) * math.hypot(*following)
        )
        if cosine > sine_tolerance:
            return False
    return True


def a_series_score(bbox: BBox, tolerance: float = 0.25) -> float:
    width = bbox["max"][0] - bbox["min"][0]
    height = bbox["max"][1] - bbox["min"][1]
    ratio = max(width, height) / min(width, height)
    delta = abs(ratio - math.sqrt(2))
    return max(0.0, 1.0 - delta / tolerance)


def quadrant_bbox(bbox: BBox, quadrant: str | None) -> BBox:
    current = normalize_bbox(bbox)
    if current is None:
        raise ValueError("bbox is invalid")
    if quadrant is None or not quadrant.strip():
        return current
    parts = quadrant.casefold().split("/")
    if len(parts) > 2 or any(part not in {"q1", "q2", "q3", "q4"} for part in parts):
        raise ValueError("quadrant must be q1..q4 with at most one nested level")
    for part in parts:
        min_x, min_y = current["min"]
        max_x, max_y = current["max"]
        mid_x, mid_y = (min_x + max_x) / 2, (min_y + max_y) / 2
        if part == "q1":
            current = {"min": [min_x, mid_y], "max": [mid_x, max_y]}
        elif part == "q2":
            current = {"min": [mid_x, mid_y], "max": [max_x, max_y]}
        elif part == "q3":
            current = {"min": [min_x, min_y], "max": [mid_x, mid_y]}
        else:
            current = {"min": [mid_x, min_y], "max": [max_x, mid_y]}
    return current
