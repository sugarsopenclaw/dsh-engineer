"""entity.* 扩展：创建/修改/几何运算/XData/阵列等"""

from __future__ import annotations

import math
import pythoncom
from typing import Any, Dict, List

from entity_serializer import serialize_entity
from helpers.entity_cache import EntityCache
from helpers.filter_advanced import evaluate_filter_spec, filter_spec_from_param
from helpers.filter_helper import filter_serialized_entities
from helpers.modelspace import iter_modelspace
from helpers.selection_set import get_selection_set
from helpers.variant import make_point, make_polygon_points_flat, round_point, round_point3
from win32com.client import VARIANT


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def _norm_handle(h: str) -> str:
    s = str(h).strip()
    if s.lower().startswith("0x"):
        s = s[2:]
    return s


def _obj(acad, handle: str):
    return _active_doc(acad).HandleToObject(_norm_handle(handle))


# AutoCAD 选择常量（常用数值）
_AC_SELECTION_CROSSING_POLYGON = 3
_AC_SELECTION_WINDOW_POLYGON = 2
_AC_EXTEND_NONE = 0


def rpc_entity_read_by_polygon(acad, params) -> Dict[str, Any]:
    params = params or {}
    pts = params.get("points") or []
    if len(pts) < 3:
        raise ValueError("points requires at least 3 vertices")
    mode = int(params.get("mode", _AC_SELECTION_CROSSING_POLYGON))
    layers = params.get("layers")
    types = params.get("types")
    doc = _active_doc(acad)
    ss = get_selection_set(doc, "BN_TEMP2")
    entities: List[Dict[str, Any]] = []
    try:
        flat = make_polygon_points_flat(pts)
        try:
            ss.SelectByPolygon(mode, flat, None, None)
        except Exception:
            ss.SelectByPolygon(mode, flat)
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
    filtered = filter_serialized_entities(entities, layers=layers, types=types)
    EntityCache.set_from_read_all(doc, filtered)
    return {"entities": filtered, "count": len(filtered)}


def rpc_entity_read_by_filter(acad, params) -> Dict[str, Any]:
    params = params or {}
    filt = filter_spec_from_param(params.get("filter"))
    doc = _active_doc(acad)
    out: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            ser = serialize_entity(ent)
        except Exception:
            continue
        if not evaluate_filter_spec(ser, filt):
            continue
        out.append(ser)
    EntityCache.set_from_read_all(doc, out)
    return {"entities": out, "count": len(out)}


def rpc_entity_create(acad, params) -> Dict[str, Any]:
    params = params or {}
    t = str(params.get("type", "")).lower()
    doc = _active_doc(acad)
    ms = doc.ModelSpace
    ent = None
    if t == "line":
        s, e = params.get("start"), params.get("end")
        if not s or not e:
            raise ValueError("start and end required")
        ent = ms.AddLine(make_point(float(s[0]), float(s[1])), make_point(float(e[0]), float(e[1])))
    elif t == "circle":
        c = params.get("center")
        r = float(params.get("radius", 0))
        if not c:
            raise ValueError("center required")
        ent = ms.AddCircle(make_point(float(c[0]), float(c[1])), r)
    elif t == "arc":
        c = params.get("center")
        r = float(params.get("radius", 0))
        sa = float(params.get("start_angle", 0))
        ea = float(params.get("end_angle", 0))
        if not c:
            raise ValueError("center required")
        ent = ms.AddArc(make_point(float(c[0]), float(c[1])), r, sa, ea)
    elif t in ("polyline", "lwpolyline"):
        verts = params.get("vertices") or []
        if len(verts) < 2:
            raise ValueError("vertices required")
        flat = []
        for v in verts:
            flat.extend([float(v[0]), float(v[1])])
        arr = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, tuple(flat))
        ent = ms.AddLightWeightPolyline(arr)
        if bool(params.get("closed")):
            ent.Closed = True
    elif t == "mtext":
        ins = params.get("position") or [0, 0]
        h = float(params.get("height", 2.5))
        w = float(params.get("width", 10.0))
        content = str(params.get("content", ""))
        ent = ms.AddMText(make_point(float(ins[0]), float(ins[1])), w, content)
        try:
            ent.Height = h
        except Exception:
            pass
    elif t == "hatch":
        pat = str(params.get("pattern", "SOLID"))
        loop = params.get("loop_points") or []
        if len(loop) < 3:
            raise ValueError("loop_points required for hatch")
        flat = []
        for v in loop:
            flat.extend([float(v[0]), float(v[1])])
        arr = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, tuple(flat))
        try:
            ent = ms.AddHatch(0, pat, True)
            ent.AppendLoop(0, arr)
            try:
                ent.Evaluate()
            except Exception:
                pass
        except Exception as e:
            raise RuntimeError(f"hatch AddHatch failed: {e}") from e
    else:
        raise ValueError(f"unsupported type: {t}")
    EntityCache.invalidate()
    return {"entity": serialize_entity(ent)}


def rpc_entity_modify(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    ent = _obj(acad, str(handle))
    if "layer" in params:
        ent.Layer = str(params["layer"])
    if "color" in params:
        ent.Color = int(params["color"])
    if "linetype" in params:
        ent.Linetype = str(params["linetype"])
    if "rotation" in params:
        ent.Rotation = float(params["rotation"])
    on = str(ent.ObjectName)
    if "position" in params and on in ("AcDbMText", "AcDbText", "AcDbBlockReference"):
        p = params["position"]
        ent.InsertionPoint = make_point(float(p[0]), float(p[1]))
    if "vertices" in params and on == "AcDbPolyline":
        verts = params["vertices"] or []
        flat = []
        for v in verts:
            flat.extend([float(v[0]), float(v[1])])
        ent.Coordinates = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, tuple(flat))
    EntityCache.invalidate()
    return {"entity": serialize_entity(ent)}


