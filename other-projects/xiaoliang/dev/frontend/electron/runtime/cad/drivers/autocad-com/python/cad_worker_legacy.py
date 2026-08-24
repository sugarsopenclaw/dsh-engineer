"""CAD Worker — long-running JSON-RPC process communicating via stdin/stdout.

Node.js spawns this process once and sends JSON messages to stdin.
Responses are written to stdout as JSON lines (one per line).

Protocol:
  Request:  {"id": 1, "method": "cad.session.connect", "params": {}}
  Response: {"id": 1, "result": {...}}
  Progress: {"id": 2, "progress": {"scanned": 100, "total": 5000}}
  Error:    {"id": 1, "error": {"code": -1, "message": "..."}}
"""

from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass
from typing import Any, Callable

try:
    import win32con  # type: ignore
    import win32gui  # type: ignore
except Exception:
    win32con = None  # type: ignore
    win32gui = None  # type: ignore


# ── COM helpers ──────────────────────────────────────────────────────

DIMENSION_TYPES = {
    "AcDbAlignedDimension": "aligned",
    "AcDbRotatedDimension": "rotated",
    "AcDbRadialDimension": "radial",
    "AcDbDiametricDimension": "diametric",
    "AcDbAngularDimension": "angular",
    "AcDbArcDimension": "arc",
}
POLYLINE_TYPES = ("AcDbPolyline", "AcDb2dPolyline", "AcDb3dPolyline")
AC_SELECTION_SET_WINDOW = 0


@dataclass
class CadConnection:
    acad: Any = None
    doc: Any = None
    is_connected: bool = False
    doc_name: str = ""


_conn = CadConnection()


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def _coords_tuple(point) -> tuple:
    try:
        return tuple(round(float(v), 1) for v in point)
    except Exception:
        return ()


def _point_or_none(point) -> tuple | None:
    coords = _coords_tuple(point)
    if len(coords) >= 2:
        if len(coords) >= 3:
            return coords[:3]
        return (coords[0], coords[1], 0.0)
    return None


def _extract_vertices(obj) -> list[tuple]:
    raw = _safe(lambda: obj.Coordinates, ())
    if not raw:
        return []
    try:
        values = [float(v) for v in raw]
    except Exception:
        return []

    if len(values) < 4:
        return []

    points: list[tuple] = []
    step = 3 if len(values) % 3 == 0 else 2
    for i in range(0, len(values) - (step - 1), step):
        x = round(values[i], 1)
        y = round(values[i + 1], 1)
        z = round(values[i + 2], 1) if step == 3 else 0.0
        points.append((x, y, z))
    return points


def _centroid(points: list[tuple]) -> tuple | None:
    if not points:
        return None
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sz = sum(p[2] for p in points)
    n = len(points)
    return (round(sx / n, 1), round(sy / n, 1), round(sz / n, 1))


def _bbox(points: list[tuple]) -> tuple | None:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    return (
        (round(min(xs), 1), round(min(ys), 1), round(min(zs), 1)),
        (round(max(xs), 1), round(max(ys), 1), round(max(zs), 1)),
    )


def _extract_text(obj) -> dict | None:
    text = str(_safe(lambda: obj.TextString, "") or "").strip()
    if not text:
        return None

    pos = _point_or_none(_safe(lambda: obj.InsertionPoint, ()))
    if pos is None:
        pos = _point_or_none(_safe(lambda: obj.TextAlignmentPoint, ()))

    return {
        "text": text,
        "position": pos,
        "layer": _safe(lambda: obj.Layer, ""),
        "rotation": round(_safe(lambda: obj.Rotation, 0.0), 4),
        "height": round(_safe(lambda: obj.Height, 0.0), 2),
        "handle": _safe(lambda: obj.Handle, ""),
    }


