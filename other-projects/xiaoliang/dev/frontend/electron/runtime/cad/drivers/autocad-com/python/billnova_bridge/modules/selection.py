"""selection.* RPC — nearby / nearest 使用 EntityCache（规范）"""

import math
import pythoncom
from typing import Any, Dict, List, Optional, Tuple

from entity_serializer import representative_point, serialize_entity
from helpers.entity_cache import EntityCache
from helpers.filter_helper import filter_serialized_entities
from helpers.geometry_math import point_in_polygon_xy
from helpers.modelspace import iter_modelspace
from helpers.selection_set import get_selection_set
from helpers.variant import make_point
from modules import entity as entity_mod
from win32com.client import VARIANT


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def _load_all_serialized(doc):
    out: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            out.append(serialize_entity(ent))
        except Exception:
            continue
    return out


def _dist_pt_to_entity(pt: Tuple[float, float], ser: Dict[str, Any]) -> float:
    rp = representative_point(ser)
    if rp is None:
        return float("inf")
    return float(math.dist(pt, rp))


def rpc_selection_nearby(acad, params) -> Dict[str, Any]:
    params = params or {}
    point = params.get("point")
    if not point:
        raise ValueError("point required")
    radius = float(params.get("radius", 0.0))
    layers = params.get("layers")
    types = params.get("types")
    doc = _active_doc(acad)
    pt = (float(point[0]), float(point[1]))

    def loader(d):
        return _load_all_serialized(d)

    all_e = EntityCache.get_all(doc, loader)
    cand = filter_serialized_entities(all_e, layers=layers, types=types)
    out = []
    for ser in cand:
        if _dist_pt_to_entity(pt, ser) <= radius:
            out.append(ser)
    return {"entities": out, "count": len(out)}


def rpc_selection_nearest(acad, params) -> Dict[str, Any]:
    params = params or {}
    point = params.get("point")
    if not point:
        raise ValueError("point required")
    types = params.get("types")
    count = int(params.get("count") or 1)
    doc = _active_doc(acad)
    pt = (float(point[0]), float(point[1]))

    def loader(d):
        return _load_all_serialized(d)

    all_e = EntityCache.get_all(doc, loader)
    cand = filter_serialized_entities(all_e, layers=None, types=types)
    scored = []
    for ser in cand:
        d = _dist_pt_to_entity(pt, ser)
        if math.isfinite(d):
            scored.append((d, ser))
    scored.sort(key=lambda x: x[0])
    top = [s[1] for s in scored[: max(0, count)]]
    return {"entities": top, "count": len(top)}


def rpc_selection_touching(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    eps = float(params.get("epsilon", 0.01))
    doc = _active_doc(acad)
    obj = doc.HandleToObject(str(handle).strip())
    mn, mx = obj.GetBoundingBox()
    mnx, mxx = float(mn[0]) - eps, float(mx[0]) + eps
    mny, mxy = float(mn[1]) - eps, float(mx[1]) + eps
    win = entity_mod.rpc_entity_read_by_crossing(
        acad,
        {"min": [mnx, mny], "max": [mxx, mxy]},
    )
    out: List[Dict[str, Any]] = []
    for ser in win["entities"]:
        if str(ser.get("handle")) == str(handle):
            continue
        try:
            o2 = doc.HandleToObject(str(ser.get("handle")))
            pts = obj.IntersectWith(o2, 0)
            if pts is not None and len(list(pts)) > 0:
                out.append(ser)
        except Exception:
            continue
    return {"entities": out, "count": len(out)}


def rpc_selection_inside(acad, params) -> Dict[str, Any]:
    params = params or {}
    bh = params.get("boundary_handle")
    if not bh:
        raise ValueError("boundary_handle required")
    types = params.get("types")
    doc = _active_doc(acad)
    bser = serialize_entity(doc.HandleToObject(str(bh).strip()))
    verts = bser.get("vertices") or []
    if len(verts) < 3:
        raise ValueError("boundary must have vertices (e.g. closed polyline)")
    xs = [float(v[0]) for v in verts]
    ys = [float(v[1]) for v in verts]
    mn = [min(xs), min(ys)]
    mx = [max(xs), max(ys)]
    win = entity_mod.rpc_entity_read_by_window(acad, {"min": mn, "max": mx, "types": types})
    out: List[Dict[str, Any]] = []
    for ser in win["entities"]:
        if str(ser.get("handle")) == str(bh):
            continue
        rp = representative_point(ser)
        if rp is None:
            continue
        if point_in_polygon_xy(rp[0], rp[1], verts):
            out.append(ser)
    return {"entities": out, "count": len(out)}


def rpc_selection_between(acad, params) -> Dict[str, Any]:
    params = params or {}
    h1 = params.get("handle1")
    h2 = params.get("handle2")
    if not h1 or not h2:
        raise ValueError("handle1 and handle2 required")
    doc = _active_doc(acad)
    o1 = doc.HandleToObject(str(h1).strip())
    o2 = doc.HandleToObject(str(h2).strip())
    mn1, mx1 = o1.GetBoundingBox()
    mn2, mx2 = o2.GetBoundingBox()
    mnx = min(float(mn1[0]), float(mn2[0]))
    mny = min(float(mn1[1]), float(mn2[1]))
    mxx = max(float(mx1[0]), float(mx2[0]))
    mxy = max(float(mx1[1]), float(mx2[1]))
    return entity_mod.rpc_entity_read_by_crossing(acad, {"min": [mnx, mny], "max": [mxx, mxy]})


def rpc_selection_along(acad, params) -> Dict[str, Any]:
    params = params or {}
    h = params.get("handle")
    buf = float(params.get("buffer", 1.0))
    if not h:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    obj = doc.HandleToObject(str(h).strip())
    mn, mx = obj.GetBoundingBox()
    mnx = float(mn[0]) - buf
    mny = float(mn[1]) - buf
    mxx = float(mx[0]) + buf
    mxy = float(mx[1]) + buf
    return entity_mod.rpc_entity_read_by_crossing(acad, {"min": [mnx, mny], "max": [mxx, mxy]})


def rpc_selection_by_dxf_filter(acad, params) -> Dict[str, Any]:
    params = params or {}
    ftypes = params.get("filter_types") or []
    fdata = params.get("filter_data") or []
    mode = int(params.get("mode", 1))
    doc = _active_doc(acad)
    win = params.get("window")
    ss = get_selection_set(doc, "BN_FLT")
    entities: List[Dict[str, Any]] = []
    try:
        if win and win.get("min") and win.get("max"):
            mn, mx = win["min"], win["max"]
            p1 = make_point(float(mn[0]), float(mn[1]))
            p2 = make_point(float(mx[0]), float(mx[1]))
        else:
            emin = doc.GetVariable("EXTMIN")
            emax = doc.GetVariable("EXTMAX")
            p1 = make_point(float(emin[0]), float(emin[1]))
            p2 = make_point(float(emax[0]), float(emax[1]))
        ft = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_I2, tuple(int(x) for x in ftypes))
        fd_inner = []
        for v in fdata:
            fd_inner.append(VARIANT(pythoncom.VT_BSTR, str(v)))
        fd = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_VARIANT, tuple(fd_inner))
        ss.Select(mode, p1, p2, ft, fd)
        n = int(ss.Count)
        for i in range(n):
            try:
                ent = ss.Item(i)
                entities.append(serialize_entity(ent))
            except Exception:
                continue
    finally:
        try:
            ss.Delete()
        except Exception:
            pass
    return {"entities": entities, "count": len(entities)}