def rpc_entity_delete(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    ent.Delete()
    EntityCache.invalidate()
    return {"ok": True}


def rpc_entity_copy(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    try:
        c = ent.Copy()
    except Exception:
        c = ent.Copy
        c = c()
    if c is None:
        return {"entity": None, "handle": None}
    try:
        ne = c[0] if hasattr(c, "__getitem__") else c
    except Exception:
        ne = c
    EntityCache.invalidate()
    ser = serialize_entity(ne)
    return {"entity": ser, "handle": ser.get("handle")}


def rpc_entity_move(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    f = params.get("from_point") or [0, 0]
    t = params.get("to_point") or [0, 0]
    ent.Move(make_point(float(f[0]), float(f[1])), make_point(float(t[0]), float(t[1])))
    EntityCache.invalidate()
    return {"entity": serialize_entity(ent)}


def rpc_entity_intersect_with(acad, params) -> Dict[str, Any]:
    params = params or {}
    e1 = _obj(acad, str(params.get("handle1", "")))
    e2 = _obj(acad, str(params.get("handle2", "")))
    mode = int(params.get("mode", _AC_EXTEND_NONE))
    pts = e1.IntersectWith(e2, mode)
    out: List[List[float]] = []
    try:
        lst = list(pts)
        for i in range(0, len(lst) - 2, 3):
            out.append(round_point3(lst[i : i + 3]))
    except Exception:
        pass
    return {"points": out, "count": len(out)}


def rpc_entity_set_xdata(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    types = params.get("types") or []
    values = params.get("values") or []
    tvar = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_I2, tuple(int(x) for x in types))
    vvar = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_VARIANT, tuple(values))
    ent.SetXData(tvar, vvar)
    return {"ok": True}


def rpc_entity_get_xdata(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    app = str(params.get("app_name", ""))
    r = ent.GetXData(app)
    t = v = None
    try:
        if isinstance(r, (list, tuple)) and len(r) >= 2:
            t, v = r[0], r[1]
        else:
            t, v = r, []
    except Exception:
        t, v = None, []
    return {
        "types": list(t) if t is not None else [],
        "values": list(v) if v is not None else [],
    }


def rpc_entity_offset(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    dist = float(params.get("distance", 0.0))
    res = ent.Offset(dist)
    ents: List[Dict[str, Any]] = []
    try:
        n = len(res) if hasattr(res, "__len__") else int(res.Count)
    except Exception:
        n = 0
    for i in range(n):
        try:
            e = res[i] if hasattr(res, "__getitem__") else res.Item(i)
            ents.append(serialize_entity(e))
        except Exception:
            break
    EntityCache.invalidate()
    return {"entities": ents, "count": len(ents)}


def rpc_entity_mirror(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    p1 = params.get("point1") or [0, 0]
    p2 = params.get("point2") or [1, 0]
    res = ent.Mirror(make_point(float(p1[0]), float(p1[1])), make_point(float(p2[0]), float(p2[1])))
    EntityCache.invalidate()
    return {"entity": serialize_entity(res)}


def rpc_entity_rotate(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    c = params.get("center") or [0, 0]
    ang = float(params.get("angle", 0.0))
    ent.Rotate(make_point(float(c[0]), float(c[1])), ang)
    EntityCache.invalidate()
    return {"entity": serialize_entity(ent)}


def rpc_entity_scale(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    c = params.get("center") or [0, 0]
    f = float(params.get("factor", 1.0))
    try:
        ent.ScaleEntity(make_point(float(c[0]), float(c[1])), f)
    except Exception:
        ent.ScaleEntity(make_point(float(c[0]), float(c[1]), 0.0), f)
    EntityCache.invalidate()
    return {"entity": serialize_entity(ent)}


def rpc_entity_explode(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    res = ent.Explode()
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
    EntityCache.invalidate()
    return {"entities": out, "count": len(out)}


def rpc_entity_array_rect(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    rows = int(params.get("rows", 1))
    cols = int(params.get("cols", 1))
    levels = int(params.get("levels", 1))
    dx = float(params.get("dx", 0.0))
    dy = float(params.get("dy", 0.0))
    dz = float(params.get("dz", 0.0))
    ent.ArrayRectangular(rows, cols, levels, dx, dy, dz)
    EntityCache.invalidate()
    return {"ok": True}


def rpc_entity_array_polar(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    count = int(params.get("count", 2))
    angle = float(params.get("angle", math.pi / 2))
    c = params.get("center") or [0, 0]
    ent.ArrayPolar(count, angle, make_point(float(c[0]), float(c[1])))
    EntityCache.invalidate()
    return {"ok": True}


def rpc_entity_highlight(acad, params) -> Dict[str, Any]:
    params = params or {}
    h = _norm_handle(str(params.get("handle", "")))
    doc = _active_doc(acad)
    doc.HandleToObject(h)
    doc.SendCommand(f'(if (setq e (handent "{h}")) (sssetfirst nil (ssadd e))) ')
    return {"ok": True, "handle": h}


def rpc_entity_color_detail(acad, params) -> Dict[str, Any]:
    params = params or {}
    ent = _obj(acad, str(params.get("handle", "")))
    idx = int(ent.Color)
    r = g = b = None
    method = "aci"
    try:
        tc = ent.TrueColor
        method = "truecolor"
        r = int(tc.Red)
        g = int(tc.Green)
        b = int(tc.Blue)
    except Exception:
        pass
    return {
        "color_index": idx,
        "red": r,
        "green": g,
        "blue": b,
        "color_method": method,
    }