def _extract_block(obj) -> dict | None:
    name = _safe(lambda: obj.Name, "")
    if not name:
        return None
    result: dict[str, Any] = {
        "name": name,
        "insert_point": _coords_tuple(_safe(lambda: obj.InsertionPoint, ())),
        "layer": _safe(lambda: obj.Layer, ""),
        "rotation": round(_safe(lambda: obj.Rotation, 0.0), 4),
        "x_scale": round(_safe(lambda: obj.XScaleFactor, 1.0), 4),
        "y_scale": round(_safe(lambda: obj.YScaleFactor, 1.0), 4),
        "handle": _safe(lambda: obj.Handle, ""),
        "attributes": {},
    }
    if _safe(lambda: obj.HasAttributes, False):
        try:
            for attr in obj.GetAttributes():
                tag = _safe(lambda: attr.TagString, "")
                val = _safe(lambda: attr.TextString, "")
                if tag:
                    result["attributes"][tag] = val
        except Exception:
            pass
    return result


def _extract_polyline(obj) -> dict | None:
    vertices = _extract_vertices(obj)
    return {
        "area": round(_safe(lambda: obj.Area, 0.0), 2),
        "length": round(_safe(lambda: obj.Length, 0.0), 2),
        "closed": bool(_safe(lambda: obj.Closed, False)),
        "layer": _safe(lambda: obj.Layer, ""),
        "handle": _safe(lambda: obj.Handle, ""),
        "vertices_count": len(vertices),
        "centroid": _centroid(vertices),
        "bbox": _bbox(vertices),
    }


def _extract_dimension(obj, dim_type: str) -> dict:
    result: dict[str, Any] = {
        "type": dim_type,
        "measurement": round(float(_safe(lambda: obj.Measurement, 0.0)), 2),
        "layer": _safe(lambda: obj.Layer, ""),
        "text_override": _safe(lambda: obj.TextOverride, ""),
        "handle": _safe(lambda: obj.Handle, ""),
    }
    if dim_type in ("aligned", "rotated"):
        result["point1"] = _coords_tuple(_safe(lambda: obj.ExtLine1Point, ()))
        result["point2"] = _coords_tuple(_safe(lambda: obj.ExtLine2Point, ()))
    return result


def _extract_hatch(obj) -> dict:
    center = _point_or_none(_safe(lambda: obj.Origin, ()))
    if center is None:
        center = _point_or_none(_safe(lambda: obj.PatternOrigin, ()))
    return {
        "area": round(_safe(lambda: obj.Area, 0.0), 2),
        "pattern": _safe(lambda: obj.PatternName, ""),
        "layer": _safe(lambda: obj.Layer, ""),
        "num_loops": _safe(lambda: obj.NumberOfLoops, 0),
        "center": center,
        "handle": _safe(lambda: obj.Handle, ""),
    }


def _extract_table(obj) -> list[list[str]]:
    rows = _safe(lambda: obj.Rows, 0)
    cols = _safe(lambda: obj.Columns, 0)
    if not rows or not cols:
        return []
    data: list[list[str]] = []
    for r in range(rows):
        row: list[str] = []
        for c in range(cols):
            try:
                row.append(str(obj.GetText(r, c) or ""))
            except Exception:
                row.append("")
        data.append(row)
    return data


def _extract_line(obj) -> dict:
    return {
        "start": _coords_tuple(_safe(lambda: obj.StartPoint, ())),
        "end": _coords_tuple(_safe(lambda: obj.EndPoint, ())),
        "length": round(_safe(lambda: obj.Length, 0.0), 2),
        "layer": _safe(lambda: obj.Layer, ""),
        "handle": _safe(lambda: obj.Handle, ""),
    }


def _extract_circle(obj) -> dict:
    return {
        "center": _coords_tuple(_safe(lambda: obj.Center, ())),
        "radius": round(_safe(lambda: obj.Radius, 0.0), 2),
        "layer": _safe(lambda: obj.Layer, ""),
        "handle": _safe(lambda: obj.Handle, ""),
    }


def _extract_arc(obj) -> dict:
    return {
        "center": _coords_tuple(_safe(lambda: obj.Center, ())),
        "radius": round(_safe(lambda: obj.Radius, 0.0), 2),
        "start_angle": round(_safe(lambda: obj.StartAngle, 0.0), 4),
        "end_angle": round(_safe(lambda: obj.EndAngle, 0.0), 4),
        "arc_length": round(_safe(lambda: obj.ArcLength, 0.0), 2),
        "layer": _safe(lambda: obj.Layer, ""),
        "handle": _safe(lambda: obj.Handle, ""),
    }


