"""geometry.* RPC"""

import math
from typing import Any, Dict, List, Optional, Tuple

from entity_serializer import serialize_entity
from helpers.geometry_math import (
    distance_point_to_segment,
    point_in_polygon_xy,
    polygon_centroid_2d,
    sample_points_from_serialized,
    segment_intersection,
)
from helpers.variant import round_point


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def _normalize_handle(h: str) -> str:
    s = str(h).strip()
    if s.lower().startswith("0x"):
        s = s[2:]
    return s


def rpc_geometry_distance_pp(_acad, params) -> Dict[str, Any]:
    params = params or {}
    p1 = params.get("p1")
    p2 = params.get("p2")
    if not p1 or not p2:
        raise ValueError("p1 and p2 required")
    d = math.dist((float(p1[0]), float(p1[1])), (float(p2[0]), float(p2[1])))
    return {"distance": round(d, 4)}


def rpc_geometry_area(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    obj = doc.HandleToObject(_normalize_handle(str(handle)))
    a = float(obj.Area)
    return {"area": round(a, 4)}


def rpc_geometry_length(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    obj = doc.HandleToObject(_normalize_handle(str(handle)))
    ln = float(obj.Length)
    return {"length": round(ln, 4)}


def rpc_geometry_bounding_box(acad, params) -> Dict[str, Any]:
    params = params or {}
    handles = params.get("handles") or []
    if not isinstance(handles, list) or not handles:
        raise ValueError("handles required")
    doc = _active_doc(acad)
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for h in handles:
        obj = doc.HandleToObject(_normalize_handle(str(h)))
        mn, mx = obj.GetBoundingBox()
        min_x = min(min_x, float(mn[0]), float(mx[0]))
        min_y = min(min_y, float(mn[1]), float(mx[1]))
        max_x = max(max_x, float(mn[0]), float(mx[0]))
        max_y = max(max_y, float(mn[1]), float(mx[1]))
    if not math.isfinite(min_x):
        return {"min": [0.0, 0.0], "max": [0.0, 0.0]}
    return {"min": [round(min_x, 2), round(min_y, 2)], "max": [round(max_x, 2), round(max_y, 2)]}


def rpc_geometry_distance_pl(_acad, params) -> Dict[str, Any]:
    params = params or {}
    p = params.get("point")
    a = params.get("line_start")
    b = params.get("line_end")
    if not p or not a or not b:
        raise ValueError("point, line_start, line_end required")
    d = distance_point_to_segment(
        float(p[0]), float(p[1]), float(a[0]), float(a[1]), float(b[0]), float(b[1])
    )
    return {"distance": round(d, 4)}


def rpc_geometry_distance_entities(acad, params) -> Dict[str, Any]:
    params = params or {}
    doc = _active_doc(acad)
    h1 = params.get("handle1")
    h2 = params.get("handle2")
    if not h1 or not h2:
        raise ValueError("handle1 and handle2 required")
    e1 = serialize_entity(doc.HandleToObject(_normalize_handle(str(h1))))
    e2 = serialize_entity(doc.HandleToObject(_normalize_handle(str(h2))))
    pts1 = sample_points_from_serialized(e1)
    pts2 = sample_points_from_serialized(e2)
    best = float("inf")
    pair: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None
    for p1 in pts1:
        for p2 in pts2:
            d = math.dist(p1, p2)
            if d < best:
                best = d
                pair = (p1, p2)
    return {
        "distance": round(best, 4) if math.isfinite(best) else None,
        "closest_pair": [list(pair[0]), list(pair[1])] if pair else None,
    }


def rpc_geometry_area_composite(acad, params) -> Dict[str, Any]:
    params = params or {}
    outer = params.get("outer")
    inners = params.get("inners") or []
    if not outer:
        raise ValueError("outer handle required")
    doc = _active_doc(acad)
    o = doc.HandleToObject(_normalize_handle(str(outer)))
    a_outer = float(o.Area)
    a_in = 0.0
    for h in inners:
        inn = doc.HandleToObject(_normalize_handle(str(h)))
        a_in += float(inn.Area)
    return {"area": round(a_outer - a_in, 4)}


def rpc_geometry_centroid(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    ser = serialize_entity(doc.HandleToObject(_normalize_handle(str(handle))))
    verts = ser.get("vertices")
    if verts and len(verts) >= 3:
        cx, cy = polygon_centroid_2d(verts)
        return {"centroid": [round(cx, 2), round(cy, 2)]}
    bbox = ser.get("bbox")
    if bbox and "min" in bbox and "max" in bbox:
        mn, mx = bbox["min"], bbox["max"]
        return {
            "centroid": [
                round((float(mn[0]) + float(mx[0])) / 2, 2),
                round((float(mn[1]) + float(mx[1])) / 2, 2),
            ]
        }
    rp = ser.get("center") or ser.get("position")
    if rp:
        return {"centroid": [round(float(rp[0]), 2), round(float(rp[1]), 2)]}
    return {"centroid": [0.0, 0.0]}


def rpc_geometry_point_inside(acad, params) -> Dict[str, Any]:
    params = params or {}
    pt = params.get("point")
    handle = params.get("handle")
    if not pt or not handle:
        raise ValueError("point and handle required")
    doc = _active_doc(acad)
    ser = serialize_entity(doc.HandleToObject(_normalize_handle(str(handle))))
    verts = ser.get("vertices")
    if not verts or len(verts) < 3:
        return {"inside": False}
    inside = point_in_polygon_xy(float(pt[0]), float(pt[1]), verts)
    return {"inside": bool(inside)}


def rpc_geometry_intersection(acad, params) -> Dict[str, Any]:
    params = params or {}
    doc = _active_doc(acad)
    h1 = params.get("handle1")
    h2 = params.get("handle2")
    if not h1 or not h2:
        raise ValueError("handle1 and handle2 required")
    e1 = serialize_entity(doc.HandleToObject(_normalize_handle(str(h1))))
    e2 = serialize_entity(doc.HandleToObject(_normalize_handle(str(h2))))
    pts: List[List[float]] = []
    segs1: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    segs2: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    if e1.get("type") == "line" and "start" in e1 and "end" in e1:
        s, e = e1["start"], e1["end"]
        segs1.append(((float(s[0]), float(s[1])), (float(e[0]), float(e[1]))))
    elif e1.get("vertices"):
        for i in range(len(e1["vertices"]) - 1):
            a = e1["vertices"][i]
            b = e1["vertices"][i + 1]
            segs1.append(((float(a[0]), float(a[1])), (float(b[0]), float(b[1]))))
    if e2.get("type") == "line" and "start" in e2 and "end" in e2:
        s, e = e2["start"], e2["end"]
        segs2.append(((float(s[0]), float(s[1])), (float(e[0]), float(e[1]))))
    elif e2.get("vertices"):
        for i in range(len(e2["vertices"]) - 1):
            a = e2["vertices"][i]
            b = e2["vertices"][i + 1]
            segs2.append(((float(a[0]), float(a[1])), (float(b[0]), float(b[1]))))
    for s1 in segs1:
        for s2 in segs2:
            inter = segment_intersection(
                s1[0][0], s1[0][1], s1[1][0], s1[1][1], s2[0][0], s2[0][1], s2[1][0], s2[1][1]
            )
            if inter is not None:
                pts.append([round(inter[0], 2), round(inter[1], 2)])
    return {"points": pts, "count": len(pts)}


def rpc_geometry_offset_curve(acad, params) -> Dict[str, Any]:
    params = params or {}
    doc = _active_doc(acad)
    ent = doc.HandleToObject(_normalize_handle(str(params.get("handle", ""))))
    dist = float(params.get("distance", 0.0))
    res = ent.Offset(dist)
    out: List[Dict[str, Any]] = []
    try:
        n = int(res.Count)
    except Exception:
        try:
            n = len(res)
        except Exception:
            n = 0
    for i in range(n):
        try:
            e = res.Item(i) if hasattr(res, "Item") else res[i]
            out.append(serialize_entity(e))
        except Exception:
            continue
    return {"entities": out, "count": len(out)}
