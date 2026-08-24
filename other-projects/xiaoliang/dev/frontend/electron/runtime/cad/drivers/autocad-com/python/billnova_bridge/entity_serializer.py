"""
实体 → dict 序列化（规范 3.2 节）
COM 调用均包在 try/except 内，避免单实体失败影响整批。
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from mtext_cleaner import clean_mtext

from helpers.variant import (
    round_point,
    round_point3,
    variant_flat_to_xy_pairs,
    variant_flat_to_xyz_triples,
)


def _safe_float(x, default=0.0) -> float:
    try:
        return float(x)
    except Exception:
        return default


def _get_bbox_dict(ent) -> Optional[Dict[str, Any]]:
    try:
        mn, mx = ent.GetBoundingBox()
        return {"min": round_point(mn), "max": round_point(mx)}
    except Exception:
        return None


def _centroid_from_vertices(vertices: List[List[float]]) -> List[float]:
    if not vertices:
        return [0.0, 0.0]
    sx = sum(v[0] for v in vertices)
    sy = sum(v[1] for v in vertices)
    n = len(vertices)
    return [round(sx / n, 2), round(sy / n, 2)]


def _base_common(ent) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    try:
        out["handle"] = str(ent.Handle)
    except Exception:
        out["handle"] = ""
    try:
        out["layer"] = str(ent.Layer)
    except Exception:
        out["layer"] = ""
    try:
        out["color"] = int(ent.Color)
    except Exception:
        out["color"] = 0
    try:
        out["linetype"] = str(ent.Linetype)
    except Exception:
        out["linetype"] = ""
    try:
        out["visible"] = bool(ent.Visible)
    except Exception:
        out["visible"] = True
    return out


def _serialize_polyline_family(ent, type_key: str) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = type_key
    vertices: List[List[float]] = []
    bulges: List[float] = []
    closed = False
    area = None
    length = None
    try:
        closed = bool(ent.Closed)
    except Exception:
        pass
    try:
        coords = ent.Coordinates
        if type_key == "lwpolyline":
            vertices = variant_flat_to_xy_pairs(coords)
        else:
            triples = variant_flat_to_xyz_triples(coords)
            vertices = [[t[0], t[1]] for t in triples]
    except Exception:
        pass
    try:
        area = round(_safe_float(ent.Area), 2)
    except Exception:
        area = None
    try:
        length = round(_safe_float(ent.Length), 2)
    except Exception:
        length = None
    try:
        nv = int(ent.NumberOfVertices)
    except Exception:
        nv = len(vertices)
    for i in range(max(0, nv)):
        try:
            bulges.append(round(_safe_float(ent.GetBulge(i)), 6))
        except Exception:
            bulges.append(0.0)
    bbox = _get_bbox_dict(ent)
    centroid = _centroid_from_vertices(vertices)
    d.update(
        {
            "vertices": vertices,
            "closed": closed,
            "area": area,
            "length": length,
            "centroid": centroid,
            "bbox": bbox,
            "bulges": bulges,
        }
    )
    return d


def _serialize_text(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "text"
    raw = ""
    try:
        raw = str(ent.TextString)
    except Exception:
        pass
    pos = None
    try:
        pos = round_point(ent.TextAlignmentPoint)
    except Exception:
        try:
            pos = round_point(ent.InsertionPoint)
        except Exception:
            pos = [0.0, 0.0]
    height = round(_safe_float(getattr(ent, "Height", 0)), 2)
    rotation = round(_safe_float(getattr(ent, "Rotation", 0)), 6)
    width = round(_safe_float(getattr(ent, "WidthFactor", 1.0)), 4)
    style = ""
    try:
        style = str(ent.StyleName)
    except Exception:
        pass
    d.update(
        {
            "content": raw,
            "content_clean": raw,
            "position": pos,
            "height": height,
            "rotation": rotation,
            "width": width,
            "style": style,
            "bbox": _get_bbox_dict(ent),
        }
    )
    return d


def _serialize_mtext(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "mtext"
    raw = ""
    try:
        raw = str(ent.TextString)
    except Exception:
        pass
    pos = None
    try:
        pos = round_point(ent.InsertionPoint)
    except Exception:
        pos = [0.0, 0.0]
    height = round(_safe_float(getattr(ent, "Height", 0)), 2)
    rotation = round(_safe_float(getattr(ent, "Rotation", 0)), 6)
    width = round(_safe_float(getattr(ent, "Width", 0)), 2)
    style = ""
    try:
        style = str(ent.StyleName)
    except Exception:
        pass
    d.update(
        {
            "content": raw,
            "content_clean": clean_mtext(raw),
            "position": pos,
            "height": height,
            "rotation": rotation,
            "width": width,
            "style": style,
            "bbox": _get_bbox_dict(ent),
        }
    )
    return d


def _dim_points_for_type(ent, dim_type: str) -> Tuple[Optional[List[float]], Optional[List[float]]]:
    p1 = p2 = None
    try:
        if dim_type in ("aligned", "linear"):
            p1 = round_point(getattr(ent, "ExtLine1Point", None))
            p2 = round_point(getattr(ent, "ExtLine2Point", None))
        elif dim_type == "radial":
            on = str(getattr(ent, "ObjectName", ""))
            if "Diametric" in on:
                p1 = round_point(getattr(ent, "ChordPoint", None))
                p2 = round_point(getattr(ent, "FarChordPoint", None))
            else:
                p1 = round_point(getattr(ent, "Center", None))
                p2 = round_point(getattr(ent, "ChordPoint", None))
        elif dim_type == "angular":
            p1 = round_point(getattr(ent, "ExtLine1Point", None) or getattr(ent, "XLine1Point", None))
            p2 = round_point(getattr(ent, "ExtLine2Point", None) or getattr(ent, "XLine2Point", None))
        elif dim_type == "ordinate":
            p1 = round_point(getattr(ent, "Origin", None) or getattr(ent, "DefiningPoint", None))
            p2 = round_point(getattr(ent, "LeaderEndPoint", None))
        elif dim_type == "arc_length":
            p1 = round_point(getattr(ent, "ExtLine1Point", None))
            p2 = round_point(getattr(ent, "ExtLine2Point", None))
    except Exception:
        pass
    return p1, p2


def _serialize_dimension(ent, dim_type: str) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "dimension"
    d["dim_type"] = dim_type
    measurement = None
    try:
        measurement = round(_safe_float(ent.Measurement), 4)
    except Exception:
        pass
    text_override = ""
    try:
        text_override = str(ent.TextOverride)
    except Exception:
        pass
    text_position = None
    try:
        text_position = round_point(ent.TextPosition)
    except Exception:
        pass
    p1, p2 = _dim_points_for_type(ent, dim_type)
    d.update(
        {
            "measurement": measurement,
            "text_override": text_override,
            "text_position": text_position,
            "point1": p1,
            "point2": p2,
            "bbox": _get_bbox_dict(ent),
        }
    )
    return d


def _serialize_block_reference(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "block_reference"
    name = ""
    try:
        name = str(ent.Name)
    except Exception:
        pass
    ins = None
    try:
        ins = round_point(ent.InsertionPoint)
    except Exception:
        ins = [0.0, 0.0]
    rotation = round(_safe_float(getattr(ent, "Rotation", 0)), 6)
    sx = round(_safe_float(getattr(ent, "XScaleFactor", 1.0)), 4)
    sy = round(_safe_float(getattr(ent, "YScaleFactor", 1.0)), 4)
    sz = round(_safe_float(getattr(ent, "ZScaleFactor", 1.0)), 4)
    attrs: Dict[str, str] = {}
    try:
        ats = ent.GetAttributes()
        for i in range(int(ats.Count)):
            a = ats.Item(i)
            try:
                tag = str(a.TagString)
                val = str(a.TextString)
                attrs[tag] = val
            except Exception:
                continue
    except Exception:
        pass
    d.update(
        {
            "name": name,
            "insert_point": ins,
            "rotation": rotation,
            "scale": [sx, sy, sz],
            "attributes": attrs,
            "bbox": _get_bbox_dict(ent),
        }
    )
    return d


def _serialize_hatch(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "hatch"
    pattern = ""
    try:
        pattern = str(ent.PatternName)
    except Exception:
        pass
    area = None
    try:
        area = round(_safe_float(ent.Area), 2)
    except Exception:
        pass
    loops = None
    try:
        loops = int(ent.NumberOfLoops)
    except Exception:
        pass
    bbox = _get_bbox_dict(ent)
    centroid = [0.0, 0.0]
    if bbox:
        centroid = [
            round((bbox["min"][0] + bbox["max"][0]) / 2, 2),
            round((bbox["min"][1] + bbox["max"][1]) / 2, 2),
        ]
    is_solid = pattern.upper() == "SOLID"
    d.update(
        {
            "pattern": pattern,
            "area": area,
            "loops_count": loops,
            "centroid": centroid,
            "bbox": bbox,
            "is_solid": is_solid,
        }
    )
    return d


def _serialize_line(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "line"
    s = e = [0.0, 0.0]
    try:
        s = round_point(ent.StartPoint)
    except Exception:
        pass
    try:
        e = round_point(ent.EndPoint)
    except Exception:
        pass
    ln = None
    try:
        ln = round(_safe_float(ent.Length), 2)
    except Exception:
        pass
    d.update({"start": s, "end": e, "length": ln})
    return d


def _serialize_circle(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "circle"
    c = [0.0, 0.0]
    try:
        c = round_point(ent.Center)
    except Exception:
        pass
    r = round(_safe_float(getattr(ent, "Radius", 0)), 2)
    area = None
    try:
        area = round(_safe_float(ent.Area), 2)
    except Exception:
        pass
    circ = round(2 * math.pi * r, 2) if r else 0.0
    d.update({"center": c, "radius": r, "area": area, "circumference": circ})
    return d


def _serialize_arc(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "arc"
    c = [0.0, 0.0]
    try:
        c = round_point(ent.Center)
    except Exception:
        pass
    r = round(_safe_float(getattr(ent, "Radius", 0)), 2)
    sa = round(_safe_float(getattr(ent, "StartAngle", 0)), 6)
    ea = round(_safe_float(getattr(ent, "EndAngle", 0)), 6)
    al = None
    try:
        al = round(_safe_float(ent.ArcLength), 2)
    except Exception:
        pass
    d.update(
        {
            "center": c,
            "radius": r,
            "start_angle": sa,
            "end_angle": ea,
            "arc_length": al,
        }
    )
    return d


def _serialize_ellipse(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "ellipse"
    center = [0.0, 0.0]
    try:
        center = round_point(ent.Center)
    except Exception:
        pass
    major_tip = [0.0, 0.0]
    try:
        mv = ent.MajorAxis
        cx, cy = _safe_float(center[0]), _safe_float(center[1])
        major_tip = [round(cx + _safe_float(mv[0]), 2), round(cy + _safe_float(mv[1]), 2)]
    except Exception:
        pass
    minor_ratio = round(_safe_float(getattr(ent, "RadiusRatio", 1.0)), 4)
    sa = round(_safe_float(getattr(ent, "StartAngle", 0)), 6)
    ea = round(_safe_float(getattr(ent, "EndAngle", 0)), 6)
    d.update(
        {
            "center": center,
            "major_axis": major_tip,
            "minor_ratio": minor_ratio,
            "start_angle": sa,
            "end_angle": ea,
        }
    )
    return d


def _serialize_spline(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "spline"
    cpts: List[List[float]] = []
    fpts: List[List[float]] = []
    try:
        cpts = variant_flat_to_xy_pairs(ent.ControlPoints)
    except Exception:
        try:
            cpts = variant_flat_to_xyz_triples(ent.ControlPoints)
            cpts = [[p[0], p[1]] for p in cpts]
        except Exception:
            pass
    try:
        fpts = variant_flat_to_xy_pairs(ent.FitPoints)
    except Exception:
        try:
            fpts = variant_flat_to_xyz_triples(ent.FitPoints)
            fpts = [[p[0], p[1]] for p in fpts]
        except Exception:
            pass
    degree = None
    try:
        degree = int(ent.Degree)
    except Exception:
        pass
    closed = False
    try:
        closed = bool(ent.Closed)
    except Exception:
        try:
            closed = bool(ent.IsPeriodic)
        except Exception:
            pass
    d.update(
        {
            "control_points": cpts,
            "fit_points": fpts,
            "degree": degree,
            "closed": closed,
        }
    )
    return d


def _serialize_table(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "table"
    rows = cols = 0
    try:
        rows = int(ent.Rows)
    except Exception:
        pass
    try:
        cols = int(ent.Columns)
    except Exception:
        pass
    cells: List[List[str]] = []
    for r in range(rows):
        row: List[str] = []
        for c in range(cols):
            txt = ""
            try:
                txt = str(ent.GetText(r, c))
            except Exception:
                try:
                    cell = ent.GetCell(r, c)
                    txt = str(cell.TextString)
                except Exception:
                    txt = ""
            row.append(txt)
        cells.append(row)
    ins = None
    try:
        ins = round_point(ent.InsertionPoint)
    except Exception:
        ins = [0.0, 0.0]
    d.update({"rows": rows, "columns": cols, "cells": cells, "insert_point": ins, "bbox": _get_bbox_dict(ent)})
    return d


def _serialize_leader(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "leader"
    verts: List[List[float]] = []
    try:
        coords = ent.Coordinates
        triples = variant_flat_to_xyz_triples(coords)
        verts = [[t[0], t[1]] for t in triples]
    except Exception:
        pass
    d.update({"vertices": verts})
    return d


def _serialize_mleader(ent) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = "mleader"
    text_content = ""
    for attr in ("TextString", "MTextText", "Contents", "Content"):
        try:
            text_content = str(getattr(ent, attr))
            if text_content:
                break
        except Exception:
            continue
    d.update({"text_content": text_content, "bbox": _get_bbox_dict(ent)})
    return d


def _serialize_generic(ent, type_name: str) -> Dict[str, Any]:
    d = _base_common(ent)
    d["type"] = type_name
    return d


def serialize_entity(ent) -> Dict[str, Any]:
    try:
        oname = str(ent.ObjectName)
    except Exception:
        oname = "Unknown"

    if oname == "AcDbLine":
        return _serialize_line(ent)
    if oname == "AcDbCircle":
        return _serialize_circle(ent)
    if oname == "AcDbArc":
        return _serialize_arc(ent)
    if oname == "AcDbEllipse":
        return _serialize_ellipse(ent)
    if oname == "AcDbSpline":
        return _serialize_spline(ent)
    if oname == "AcDbPolyline":
        return _serialize_polyline_family(ent, "lwpolyline")
    if oname == "AcDb2dPolyline":
        return _serialize_polyline_family(ent, "2d_polyline")
    if oname == "AcDb3dPolyline":
        return _serialize_polyline_family(ent, "3d_polyline")
    if oname == "AcDbText":
        return _serialize_text(ent)
    if oname == "AcDbMText":
        return _serialize_mtext(ent)
    if oname == "AcDbBlockReference":
        return _serialize_block_reference(ent)
    if oname == "AcDbHatch":
        return _serialize_hatch(ent)
    if oname == "AcDbAlignedDimension":
        return _serialize_dimension(ent, "aligned")
    if oname == "AcDbRotatedDimension":
        return _serialize_dimension(ent, "linear")
    if oname == "AcDbRadialDimension":
        return _serialize_dimension(ent, "radial")
    if oname == "AcDbDiametricDimension":
        return _serialize_dimension(ent, "radial")
    if oname in ("AcDbAngularDimension", "AcDb3PointAngularDimension"):
        return _serialize_dimension(ent, "angular")
    if oname == "AcDbOrdinateDimension":
        return _serialize_dimension(ent, "ordinate")
    if oname == "AcDbArcDimension":
        return _serialize_dimension(ent, "arc_length")
    if oname == "AcDbTable":
        return _serialize_table(ent)
    if oname == "AcDbLeader":
        return _serialize_leader(ent)
    if oname == "AcDbMLeader":
        return _serialize_mleader(ent)

    # 其它 Dimension 子类
    if "Dimension" in oname:
        return _serialize_dimension(ent, "aligned")

    return _serialize_generic(ent, oname.replace("AcDb", "").lower() if oname.startswith("AcDb") else oname.lower())


def stats_type_key(serialized: Dict[str, Any]) -> str:
    """composite entity_stats.by_type 使用的归一化类型名"""
    t = str(serialized.get("type", "")).lower()
    if t == "dimension" or "dimension" in t:
        return "dimension"
    if "polyline" in t or t in ("lwpolyline", "2d_polyline", "3d_polyline"):
        return "polyline"
    if t in ("text", "mtext"):
        return "text"
    if t == "block_reference":
        return "block_reference"
    if t == "hatch":
        return "hatch"
    if t == "line":
        return "line"
    if t == "circle":
        return "circle"
    if t == "arc":
        return "arc"
    if t == "ellipse":
        return "ellipse"
    if t == "spline":
        return "spline"
    if t in ("leader", "mleader"):
        return "leader"
    if t == "table":
        return "table"
    return t or "other"


def representative_point(serialized: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """用于距离排序的近似代表点"""
    if "position" in serialized:
        p = serialized["position"]
        return (float(p[0]), float(p[1]))
    if "insert_point" in serialized:
        p = serialized["insert_point"]
        return (float(p[0]), float(p[1]))
    if "center" in serialized:
        p = serialized["center"]
        return (float(p[0]), float(p[1]))
    if "start" in serialized:
        p = serialized["start"]
        return (float(p[0]), float(p[1]))
    bbox = serialized.get("bbox")
    if bbox and "min" in bbox and "max" in bbox:
        mn, mx = bbox["min"], bbox["max"]
        return ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2)
    verts = serialized.get("vertices")
    if verts:
        return (sum(v[0] for v in verts) / len(verts), sum(v[1] for v in verts) / len(verts))
    return None