def _window_points(params: dict) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    raw_window = params.get("window") if isinstance(params, dict) else None
    window = raw_window if isinstance(raw_window, dict) else params
    if not isinstance(window, dict):
        raise ValueError("window params missing")

    min_point = window.get("min") if isinstance(window.get("min"), dict) else {}
    max_point = window.get("max") if isinstance(window.get("max"), dict) else {}

    x1 = float(min_point.get("x"))
    y1 = float(min_point.get("y"))
    x2 = float(max_point.get("x"))
    y2 = float(max_point.get("y"))

    left, right = sorted((x1, x2))
    bottom, top = sorted((y1, y2))
    return (left, bottom, 0.0), (right, top, 0.0)


def _variant_point(point: tuple[float, float, float]):
    import pythoncom  # type: ignore
    from win32com.client import VARIANT  # type: ignore

    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, point)


def _window_variants(params: dict):
    pt1, pt2 = _window_points(params)
    return _variant_point(pt1), _variant_point(pt2)


def _center_point(params: dict) -> tuple[float, float, float]:
    center = params.get("center") if isinstance(params, dict) else None
    if not isinstance(center, dict):
        raise ValueError("center params missing")

    x = float(center.get("x"))
    y = float(center.get("y"))
    return (x, y, 0.0)


def _offset_point(params: dict) -> tuple[float, float, float]:
    offset = params.get("offset") if isinstance(params, dict) else None
    if not isinstance(offset, dict):
        raise ValueError("offset params missing")

    x = float(offset.get("x"))
    y = float(offset.get("y"))
    return (x, y, 0.0)


def _view_center(doc) -> tuple[float, float, float]:
    center = _safe(lambda: doc.GetVariable("VIEWCTR"), ())
    point = _point_or_none(center)
    if point is None:
        raise ValueError("Unable to read VIEWCTR")
    return point


def _ensure_connection():
    if not _conn.is_connected:
        raise RuntimeError("Not connected")
    return _conn.acad, _conn.doc


def _rect_to_bounds(rect) -> dict:
    left, top, right, bottom = rect
    return {
        "x": int(left),
        "y": int(top),
        "width": max(0, int(right) - int(left)),
        "height": max(0, int(bottom) - int(top)),
        "left": int(left),
        "top": int(top),
        "right": int(right),
        "bottom": int(bottom),
    }


def _get_window_bounds(hwnd: int) -> dict:
    if win32gui is None:
        return {}
    result = {}
    try:
        result["window_bounds"] = _rect_to_bounds(win32gui.GetWindowRect(hwnd))
    except Exception:
        pass
    try:
        left, top, right, bottom = win32gui.GetClientRect(hwnd)
        screen_left, screen_top = win32gui.ClientToScreen(hwnd, (left, top))
        screen_right, screen_bottom = win32gui.ClientToScreen(hwnd, (right, bottom))
        result["client_bounds"] = _rect_to_bounds((screen_left, screen_top, screen_right, screen_bottom))
    except Exception:
        pass
    return result


def _acad_hwnd() -> int:
    try:
        return int(getattr(_conn.acad, "HWND", 0) or 0)
    except Exception:
        return 0


def _current_doc():
    acad, _ = _ensure_connection()
    _conn.doc = acad.ActiveDocument
    _conn.doc_name = getattr(_conn.doc, "Name", "")
    return _conn.doc


def _space_name(doc) -> str:
    active_layout = _safe(lambda: doc.ActiveLayout.Name, "") or ""
    if active_layout.lower() == "model":
        return "model"
    return "paper" if active_layout else "unknown"


