"""Serialize AutoCAD COM entities into bounded JSON records.

COM objects never leave the STA thread. Adapted from pi-engineering
engineering/cad-bridge at 9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff (MIT).
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable

from xiaoliang_cad_bridge.domain.geometry import bbox_from_points, normalize_bbox
from xiaoliang_cad_bridge.errors import raise_if_call_rejected


GEOMETRY_TYPES = {
    "line",
    "lwpolyline",
    "2d_polyline",
    "3d_polyline",
    "circle",
    "arc",
    "ellipse",
    "spline",
}
READABLE_TYPES = {
    "text",
    "mtext",
    "dimension",
    "block_reference",
    "table",
    "leader",
    "mleader",
    "hatch",
}
MAX_TEXT_LENGTH = 16_384
MAX_NAME_LENGTH = 1_024
MAX_GEOMETRY_POINTS = 20_000


def safe_attr(value: object, name: str, default: object = None) -> object:
    try:
        return getattr(value, name)
    except Exception as error:
        raise_if_call_rejected(error)
        return default


def bounded_text(value: object, maximum: int = MAX_TEXT_LENGTH) -> str:
    return str(value or "")[:maximum]


def finite_number(value: object, digits: int = 6) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, digits) if math.isfinite(number) else None


def point3(value: object) -> list[float] | None:
    if not isinstance(value, (list, tuple)):
        try:
            value = list(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
    if len(value) < 2:
        return None
    x, y = finite_number(value[0]), finite_number(value[1])
    z = finite_number(value[2]) if len(value) > 2 else None
    if x is None or y is None:
        return None
    return [x, y] if z is None else [x, y, z]


def entity_bbox(entity: object) -> dict[str, list[float]] | None:
    try:
        minimum, maximum = entity.GetBoundingBox()
    except Exception as error:
        raise_if_call_rejected(error)
        return None
    return normalize_bbox({"min": point3(minimum), "max": point3(maximum)})


def clean_mtext(value: str) -> str:
    cleaned = value.replace("%%132", "φ").replace("%%133", "φ")
    cleaned = cleaned.replace("\\P", "\n").replace("\\~", " ")
    cleaned = re.sub(r"\\[A-Za-z][^;{}]*;", "", cleaned)
    cleaned = cleaned.replace("{", "").replace("}", "")
    return " ".join(cleaned.split())[:MAX_TEXT_LENGTH]


def object_type(entity: object) -> tuple[str, str]:
    object_name = bounded_text(safe_attr(entity, "ObjectName", "Unknown"), 256) or "Unknown"
    mapping = {
        "AcDbLine": "line",
        "AcDbCircle": "circle",
        "AcDbArc": "arc",
        "AcDbEllipse": "ellipse",
        "AcDbSpline": "spline",
        "AcDbPolyline": "lwpolyline",
        "AcDb2dPolyline": "2d_polyline",
        "AcDb3dPolyline": "3d_polyline",
        "AcDbText": "text",
        "AcDbMText": "mtext",
        "AcDbBlockReference": "block_reference",
        "AcDbHatch": "hatch",
        "AcDbTable": "table",
        "AcDbLeader": "leader",
        "AcDbMLeader": "mleader",
    }
    if "Dimension" in object_name:
        return object_name, "dimension"
    return object_name, mapping.get(
        object_name,
        object_name.removeprefix("AcDb").lower() if object_name.startswith("AcDb") else object_name.lower(),
    )


def base_common(entity: object) -> dict[str, object]:
    object_name, type_name = object_type(entity)
    return {
        "handle": bounded_text(safe_attr(entity, "Handle", ""), 64).upper(),
        "type": type_name,
        "object_name": object_name,
        "layer": bounded_text(safe_attr(entity, "Layer", ""), MAX_NAME_LENGTH),
        "visible": bool(safe_attr(entity, "Visible", True)),
        "bbox": entity_bbox(entity),
    }


def flat_points(value: object, dimensions: int) -> list[list[float]]:
    try:
        coordinates = list(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return []
    points: list[list[float]] = []
    maximum_coordinates = MAX_GEOMETRY_POINTS * dimensions
    for index in range(0, min(len(coordinates), maximum_coordinates) - dimensions + 1, dimensions):
        point = point3(coordinates[index : index + dimensions])
        if point is not None:
            points.append(point[:2])
    return points


def com_items(value: object, *, limit: int = 10_000) -> Iterable[object]:
    count = safe_attr(value, "Count")
    if isinstance(count, int):
        for index in range(min(count, limit)):
            try:
                yield value.Item(index)
            except Exception as error:
                raise_if_call_rejected(error)
        return
    try:
        for index, item in enumerate(value):  # type: ignore[arg-type]
            if index >= limit:
                break
            yield item
    except TypeError:
        return


def serialize_text(entity: object, result: dict[str, object], *, mtext: bool) -> None:
    content = bounded_text(safe_attr(entity, "TextString", ""))
    result.update(
        {
            "content": content,
            "content_clean": clean_mtext(content) if mtext else content,
            "position": point3(safe_attr(entity, "InsertionPoint"))
            or point3(safe_attr(entity, "TextAlignmentPoint")),
            "height": finite_number(safe_attr(entity, "Height")),
            "rotation": finite_number(safe_attr(entity, "Rotation")),
            "style": bounded_text(safe_attr(entity, "StyleName", ""), MAX_NAME_LENGTH),
        }
    )


def serialize_dimension(entity: object, result: dict[str, object]) -> None:
    object_name = str(result["object_name"])
    point_pairs = {
        "point1": ("ExtLine1Point", "XLine1Point", "Center", "Origin", "DefiningPoint"),
        "point2": ("ExtLine2Point", "XLine2Point", "ChordPoint", "LeaderEndPoint"),
    }
    result.update(
        {
            "dimension_type": object_name.removeprefix("AcDb"),
            "measurement": finite_number(safe_attr(entity, "Measurement"), 4),
            "text_override": bounded_text(safe_attr(entity, "TextOverride", "")),
            "text_position": point3(safe_attr(entity, "TextPosition")),
        }
    )
    for output, names in point_pairs.items():
        result[output] = next(
            (point for name in names if (point := point3(safe_attr(entity, name))) is not None),
            None,
        )


def serialize_block(entity: object, result: dict[str, object]) -> None:
    attributes: dict[str, str] = {}
    try:
        for attribute in com_items(entity.GetAttributes(), limit=500):
            tag = bounded_text(safe_attr(attribute, "TagString", ""), MAX_NAME_LENGTH)
            if tag:
                attributes[tag] = bounded_text(safe_attr(attribute, "TextString", ""))
    except Exception as error:
        raise_if_call_rejected(error)
    result.update(
        {
            "name": bounded_text(
                safe_attr(entity, "EffectiveName", "") or safe_attr(entity, "Name", ""),
                MAX_NAME_LENGTH,
            ),
            "insert_point": point3(safe_attr(entity, "InsertionPoint")),
            "rotation": finite_number(safe_attr(entity, "Rotation")),
            "scale": [
                finite_number(safe_attr(entity, "XScaleFactor")) or 1.0,
                finite_number(safe_attr(entity, "YScaleFactor")) or 1.0,
                finite_number(safe_attr(entity, "ZScaleFactor")) or 1.0,
            ],
            "attributes": attributes,
        }
    )


def serialize_table(entity: object, result: dict[str, object]) -> None:
    rows = int(safe_attr(entity, "Rows", 0) or 0)
    columns = int(safe_attr(entity, "Columns", 0) or 0)
    cells: list[list[str]] = []
    for row_index in range(min(rows, 500)):
        row: list[str] = []
        for column_index in range(min(columns, 100)):
            try:
                row.append(bounded_text(entity.GetText(row_index, column_index), 4_096))
            except Exception as error:
                raise_if_call_rejected(error)
                row.append("")
        cells.append(row)
    result.update(
        {
            "rows": rows,
            "columns": columns,
            "cells": cells,
            "insert_point": point3(safe_attr(entity, "InsertionPoint")),
            "cells_truncated": rows > 500 or columns > 100,
        }
    )


def serialize_geometry(entity: object, result: dict[str, object]) -> None:
    type_name = str(result["type"])
    if type_name == "line":
        result.update(
            {
                "start": point3(safe_attr(entity, "StartPoint")),
                "end": point3(safe_attr(entity, "EndPoint")),
                "length": finite_number(safe_attr(entity, "Length")),
            }
        )
    elif "polyline" in type_name:
        dimensions = 2 if type_name == "lwpolyline" else 3
        vertices = flat_points(safe_attr(entity, "Coordinates", []), dimensions)
        result.update(
            {
                "vertices": vertices,
                "closed": bool(safe_attr(entity, "Closed", False)),
                "area": finite_number(safe_attr(entity, "Area")),
                "length": finite_number(safe_attr(entity, "Length")),
            }
        )
        result["bbox"] = result.get("bbox") or bbox_from_points(vertices)
    elif type_name == "circle":
        radius = finite_number(safe_attr(entity, "Radius"))
        result.update(
            {
                "center": point3(safe_attr(entity, "Center")),
                "radius": radius,
                "area": finite_number(safe_attr(entity, "Area")),
                "length": round(2 * math.pi * radius, 6) if radius is not None else None,
            }
        )
    elif type_name == "arc":
        result.update(
            {
                "center": point3(safe_attr(entity, "Center")),
                "radius": finite_number(safe_attr(entity, "Radius")),
                "start_angle": finite_number(safe_attr(entity, "StartAngle")),
                "end_angle": finite_number(safe_attr(entity, "EndAngle")),
                "length": finite_number(safe_attr(entity, "ArcLength")),
            }
        )
    elif type_name == "ellipse":
        result.update(
            {
                "center": point3(safe_attr(entity, "Center")),
                "major_axis": point3(safe_attr(entity, "MajorAxis")),
                "radius_ratio": finite_number(safe_attr(entity, "RadiusRatio")),
                "start_angle": finite_number(safe_attr(entity, "StartAngle")),
                "end_angle": finite_number(safe_attr(entity, "EndAngle")),
                "area": finite_number(safe_attr(entity, "Area")),
            }
        )
    elif type_name == "spline":
        result.update(
            {
                "control_points": flat_points(safe_attr(entity, "ControlPoints", []), 3),
                "fit_points": flat_points(safe_attr(entity, "FitPoints", []), 3),
                "degree": finite_number(safe_attr(entity, "Degree"), 0),
                "closed": bool(safe_attr(entity, "Closed", safe_attr(entity, "IsPeriodic", False))),
            }
        )


def serialize_entity(entity: object, *, include_geometry: bool = True) -> dict[str, object]:
    result = base_common(entity)
    type_name = str(result["type"])
    if type_name == "text":
        serialize_text(entity, result, mtext=False)
    elif type_name == "mtext":
        serialize_text(entity, result, mtext=True)
    elif type_name == "dimension":
        serialize_dimension(entity, result)
    elif type_name == "block_reference":
        serialize_block(entity, result)
    elif type_name == "table":
        serialize_table(entity, result)
    elif type_name == "leader":
        result["vertices"] = flat_points(safe_attr(entity, "Coordinates", []), 3)
    elif type_name == "mleader":
        result["text_content"] = next(
            (
                bounded_text(value)
                for name in ("TextString", "MTextText", "Contents", "Content")
                if (value := safe_attr(entity, name))
            ),
            "",
        )
    elif type_name == "hatch":
        pattern = bounded_text(safe_attr(entity, "PatternName", ""), MAX_NAME_LENGTH)
        result.update(
            {
                "pattern": pattern,
                "area": finite_number(safe_attr(entity, "Area")),
                "loops_count": finite_number(safe_attr(entity, "NumberOfLoops"), 0),
                "is_solid": pattern.upper() == "SOLID",
            }
        )
    elif include_geometry and type_name in GEOMETRY_TYPES:
        serialize_geometry(entity, result)
    return result


def entity_text_fragments(record: dict[str, object]) -> list[str]:
    fragments: list[str] = []
    for key in ("content_clean", "content", "text_override", "text_content", "name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            fragments.append(" ".join(value.split()))
    attributes = record.get("attributes")
    if isinstance(attributes, dict):
        fragments.extend(str(value).strip() for value in attributes.values() if str(value).strip())
    cells = record.get("cells")
    if isinstance(cells, list):
        for row in cells:
            if isinstance(row, list):
                fragments.extend(str(value).strip() for value in row if str(value).strip())
    measurement = record.get("measurement")
    if isinstance(measurement, (int, float)):
        fragments.append(str(measurement))
    return fragments
