"""utility.* — Document.Utility 封装"""

import math
from typing import Any, Dict, List

from helpers.variant import make_point, round_point, round_point3


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def rpc_utility_prompt(acad, params) -> Dict[str, Any]:
    params = params or {}
    doc = _active_doc(acad)
    msg = str(params.get("message", ""))
    doc.Utility.Prompt(msg + "\n")
    return {"ok": True}


def rpc_utility_translate_coords(acad, params) -> Dict[str, Any]:
    params = params or {}
    pt = params.get("point")
    if not pt or len(pt) < 2:
        raise ValueError("point required")
    from_cs = int(params.get("from_cs", 0))
    to_cs = int(params.get("to_cs", 1))
    doc = _active_doc(acad)
    v = make_point(float(pt[0]), float(pt[1]), float(pt[2]) if len(pt) > 2 else 0.0)
    out = doc.Utility.TranslateCoordinates(v, from_cs, to_cs, 0)
    try:
        lst = list(out)
        return {"point": round_point3(lst[:3])}
    except Exception:
        return {"point": round_point(out)}


def rpc_utility_polar_point(acad, params) -> Dict[str, Any]:
    params = params or {}
    pt = params.get("point")
    if not pt or len(pt) < 2:
        raise ValueError("point required")
    angle = float(params.get("angle", 0.0))
    dist = float(params.get("distance", 0.0))
    doc = _active_doc(acad)
    v = make_point(float(pt[0]), float(pt[1]), float(pt[2]) if len(pt) > 2 else 0.0)
    out = doc.Utility.PolarPoint(v, angle, dist)
    try:
        lst = list(out)
        return {"point": round_point3(lst[:3])}
    except Exception:
        return {"point": round_point(out)}


def rpc_utility_angle_from_x(acad, params) -> Dict[str, Any]:
    params = params or {}
    p1 = params.get("point1")
    p2 = params.get("point2")
    if not p1 or not p2:
        raise ValueError("point1 and point2 required")
    doc = _active_doc(acad)
    v1 = make_point(float(p1[0]), float(p1[1]), float(p1[2]) if len(p1) > 2 else 0.0)
    v2 = make_point(float(p2[0]), float(p2[1]), float(p2[2]) if len(p2) > 2 else 0.0)
    ang = float(doc.Utility.AngleFromXAxis(v1, v2))
    return {"angle": round(ang, 6)}


def rpc_utility_distance(acad, params) -> Dict[str, Any]:
    params = params or {}
    p1 = params.get("point1")
    p2 = params.get("point2")
    if not p1 or not p2:
        raise ValueError("point1 and point2 required")
    _ = acad  # 纯数学
    d = math.dist(
        (float(p1[0]), float(p1[1])),
        (float(p2[0]), float(p2[1])),
    )
    return {"distance": round(d, 4)}