def _document_snapshot(doc) -> dict:
    full_name = _safe(lambda: doc.FullName, "") or ""
    return {
        "name": _safe(lambda: doc.Name, "") or "",
        "full_name": full_name,
        "path": _safe(lambda: doc.Path, "") or "",
        "active_layout_name": _safe(lambda: doc.ActiveLayout.Name, "") or "",
        "space": _space_name(doc),
        "version": str(_safe(lambda: _conn.acad.Version, "") or ""),
        "is_saved": bool(_safe(lambda: doc.Saved, False)),
    }


def _entity_payload(obj) -> dict:
    obj_name = getattr(obj, "ObjectName", "") or "AcDbEntity"
    base = {
        "handle": _safe(lambda: obj.Handle, "") or "",
        "layer": _safe(lambda: obj.Layer, "") or "",
        "object_name": obj_name,
    }

    if obj_name in ("AcDbMText", "AcDbText"):
        extracted = _extract_text(obj) or {}
        return {**base, **extracted}
    if obj_name == "AcDbBlockReference":
        extracted = _extract_block(obj) or {}
        return {**base, **extracted}
    if obj_name in POLYLINE_TYPES:
        extracted = _extract_polyline(obj) or {}
        return {**base, **extracted}
    if obj_name in DIMENSION_TYPES:
        return {**base, **_extract_dimension(obj, DIMENSION_TYPES[obj_name])}
    if obj_name == "AcDbHatch":
        return {**base, **_extract_hatch(obj)}
    if obj_name == "AcDbLine":
        return {**base, **_extract_line(obj)}
    if obj_name == "AcDbCircle":
        return {**base, **_extract_circle(obj)}
    if obj_name == "AcDbArc":
        return {**base, **_extract_arc(obj)}
    if obj_name == "AcDbTable":
        return {**base, "table_data": _extract_table(obj)}
    return base


def _parse_objects(iterable, count: int,
                   progress_fn: Callable | None = None) -> dict:
    texts, text_entities, blocks, polylines, dimensions = [], [], [], [], []
    hatches, tables, lines, circles, arcs = [], [], [], [], []
    layers_seen: set[str] = set()
    INTERVAL = 200

    for i in range(count):
        try:
            obj = iterable.Item(i)
        except Exception:
            continue
        obj_name = getattr(obj, "ObjectName", "")
        layer = _safe(lambda: obj.Layer, "")
        if layer:
            layers_seen.add(layer)

        if obj_name in ("AcDbMText", "AcDbText"):
            t = _extract_text(obj)
            if t:
                texts.append(t["text"])
                text_entities.append(t)
        elif obj_name == "AcDbBlockReference":
            b = _extract_block(obj)
            if b:
                blocks.append(b)
        elif obj_name in POLYLINE_TYPES:
            p = _extract_polyline(obj)
            if p:
                polylines.append(p)
        elif obj_name in DIMENSION_TYPES:
            dimensions.append(_extract_dimension(obj, DIMENSION_TYPES[obj_name]))
        elif obj_name == "AcDbHatch":
            hatches.append(_extract_hatch(obj))
        elif obj_name == "AcDbTable":
            t = _extract_table(obj)
            if t:
                tables.append(t)
        elif obj_name == "AcDbLine":
            lines.append(_extract_line(obj))
        elif obj_name == "AcDbCircle":
            circles.append(_extract_circle(obj))
        elif obj_name == "AcDbArc":
            arcs.append(_extract_arc(obj))

        if progress_fn and (i + 1) % INTERVAL == 0:
            progress_fn(i + 1, count)

    if progress_fn:
        progress_fn(count, count)

    return {
        "texts": texts,
        "text_entities": text_entities,
        "blocks": blocks,
        "polylines": polylines,
        "dimensions": dimensions,
        "hatches": hatches,
        "tables": tables,
        "lines": lines,
        "circles": circles,
        "arcs": arcs,
        "layers": sorted(layers_seen),
        "summary": {
            "entity_schema_version": 2,
            "total": count,
            "texts": len(texts),
            "text_entities": len(text_entities),
            "blocks": len(blocks),
            "polylines": len(polylines),
            "dimensions": len(dimensions),
            "hatches": len(hatches),
            "tables": len(tables),
            "lines": len(lines),
            "circles": len(circles),
            "arcs": len(arcs),
        },
    }


# ── RPC handlers ─────────────────────────────────────────────────────

def _send(msg: dict):
    line = json.dumps(msg, ensure_ascii=False, default=str)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def handle_connect(req_id: int, _params: dict):
    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
        pythoncom.CoInitialize()
    except ImportError:
        _send({"id": req_id, "error": {"code": -1, "message": "pywin32 not installed"}})
        return

    try:
        _conn.acad = win32com.client.GetActiveObject("AutoCAD.Application")
    except Exception:
        _send({"id": req_id, "error": {"code": -1, "message": "AutoCAD not running"}})
        return

    try:
        _conn.doc = _conn.acad.ActiveDocument
        _conn.is_connected = True
        _conn.doc_name = getattr(_conn.doc, "Name", "")
        _send({"id": req_id, "result": {
            "ok": True,
            "doc_name": _conn.doc_name,
            "version": str(getattr(_conn.acad, "Version", "")),
        }})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_status(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "result": {"connected": False}})
        return
    try:
        _conn.doc = _conn.acad.ActiveDocument
        _conn.doc_name = getattr(_conn.doc, "Name", "")
        _send({"id": req_id, "result": {"connected": True, "doc_name": _conn.doc_name}})
    except Exception:
        _conn.is_connected = False
        _send({"id": req_id, "result": {"connected": False}})


def handle_get_active_document(req_id: int, _params: dict):
    try:
        doc = _current_doc()
        result = _document_snapshot(doc)
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_document_list(req_id: int, _params: dict):
    try:
        docs = _conn.acad.Documents
        active = _conn.acad.ActiveDocument
        rows = []
        for i in range(int(docs.Count)):
            doc = docs.Item(i)
            rows.append({
                "name": _safe(lambda d=doc: d.Name, "") or "",
                "path": _safe(lambda d=doc: d.FullName, "") or "",
                "active": bool(active is not None and _safe(lambda d=doc: d.Name, "") == _safe(lambda: active.Name, "")),
            })
        _send({"id": req_id, "result": {"documents": rows}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_document_open(req_id: int, params: dict):
    try:
        path = str((params or {}).get("path") or "").strip()
        if not path:
            raise ValueError("path is required")
        doc = _conn.acad.Documents.Open(path)
        _conn.doc = doc
        _conn.doc_name = getattr(doc, "Name", "")
        _send({"id": req_id, "result": _document_snapshot(doc)})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_document_switch(req_id: int, params: dict):
    try:
        name = str((params or {}).get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        docs = _conn.acad.Documents
        target = None
        for i in range(int(docs.Count)):
            doc = docs.Item(i)
            if str(_safe(lambda d=doc: d.Name, "") or "") == name:
                target = doc
                break
        if target is None:
            raise RuntimeError("document not found")
        target.Activate()
        _conn.doc = target
        _conn.doc_name = getattr(target, "Name", "")
        _send({"id": req_id, "result": _document_snapshot(target)})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_read_entities(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        import pythoncom  # type: ignore
        pythoncom.CoInitialize()
        doc = win32com.client.GetActiveObject("AutoCAD.Application").ActiveDocument
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": f"COM error: {e}"}})
        return

    try:
        ms = doc.ModelSpace
        count = ms.Count

        def on_progress(scanned, total):
            _send({"id": req_id, "progress": {"scanned": scanned, "total": total}})

        result = _parse_objects(ms, count, on_progress)
        result["ok"] = True
        result["doc_name"] = _conn.doc_name
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_read_text(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        import pythoncom  # type: ignore
        pythoncom.CoInitialize()
        doc = win32com.client.GetActiveObject("AutoCAD.Application").ActiveDocument
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": f"COM error: {e}"}})
        return

    try:
        ms = doc.ModelSpace
        count = ms.Count
        texts: list[str] = []
        INTERVAL = 200

        for i in range(count):
            obj = ms.Item(i)
            obj_name = getattr(obj, "ObjectName", "")
            if obj_name in ("AcDbMText", "AcDbText"):
                text = str(getattr(obj, "TextString", "") or "").strip()
                if text:
                    texts.append(text)
            if (i + 1) % INTERVAL == 0:
                _send({"id": req_id, "progress": {"scanned": i + 1, "total": count}})

        _send({"id": req_id, "progress": {"scanned": count, "total": count}})
        _send({"id": req_id, "result": {
            "ok": True,
            "doc_name": _conn.doc_name,
            "texts": texts,
            "text_count": len(texts),
            "total_objects": count,
        }})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_extract_selection(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        import pythoncom  # type: ignore
        pythoncom.CoInitialize()
        doc = win32com.client.GetActiveObject("AutoCAD.Application").ActiveDocument
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": f"COM error: {e}"}})
        return

    try:
        try:
            ss = doc.PickfirstSelectionSet
        except Exception:
            ss = None
        if ss is None or ss.Count == 0:
            _send({"id": req_id, "error": {
                "code": -1,
                "message": "No selection in CAD. Please select objects first.",
            }})
            return
        result = _parse_objects(ss, ss.Count)
        result["ok"] = True
        result["doc_name"] = _conn.doc_name
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_get_entity_by_handle(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    handle = str((params or {}).get("handle") or "").strip()
    if not handle:
        _send({"id": req_id, "error": {"code": -1, "message": "handle is required"}})
        return

    try:
        doc = _current_doc()
        obj = doc.HandleToObject(handle)
        payload = _entity_payload(obj)
        payload["doc_name"] = _conn.doc_name
        _send({"id": req_id, "result": payload})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_zoom_window(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        pt1, pt2 = _window_points(params)
        variant_pt1, variant_pt2 = _window_variants(params)
        _conn.acad.ZoomWindow(variant_pt1, variant_pt2)
        _send({"id": req_id, "result": {"ok": True, "window": {"min": pt1, "max": pt2}}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_zoom_extents(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        _conn.acad.ZoomExtents()
        _send({"id": req_id, "result": {"ok": True}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_zoom_center(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        center = _center_point(params)
        magnify = float((params or {}).get("magnify", 1.0) or 1.0)
        if magnify <= 0:
            magnify = 1.0
        _conn.acad.ZoomCenter(_variant_point(center), magnify)
        _send({"id": req_id, "result": {"ok": True, "center": center, "magnify": magnify}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_pan(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        offset = _offset_point(params)
        current = _view_center(_conn.doc)
        target = (current[0] + offset[0], current[1] + offset[1], 0.0)
        _conn.acad.ZoomCenter(_variant_point(target), 1.0)
        _send({"id": req_id, "result": {"ok": True, "offset": offset, "center": target}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_view_get_current(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        center = _view_center(_conn.doc)
        view_size = _safe(lambda: _conn.doc.GetVariable("VIEWSIZE"), None)
        screen_size = _safe(lambda: _conn.doc.GetVariable("SCREENSIZE"), ())
        screen = []
        try:
            screen = [float(screen_size[0]), float(screen_size[1])]
        except Exception:
            screen = [0.0, 0.0]
        result = {
            "view_center": [float(center[0]), float(center[1]), float(center[2] if len(center) > 2 else 0.0)],
            "view_size": float(view_size) if view_size is not None else None,
            "screen_size": screen,
            "doc_name": _conn.doc_name,
        }
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_view_regen(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        _conn.doc.SendCommand("REGEN\n")
        _send({"id": req_id, "result": {"ok": True}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_view_ensure_visible(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return
    if win32gui is None or win32con is None:
        _send({"id": req_id, "error": {"code": -1, "message": "pywin32 win32gui/win32con unavailable"}})
        return

    try:
        hwnd = _acad_hwnd()
        if hwnd <= 0 or not win32gui.IsWindow(hwnd):
            raise RuntimeError("AutoCAD window handle unavailable")
        warnings = []
        restored = False
        try:
            if win32gui.IsIconic(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                restored = True
            else:
                win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
            win32gui.BringWindowToTop(hwnd)
            win32gui.SetForegroundWindow(hwnd)
        except Exception as exc:
            warnings.append(f"SetForegroundWindow failed: {exc}")
        try:
            win32gui.UpdateWindow(hwnd)
        except Exception as exc:
            warnings.append(f"UpdateWindow failed: {exc}")
        result = {
            "ok": True,
            "hwnd": hwnd,
            "restored": restored,
            "visible": bool(win32gui.IsWindowVisible(hwnd)),
            "iconic": bool(win32gui.IsIconic(hwnd)),
            "doc_name": _conn.doc_name,
            "warnings": warnings,
        }
        result.update(_get_window_bounds(hwnd))
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_send_command(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    command = str((params or {}).get("command") or "").strip()
    if not command:
        _send({"id": req_id, "error": {"code": -1, "message": "command is required"}})
        return

    try:
        suffix = "" if command.endswith("\n") else "\n"
        _conn.doc.SendCommand(command + suffix)
        _send({"id": req_id, "result": {"ok": True, "command": command}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_select_by_handle(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    handle = str((params or {}).get("handle") or "").strip()
    if not handle:
        _send({"id": req_id, "error": {"code": -1, "message": "handle is required"}})
        return

    try:
        obj = _conn.doc.HandleToObject(handle)
        command = f'(if (setq e (handent "{handle}")) (sssetfirst nil (ssadd e))) '
        _conn.doc.SendCommand(command + "\n")
        _send({"id": req_id, "result": {
            "ok": True,
            "handle": handle,
            "doc_name": _conn.doc_name,
            "object_name": _safe(lambda: obj.ObjectName, ""),
            "layer": _safe(lambda: obj.Layer, ""),
        }})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_extract_window(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        import pythoncom  # type: ignore
        pythoncom.CoInitialize()
        doc = win32com.client.GetActiveObject("AutoCAD.Application").ActiveDocument
        pt1, pt2 = _window_points(params)
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": f"COM error: {e}"}})
        return

    selection_name = f"ca_window_{req_id}"
    ss = None
    try:
        variant_pt1, variant_pt2 = _window_variants(params)
        selection_sets = doc.SelectionSets
        try:
            old = selection_sets.Item(selection_name)
            old.Delete()
        except Exception:
            pass

        ss = selection_sets.Add(selection_name)
        ss.Select(AC_SELECTION_SET_WINDOW, variant_pt1, variant_pt2)

        if ss.Count == 0:
            _send({"id": req_id, "error": {
                "code": -1,
                "message": "No entities found in selection window.",
            }})
            return

        result = _parse_objects(ss, ss.Count)
        result["ok"] = True
        result["doc_name"] = _conn.doc_name
        result["window"] = {"min": pt1, "max": pt2}
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})
    finally:
        if ss is not None:
            try:
                ss.Delete()
            except Exception:
                pass


def handle_capture_hint(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        doc = _current_doc()
        doc_name = _safe(lambda: doc.Name, "") or _conn.doc_name
        candidates = []
        if doc_name:
            candidates.append(f"{doc_name} - AutoCAD")
            candidates.append(doc_name)
        candidates.append("AutoCAD")
        result = {
            "doc_name": doc_name,
            "preferred_window_title": candidates[0],
            "window_title_candidates": candidates,
        }
        hwnd = _acad_hwnd()
        if hwnd > 0:
            result.update(_get_window_bounds(hwnd))
        _send({"id": req_id, "result": result})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_list_layers(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        doc = _current_doc()
        layers = []
        collection = doc.Layers
        for i in range(collection.Count):
            layer = collection.Item(i)
            layers.append({
                "name": _safe(lambda: layer.Name, "") or "",
                "color": _safe(lambda: int(layer.color), None),
                "is_on": bool(_safe(lambda: layer.LayerOn, True)),
                "is_frozen": bool(_safe(lambda: layer.Freeze, False)),
                "is_locked": bool(_safe(lambda: layer.Lock, False)),
            })
        _send({"id": req_id, "result": {"layers": layers}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_list_layouts(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        doc = _current_doc()
        layouts = []
        collection = doc.Layouts
        for i in range(collection.Count):
            layout = collection.Item(i)
            layouts.append({
                "name": _safe(lambda: layout.Name, "") or "",
                "model_type": bool(_safe(lambda: layout.ModelType, False)),
                "tab_order": _safe(lambda: int(layout.TabOrder), None),
            })
        _send({"id": req_id, "result": {"layouts": layouts}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_list_blocks(req_id: int, _params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    try:
        doc = _current_doc()
        blocks = []
        collection = doc.Blocks
        for i in range(collection.Count):
            block = collection.Item(i)
            blocks.append({
                "name": _safe(lambda: block.Name, "") or "",
                "is_layout": bool(_safe(lambda: block.IsLayout, False)),
                "is_xref": bool(_safe(lambda: block.IsXRef, False)),
                "item_count": _safe(lambda: int(block.Count), None),
            })
        _send({"id": req_id, "result": {"blocks": blocks}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


def handle_get_variable(req_id: int, params: dict):
    if not _conn.is_connected:
        _send({"id": req_id, "error": {"code": -1, "message": "Not connected"}})
        return

    name = str((params or {}).get("name") or "").strip()
    if not name:
        _send({"id": req_id, "error": {"code": -1, "message": "name is required"}})
        return

    try:
        doc = _current_doc()
        value = doc.GetVariable(name)
        _send({"id": req_id, "result": {"name": name, "value": value}})
    except Exception as e:
        _send({"id": req_id, "error": {"code": -1, "message": str(e)}})


# Need this import at module level for handle_read_entities
try:
    import win32com.client  # type: ignore
except ImportError:
    pass

HANDLERS = {
    "connect": handle_connect,
    "cad.session.connect": handle_connect,
    "status": handle_status,
    "cad.session.status": handle_status,
    "cad.document.getActive": handle_get_active_document,
    "cad.document.list": handle_document_list,
    "cad.document.open": handle_document_open,
    "cad.document.switch": handle_document_switch,
    "read_entities": handle_read_entities,
    "cad.entities.extractSelection": handle_extract_selection,
    "read_text": handle_read_text,
    "cad.entities.readText": handle_read_text,
    "extract_selection": handle_extract_selection,
    "cad.selection.readCurrent": handle_extract_selection,
    "zoom_window": handle_zoom_window,
    "cad.view.zoomWindow": handle_zoom_window,
    "zoom_extents": handle_zoom_extents,
    "cad.view.zoomExtents": handle_zoom_extents,
    "zoom_center": handle_zoom_center,
    "cad.view.zoomCenter": handle_zoom_center,
    "pan": handle_pan,
    "cad.view.pan": handle_pan,
    "cad.view.getCurrent": handle_view_get_current,
    "cad.view.regen": handle_view_regen,
    "cad.view.ensureVisible": handle_view_ensure_visible,
    "send_command": handle_send_command,
    "cad.commands.send": handle_send_command,
    "extract_window": handle_extract_window,
    "cad.entities.extractWindow": handle_extract_window,
    "cad.selection.selectWindow": handle_extract_window,
    "select_by_handle": handle_select_by_handle,
    "cad.selection.selectByHandle": handle_select_by_handle,
    "cad.entities.getByHandle": handle_get_entity_by_handle,
    "cad.capture.hint": handle_capture_hint,
    "cad.collections.listLayers": handle_list_layers,
    "cad.collections.listLayouts": handle_list_layouts,
    "cad.collections.listBlocks": handle_list_blocks,
    "cad.variables.get": handle_get_variable,
}


# ── Main loop ────────────────────────────────────────────────────────

def main():
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore

    _send({"id": 0, "result": {"status": "ready"}})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            _send({"id": 0, "error": {"code": -32700, "message": f"Parse error: {e}"}})
            continue

        req_id = msg.get("id", 0)
        method = msg.get("method", "")

        handler = HANDLERS.get(method)
        if not handler:
            _send({"id": req_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}})
            continue

        try:
            handler(req_id, msg.get("params", {}))
        except Exception as e:
            tb = traceback.format_exc()
            _send({"id": req_id, "error": {"code": -1, "message": f"{e}\n{tb}"}})


if __name__ == "__main__":
    main()
