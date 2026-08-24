"""BillNova-backed CAD worker adapter.

This module keeps the existing `cad.*` protocol used by TypeScript runtime,
while delegating the actual COM work to the imported BillNova cad-bridge code.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any, Callable, Dict, List

try:
    import win32con  # type: ignore
    import win32gui  # type: ignore
except Exception:  # pragma: no cover - pywin32 is only available on Windows CAD hosts
    win32con = None  # type: ignore
    win32gui = None  # type: ignore


THIS_DIR = Path(__file__).resolve().parent
BILLNOVA_BRIDGE_DIR = THIS_DIR / "billnova_bridge"
if str(BILLNOVA_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BILLNOVA_BRIDGE_DIR))

billnova_bridge: Any | None = None
_BRIDGE_IMPORT_ERROR: Exception | None = None
_BRIDGE_RUNTIME_ERROR: str | None = None
try:
    import cad_bridge as billnova_bridge  # type: ignore
except Exception as exc:  # pragma: no cover - import guard
    _BRIDGE_IMPORT_ERROR = exc

try:
    from cad_connection import get_application as _get_bridge_application  # type: ignore
    from entity_serializer import serialize_entity as _serialize_entity  # type: ignore
    from helpers.entity_cache import EntityCache as _EntityCache  # type: ignore
    from helpers.filter_advanced import (  # type: ignore
        evaluate_filter_spec as _evaluate_filter_spec,
        filter_spec_from_param as _filter_spec_from_param,
    )
except Exception:  # pragma: no cover - optional fast path imports
    _get_bridge_application = None
    _serialize_entity = None
    _EntityCache = None
    _evaluate_filter_spec = None
    _filter_spec_from_param = None


_CURRENT_REQUEST_ID: int | None = None
READABLE_INDEX_PROFILE = "readable-index-v1"
READABLE_INDEX_OBJECT_NAMES = {
    "AcDbText",
    "AcDbMText",
    "AcDbBlockReference",
    "AcDbTable",
    "AcDbLeader",
    "AcDbMLeader",
}


def _is_readable_index_object_name(object_name: str) -> bool:
    if object_name in READABLE_INDEX_OBJECT_NAMES:
        return True
    return "Dimension" in object_name


def _object_name_to_type_key(object_name: Any) -> str:
    name = str(object_name or "").strip()
    if not name:
        return "unknown"
    if "Dimension" in name:
        return "dimension"
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
        "AcDbFace": "face",
        "AcDb3dFace": "face",
        "AcDbSolid": "solid",
        "AcDbPoint": "point",
    }
    if name in mapping:
        return mapping[name]
    return name.replace("AcDb", "").lower() if name.startswith("AcDb") else name.lower()


def _add_count(counter: Dict[str, int], key: Any) -> None:
    normalized = str(key or "").strip() or "(empty)"
    counter[normalized] = counter.get(normalized, 0) + 1


def _bridge_error_message() -> str:
    if _BRIDGE_RUNTIME_ERROR:
        return _BRIDGE_RUNTIME_ERROR
    if _BRIDGE_IMPORT_ERROR is None:
        return "BillNova bridge unavailable."

    if isinstance(_BRIDGE_IMPORT_ERROR, ModuleNotFoundError):
        missing_name = str(getattr(_BRIDGE_IMPORT_ERROR, "name", "") or "").strip()
        if missing_name in {"pythoncom", "win32com", "pywintypes", "win32api"}:
            return (
                "BillNova bridge missing pywin32 dependency "
                f"({missing_name}). Please install pywin32 in the Python interpreter "
                "used by Electron CAD worker."
            )
        if missing_name in {"PIL", "Pillow"}:
            return (
                "BillNova bridge missing Pillow dependency. "
                "Please install Pillow in the Python interpreter used by Electron CAD worker."
            )
        return f"BillNova bridge import failed: missing module {missing_name}."

    return f"BillNova bridge import failed: {_BRIDGE_IMPORT_ERROR}"


def _send(msg: Dict[str, Any]) -> None:
    line = json.dumps(msg, ensure_ascii=False, default=str)
    line = line.encode("utf-8", "replace").decode("utf-8")
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _safe_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except Exception:
        return default


def _send_progress(
    scanned: int,
    total: int,
    *,
    matched: int | None = None,
    failed: int | None = None,
    phase: str | None = None,
    message: str | None = None,
) -> None:
    if _CURRENT_REQUEST_ID is None:
        return
    safe_scanned = max(0, int(scanned))
    safe_total = max(0, int(total))
    if safe_total <= 0:
        safe_total = max(1, safe_scanned)
    progress: Dict[str, Any] = {
        "scanned": min(safe_scanned, safe_total),
        "total": safe_total,
    }
    if matched is not None:
        progress["matched"] = max(0, int(matched))
    if failed is not None:
        progress["failed"] = max(0, int(failed))
    if phase:
        progress["phase"] = phase
    if message:
        progress["message"] = message
    _send(
        {
            "id": _CURRENT_REQUEST_ID,
            "progress": progress,
        }
    )


def _normalize_handle(raw: Any) -> str:
    handle = str(raw or "").strip()
    if handle.lower().startswith("0x"):
        return handle[2:]
    return handle


def _point_to_xy(point: Dict[str, Any]) -> List[float]:
    return [float(point["x"]), float(point["y"])]


def _window_to_min_max(params: Dict[str, Any]) -> Dict[str, List[float]]:
    window = params.get("window")
    if not isinstance(window, dict):
        raise ValueError("window params missing")
    pmin = window.get("min")
    pmax = window.get("max")
    if not isinstance(pmin, dict) or not isinstance(pmax, dict):
        raise ValueError("window.min/window.max required")
    return {"min": _point_to_xy(pmin), "max": _point_to_xy(pmax)}


def _serialized_type_to_object_name(type_name: Any) -> str:
    key = str(type_name or "").strip().lower()
    mapping = {
        "line": "AcDbLine",
        "circle": "AcDbCircle",
        "arc": "AcDbArc",
        "ellipse": "AcDbEllipse",
        "spline": "AcDbSpline",
        "polyline": "AcDbPolyline",
        "lwpolyline": "AcDbPolyline",
        "2d_polyline": "AcDb2dPolyline",
        "3d_polyline": "AcDb3dPolyline",
        "text": "AcDbText",
        "mtext": "AcDbMText",
        "dimension": "AcDbDimension",
        "block_reference": "AcDbBlockReference",
        "hatch": "AcDbHatch",
        "table": "AcDbTable",
        "leader": "AcDbLeader",
        "mleader": "AcDbMLeader",
    }
    return mapping.get(key, "AcDbEntity")


def _call_bridge(method: str, params: Dict[str, Any] | None = None) -> Any:
    if billnova_bridge is None:
        raise RuntimeError(_bridge_error_message())
    handler = billnova_bridge.HANDLERS.get(method)
    if handler is None:
        raise RuntimeError(f"billnova bridge method not found: {method}")
    payload = params or {}
    if method in ("server.ping", "server.capabilities"):
        return handler(None, payload)
    acad = billnova_bridge.get_application()
    return handler(acad, payload)


def _get_acad_application() -> Any:
    if _get_bridge_application is not None:
        return _get_bridge_application()
    if billnova_bridge is None:
        raise RuntimeError(_bridge_error_message())
    return billnova_bridge.get_application()


def _try_active_doc_name() -> str | None:
    try:
        active = _call_bridge("doc.active", {})
        name = str(active.get("name", "")).strip()
        return name or None
    except Exception:
        return None


def _try_server_info() -> Dict[str, Any]:
    try:
        info = _call_bridge("server.info", {})
        return info if isinstance(info, dict) else {}
    except Exception:
        return {}


def _try_active_doc() -> tuple[Dict[str, Any], str | None]:
    try:
        active = _call_bridge("doc.active", {})
        return (active if isinstance(active, dict) else {}, None)
    except Exception as exc:
        return {}, str(exc)


def _collection_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_type: Dict[str, int] = {}
    for item in items:
        t = str(item.get("type", "unknown"))
        by_type[t] = by_type.get(t, 0) + 1
    return {
        "entity_schema_version": 3,
        "total": len(items),
        "by_type": by_type,
    }


def _to_legacy_collection_payload(raw: Dict[str, Any], *, with_window: bool = False) -> Dict[str, Any]:
    entities_raw = raw.get("entities")
    entities = entities_raw if isinstance(entities_raw, list) else []

    payload: Dict[str, Any] = {
        "ok": True,
        "doc_name": raw.get("doc_name") or _try_active_doc_name(),
        "entities": entities,
        "summary": raw.get("summary") if isinstance(raw.get("summary"), dict) else _collection_summary(entities),
        "texts": [],
        "text_entities": [],
        "blocks": [],
        "polylines": [],
        "dimensions": [],
        "hatches": [],
        "tables": [],
        "lines": [],
        "circles": [],
        "arcs": [],
    }

    for ent in entities:
        if not isinstance(ent, dict):
            continue
        kind = str(ent.get("type", "")).lower()
        if kind in ("text", "mtext"):
            payload["text_entities"].append(ent)
            text_value = ent.get("content_clean") or ent.get("content")
            if isinstance(text_value, str) and text_value.strip():
                payload["texts"].append(text_value.strip())
        elif kind in ("lwpolyline", "polyline", "2d_polyline", "3d_polyline"):
            payload["polylines"].append(ent)
        elif kind == "dimension":
            payload["dimensions"].append(ent)
        elif kind == "block_reference":
            payload["blocks"].append(ent)
        elif kind == "hatch":
            payload["hatches"].append(ent)
        elif kind == "table":
            payload["tables"].append(ent)
        elif kind == "line":
            payload["lines"].append(ent)
        elif kind == "circle":
            payload["circles"].append(ent)
        elif kind == "arc":
            payload["arcs"].append(ent)

    if with_window:
        window = raw.get("window")
        if isinstance(window, dict) and isinstance(window.get("min"), list) and isinstance(window.get("max"), list):
            payload["window"] = window

    return payload


def _handle_session_connect(_params: Dict[str, Any]) -> Dict[str, Any]:
    info = _call_bridge("server.info", {})
    active, active_error = _try_active_doc()
    result: Dict[str, Any] = {
        "ok": True,
        "doc_name": active.get("name"),
        "version": info.get("autocad_version"),
    }
    if active_error:
        result["warning"] = f"active document unavailable: {active_error}"
    return result


def _handle_session_status(_params: Dict[str, Any]) -> Dict[str, Any]:
    info = _try_server_info()
    if not info:
        return {"connected": False}
    active, active_error = _try_active_doc()
    result: Dict[str, Any] = {
        "connected": True,
        "doc_name": active.get("name"),
        "version": info.get("autocad_version"),
    }
    if active_error:
        result["warning"] = f"active document unavailable: {active_error}"
    return result


def _handle_document_get_active(_params: Dict[str, Any]) -> Dict[str, Any]:
    active = _call_bridge("doc.active", {})
    info = _call_bridge("server.info", {})
    layout_list = _call_bridge("layout.list", {})
    active_layout_name = ""
    if isinstance(layout_list, list):
        for row in layout_list:
            if isinstance(row, dict) and bool(row.get("active")):
                active_layout_name = str(row.get("name", ""))
                break
    lower_layout = active_layout_name.lower()
    space = "unknown"
    if lower_layout == "model":
        space = "model"
    elif active_layout_name:
        space = "paper"
    return {
        "name": active.get("name"),
        "full_name": active.get("path"),
        "path": active.get("path"),
        "active_layout_name": active_layout_name,
        "space": space,
        "version": info.get("autocad_version"),
        "is_saved": active.get("saved"),
    }


def _handle_document_list(_params: Dict[str, Any]) -> Dict[str, Any]:
    documents = _call_bridge("doc.list", {})
    return {"documents": documents if isinstance(documents, list) else []}


def _handle_document_open(params: Dict[str, Any]) -> Dict[str, Any]:
    path = str((params or {}).get("path", "")).strip()
    if not path:
        raise ValueError("path is required")
    opened = _call_bridge("doc.open", {"path": path})
    active = _handle_document_get_active({})
    if isinstance(opened, dict):
        active["name"] = active.get("name") or opened.get("name")
        active["path"] = active.get("path") or opened.get("path")
        active["full_name"] = active.get("full_name") or opened.get("path")
    return active


def _handle_document_switch(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str((params or {}).get("name", "")).strip()
    if not name:
        raise ValueError("name is required")
    _call_bridge("doc.switch", {"name": name})
    return _handle_document_get_active({})


def _handle_selection_read_current(_params: Dict[str, Any]) -> Dict[str, Any]:
    raw = _call_bridge("entity.extract_selection", {})
    return _to_legacy_collection_payload(raw)


def _handle_selection_select_window(params: Dict[str, Any]) -> Dict[str, Any]:
    window = _window_to_min_max(params)
    raw = _call_bridge("entity.read_by_window", window)
    raw["window"] = window
    return _to_legacy_collection_payload(raw, with_window=True)


def _handle_selection_select_by_handle(params: Dict[str, Any]) -> Dict[str, Any]:
    handle = _normalize_handle(params.get("handle"))
    if not handle:
        raise ValueError("handle is required")
    _call_bridge("entity.select_by_handle", {"handle": handle})
    wrapped = _call_bridge("entity.read_by_handle", {"handle": handle})
    entity = wrapped.get("entity") if isinstance(wrapped, dict) else {}
    if not isinstance(entity, dict):
        entity = {}
    return {
        "ok": True,
        "handle": handle,
        "doc_name": _try_active_doc_name(),
        "object_name": _serialized_type_to_object_name(entity.get("type")),
        "layer": entity.get("layer"),
    }


def _handle_selection_clear(_params: Dict[str, Any]) -> Dict[str, Any]:
    _call_bridge("entity.clear_selection", {})
    return {
        "ok": True,
        "doc_name": _try_active_doc_name(),
        "count": 0,
        "handles": [],
        "entities": [],
    }


def _handle_view_zoom_window(params: Dict[str, Any]) -> Dict[str, Any]:
    return _call_bridge("view.zoom_window", _window_to_min_max(params))


def _handle_view_zoom_extents(_params: Dict[str, Any]) -> Dict[str, Any]:
    return _call_bridge("view.zoom_extents", {})


def _handle_view_zoom_center(params: Dict[str, Any]) -> Dict[str, Any]:
    center = params.get("center")
    if not isinstance(center, dict):
        raise ValueError("center params missing")
    payload = {
        "center": _point_to_xy(center),
        "scale": params.get("magnify"),
    }
    return _call_bridge("view.zoom_center", payload)


def _handle_view_pan(params: Dict[str, Any]) -> Dict[str, Any]:
    offset = params.get("offset")
    if not isinstance(offset, dict):
        raise ValueError("offset params missing")
    return _call_bridge("view.pan", {"offset": _point_to_xy(offset)})


def _handle_view_get_current(_params: Dict[str, Any]) -> Dict[str, Any]:
    result = _call_bridge("view.get_current", {})
    if not isinstance(result, dict):
        raise RuntimeError("view.get_current returned invalid result")
    result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_view_regen(_params: Dict[str, Any]) -> Dict[str, Any]:
    return _call_bridge("view.regen", {})


def _rect_to_bounds(rect) -> Dict[str, int]:
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


def _get_window_bounds(hwnd: int) -> Dict[str, Any]:
    if win32gui is None:
        return {}
    result: Dict[str, Any] = {}
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


def _handle_view_ensure_visible(_params: Dict[str, Any]) -> Dict[str, Any]:
    if win32gui is None or win32con is None:
        raise RuntimeError("pywin32 win32gui/win32con unavailable")

    acad = _get_acad_application()
    hwnd = int(getattr(acad, "HWND", 0) or 0)
    if hwnd <= 0 or not win32gui.IsWindow(hwnd):
        raise RuntimeError("AutoCAD window handle unavailable")

    warnings: List[str] = []
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

    return {
        "ok": True,
        "hwnd": hwnd,
        "restored": restored,
        "visible": bool(win32gui.IsWindowVisible(hwnd)),
        "iconic": bool(win32gui.IsIconic(hwnd)),
        "doc_name": _try_active_doc_name(),
        "warnings": warnings,
        **_get_window_bounds(hwnd),
    }


def _handle_view_screenshot(params: Dict[str, Any]) -> Dict[str, Any]:
    visibility: Dict[str, Any] | None = None
    try:
        visibility = _handle_view_ensure_visible({})
    except Exception as exc:
        visibility = {
            "ok": False,
            "warnings": [f"ensure visible failed: {exc}"],
        }

    payload = {
        "width": params.get("width"),
        "height": params.get("height"),
    }
    result = _call_bridge("view.screenshot", payload)
    if not isinstance(result, dict):
        raise RuntimeError("view.screenshot returned invalid result")

    result.setdefault("doc_name", _try_active_doc_name())
    result["width"] = params.get("width")
    result["height"] = params.get("height")
    result["visibility"] = visibility
    visibility_warnings = visibility.get("warnings") if isinstance(visibility, dict) else None
    if isinstance(visibility_warnings, list) and visibility_warnings:
        result["warning"] = "；".join(str(item) for item in visibility_warnings if item)
    return result


def _handle_view_screenshot_region(params: Dict[str, Any]) -> Dict[str, Any]:
    visibility: Dict[str, Any] | None = None
    try:
        visibility = _handle_view_ensure_visible({})
    except Exception as exc:
        visibility = {
            "ok": False,
            "warnings": [f"ensure visible failed: {exc}"],
        }

    payload = _window_to_min_max(params)
    payload["width"] = params.get("width")
    payload["height"] = params.get("height")
    result = _call_bridge("view.screenshot_region", payload)
    if not isinstance(result, dict):
        raise RuntimeError("view.screenshot_region returned invalid result")

    result.setdefault("doc_name", _try_active_doc_name())
    result["width"] = params.get("width")
    result["height"] = params.get("height")
    result["visibility"] = visibility
    visibility_warnings = visibility.get("warnings") if isinstance(visibility, dict) else None
    if isinstance(visibility_warnings, list) and visibility_warnings:
        result["warning"] = "；".join(str(item) for item in visibility_warnings if item)
    return result


def _handle_view_plot_region(params: Dict[str, Any]) -> Dict[str, Any]:
    payload = _window_to_min_max(params)
    if params.get("width") is not None:
        payload["width"] = params.get("width")
    if params.get("height") is not None:
        payload["height"] = params.get("height")
    if params.get("dpi") is not None:
        payload["dpi"] = params.get("dpi")
    if params.get("variant") is not None:
        payload["variant"] = params.get("variant")
    if params.get("profile") is not None:
        payload["profile"] = params.get("profile")
    if params.get("plot_config") is not None:
        payload["plot_config"] = params.get("plot_config")
    if params.get("plot_style") is not None:
        payload["plot_style"] = params.get("plot_style")
    if params.get("media") is not None:
        payload["media"] = params.get("media")
    if params.get("fit_mode") is not None:
        payload["fit_mode"] = params.get("fit_mode")
    if params.get("keep_diagnostics") is not None:
        payload["keep_diagnostics"] = params.get("keep_diagnostics")
    if params.get("strategy") is not None:
        payload["strategy"] = params.get("strategy")
    result = _call_bridge("view.plot_region", payload)
    if not isinstance(result, dict):
        raise RuntimeError("view.plot_region returned invalid result")
    result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_view_ensure_model_space(_params: Dict[str, Any]) -> Dict[str, Any]:
    result = _call_bridge("view.ensure_model_space", {})
    if not isinstance(result, dict):
        raise RuntimeError("view.ensure_model_space returned invalid result")
    result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_document_plot_layout_to_pdf(params: Dict[str, Any]) -> Dict[str, Any]:
    output_path = str((params or {}).get("output_path") or "").strip()
    if not output_path:
        raise ValueError("output_path required")
    payload = {
        "layout": (params or {}).get("layout"),
        "output_path": output_path,
    }
    result = _call_bridge("doc.plot_to_pdf", payload)
    if not isinstance(result, dict):
        raise RuntimeError("doc.plot_to_pdf returned invalid result")
    return result


def _handle_entities_extract_selection(_params: Dict[str, Any]) -> Dict[str, Any]:
    raw = _call_bridge("entity.extract_selection", {})
    return _to_legacy_collection_payload(raw)


def _handle_entities_extract_window(params: Dict[str, Any]) -> Dict[str, Any]:
    window = _window_to_min_max(params)
    raw = _call_bridge("entity.read_by_window", window)
    raw["window"] = window
    return _to_legacy_collection_payload(raw, with_window=True)


def _handle_entities_get_by_handle(params: Dict[str, Any]) -> Dict[str, Any]:
    handle = _normalize_handle(params.get("handle"))
    if not handle:
        raise ValueError("handle is required")
    wrapped = _call_bridge("entity.read_by_handle", {"handle": handle})
    entity = wrapped.get("entity") if isinstance(wrapped, dict) else None
    if not isinstance(entity, dict):
        raise RuntimeError(f"entity not found by handle: {handle}")
    payload = dict(entity)
    payload["object_name"] = _serialized_type_to_object_name(entity.get("type"))
    payload["doc_name"] = _try_active_doc_name()
    return payload


def _handle_entities_read_text(_params: Dict[str, Any]) -> Dict[str, Any]:
    raw = _call_bridge("annotate.read_all_text", {"clean": True})
    items = raw.get("items") if isinstance(raw, dict) else []
    texts: List[str] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            text = item.get("content_clean") or item.get("content")
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
    return {
        "ok": True,
        "doc_name": _try_active_doc_name(),
        "texts": texts,
        "text_count": len(texts),
    }


def _handle_capture_hint(_params: Dict[str, Any]) -> Dict[str, Any]:
    name = _try_active_doc_name() or "AutoCAD"
    bounds: Dict[str, Any] = {}
    try:
        acad = _get_acad_application()
        hwnd = int(getattr(acad, "HWND", 0) or 0)
        if hwnd > 0:
            bounds = _get_window_bounds(hwnd)
    except Exception:
        bounds = {}
    return {
        "doc_name": name,
        "preferred_window_title": f"{name} - AutoCAD",
        "window_title_candidates": [f"{name} - AutoCAD", name, "AutoCAD"],
        **bounds,
    }


def _handle_collections_list_layers(_params: Dict[str, Any]) -> Dict[str, Any]:
    rows = _call_bridge("layer.list", {"include_count": False})
    layers: List[Dict[str, Any]] = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            layers.append(
                {
                    "name": row.get("name"),
                    "color": row.get("color"),
                    "is_on": row.get("on"),
                    "is_frozen": row.get("frozen"),
                    "is_locked": row.get("locked"),
                }
            )
    return {"layers": layers}


def _handle_collections_list_layouts(_params: Dict[str, Any]) -> Dict[str, Any]:
    rows = _call_bridge("layout.list", {})
    layouts: List[Dict[str, Any]] = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            if not isinstance(name, str):
                continue
            layouts.append(
                {
                    "name": name,
                    "model_type": name.lower() == "model",
                    "tab_order": row.get("tab_order"),
                }
            )
    return {"layouts": layouts}


def _handle_collections_list_blocks(_params: Dict[str, Any]) -> Dict[str, Any]:
    rows = _call_bridge("block.list", {})
    blocks: List[Dict[str, Any]] = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            if not isinstance(name, str):
                continue
            blocks.append({"name": name})
    return {"blocks": blocks}


def _handle_variables_get(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    raw = _call_bridge("doc.get_variable", {"name": name})
    return {"name": name, "value": raw.get("value")}


def _handle_commands_send(params: Dict[str, Any]) -> Dict[str, Any]:
    command = str(params.get("command") or "").strip()
    if not command:
        raise ValueError("command is required")
    return _call_bridge("doc.send_command", {"command": command})


def _handle_annotations_read_all_text(params: Dict[str, Any]) -> Dict[str, Any]:
    payload = {}
    if "layers" in params:
        payload["layers"] = params.get("layers")
    if "clean" in params:
        payload["clean"] = params.get("clean")
    result = _call_bridge("annotate.read_all_text", payload)
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_annotations_read_all_dimensions(params: Dict[str, Any]) -> Dict[str, Any]:
    payload = {}
    if "layers" in params:
        payload["layers"] = params.get("layers")
    result = _call_bridge("annotate.read_all_dims", payload)
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_annotations_read_all_tables(params: Dict[str, Any]) -> Dict[str, Any]:
    payload = {}
    if "layers" in params:
        payload["layers"] = params.get("layers")
    result = _call_bridge("annotate.read_all_tables", payload)
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_annotations_find_text(params: Dict[str, Any]) -> Dict[str, Any]:
    result = _call_bridge(
        "annotate.find_text",
        {
            "pattern": params.get("pattern"),
            "regex": bool(params.get("regex")),
            "limit": params.get("limit"),
            "max_entities_scanned": params.get("max_entities_scanned"),
        },
    )
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_annotations_find_text_plus(params: Dict[str, Any]) -> Dict[str, Any]:
    result = _call_bridge(
        "annotate.find_text_plus",
        {
            "pattern": params.get("pattern"),
            "regex": bool(params.get("regex")),
            "case_sensitive": bool(params.get("case_sensitive")),
            "normalized": params.get("normalized"),
            "limit": params.get("limit"),
            "max_entities_scanned": params.get("max_entities_scanned"),
            "sources": params.get("sources"),
            "keywords": params.get("keywords"),
            "scan_all_matches": bool(params.get("scan_all_matches")),
        },
    )
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_geometry_distance_pp(params: Dict[str, Any]) -> Dict[str, Any]:
    p1 = params.get("p1")
    p2 = params.get("p2")
    if not isinstance(p1, dict) or not isinstance(p2, dict):
        raise ValueError("p1 and p2 are required")
    return _call_bridge("geometry.distance_pp", {"p1": _point_to_xy(p1), "p2": _point_to_xy(p2)})


def _handle_geometry_area_by_handle(params: Dict[str, Any]) -> Dict[str, Any]:
    return _call_bridge("geometry.area", {"handle": _normalize_handle(params.get("handle"))})


def _handle_geometry_length_by_handle(params: Dict[str, Any]) -> Dict[str, Any]:
    return _call_bridge("geometry.length", {"handle": _normalize_handle(params.get("handle"))})


def _handle_geometry_bbox_by_handles(params: Dict[str, Any]) -> Dict[str, Any]:
    handles = params.get("handles")
    if not isinstance(handles, list) or len(handles) == 0:
        raise ValueError("handles is required")
    return _call_bridge("geometry.bounding_box", {"handles": [_normalize_handle(h) for h in handles]})


def _handle_composite_scan_drawing(params: Dict[str, Any]) -> Dict[str, Any]:
    payload = {}
    if "max_entities" in params:
        payload["max_entities"] = params.get("max_entities")
    return _call_bridge("composite.scan_drawing", payload)


def _handle_composite_region_extract(params: Dict[str, Any]) -> Dict[str, Any]:
    window = _window_to_min_max(params)
    payload = {
        "min": window["min"],
        "max": window["max"],
        "layers": params.get("layers"),
        "types": params.get("types"),
        "width": params.get("width"),
        "height": params.get("height"),
    }
    return _call_bridge("composite.region_extract", payload)


def _handle_composite_batch_read(params: Dict[str, Any]) -> Dict[str, Any]:
    handles = params.get("handles")
    if not isinstance(handles, list):
        raise ValueError("handles is required")
    return _call_bridge(
        "composite.batch_read",
        {
            "handles": [_normalize_handle(h) for h in handles],
            "include_nearby": bool(params.get("include_nearby")),
        },
    )


def _handle_entities_read_by_filter(params: Dict[str, Any]) -> Dict[str, Any]:
    if (
        _get_bridge_application is not None
        and _serialize_entity is not None
        and _evaluate_filter_spec is not None
        and _filter_spec_from_param is not None
    ):
        acad = _get_bridge_application()
        doc = acad.ActiveDocument
        ms = doc.ModelSpace
        total = int(getattr(ms, "Count", 0) or 0)
        interval = _safe_int(params.get("progress_interval"), 200)
        filt = _filter_spec_from_param(params.get("filter"))
        entities: List[Dict[str, Any]] = []
        failed_count = 0
        _send_progress(0, total, matched=0, failed=0, phase="read_entities", message="开始扫描 CAD 实体")

        for i in range(total):
            try:
                ent = ms.Item(i)
            except Exception:
                failed_count += 1
                if (i + 1) % interval == 0:
                    _send_progress(
                        i + 1,
                        total,
                        matched=len(entities),
                        failed=failed_count,
                        phase="read_entities",
                        message="正在扫描 CAD 实体",
                    )
                continue

            try:
                serialized = _serialize_entity(ent)
            except Exception:
                failed_count += 1
                if (i + 1) % interval == 0:
                    _send_progress(
                        i + 1,
                        total,
                        matched=len(entities),
                        failed=failed_count,
                        phase="read_entities",
                        message="正在扫描 CAD 实体",
                    )
                continue

            try:
                if _evaluate_filter_spec(serialized, filt):
                    entities.append(serialized)
            except Exception:
                pass

            if (i + 1) % interval == 0:
                _send_progress(
                    i + 1,
                    total,
                    matched=len(entities),
                    failed=failed_count,
                    phase="read_entities",
                    message="正在扫描 CAD 实体",
                )

        if total > 0:
            _send_progress(
                total,
                total,
                matched=len(entities),
                failed=failed_count,
                phase="read_entities",
                message="CAD 实体扫描完成",
            )

        if _EntityCache is not None:
            try:
                _EntityCache.set_from_read_all(doc, entities)
            except Exception:
                pass

        return {
            "entities": entities,
            "count": len(entities),
            "doc_name": _try_active_doc_name(),
        }

    result = _call_bridge("entity.read_by_filter", {"filter": params.get("filter")})
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_entities_read_readable_index(params: Dict[str, Any]) -> Dict[str, Any]:
    if _get_bridge_application is None or _serialize_entity is None:
        filter_payload = {
            "or": [
                {"type": ["text", "mtext", "dimension", "block_reference", "table", "leader", "mleader"]},
            ],
        }
        result = _call_bridge("entity.read_by_filter", {"filter": filter_payload})
        if isinstance(result, dict):
            entities = result.get("entities") if isinstance(result.get("entities"), list) else []
            summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
            result["summary"] = {
                **summary,
                "entity_schema_version": 4,
                "profile": READABLE_INDEX_PROFILE,
                "source_entity_count": len(entities),
                "indexed_entity_count": len(entities),
                "omitted_geometry_count": 0,
            }
            result.setdefault("doc_name", _try_active_doc_name())
        return result

    acad = _get_bridge_application()
    doc = acad.ActiveDocument
    ms = doc.ModelSpace
    total = int(getattr(ms, "Count", 0) or 0)
    interval = _safe_int(params.get("progress_interval"), 200)
    entities: List[Dict[str, Any]] = []
    object_counts: Dict[str, int] = {}
    type_counts: Dict[str, int] = {}
    layer_counts: Dict[str, int] = {}
    indexed_type_counts: Dict[str, int] = {}
    omitted_type_counts: Dict[str, int] = {}
    failed_count = 0
    _send_progress(0, total, matched=0, failed=0, phase="read_entities", message="开始扫描 CAD 可读实体")

    for i in range(total):
        try:
            ent = ms.Item(i)
        except Exception:
            failed_count += 1
            if (i + 1) % interval == 0:
                _send_progress(
                    i + 1,
                    total,
                    matched=len(entities),
                    failed=failed_count,
                    phase="read_entities",
                    message="正在扫描 CAD 可读实体",
                )
            continue

        try:
            object_name = str(getattr(ent, "ObjectName", "") or "").strip()
        except Exception:
            object_name = "AcDbEntity"

        try:
            layer = str(getattr(ent, "Layer", "") or "").strip()
        except Exception:
            layer = "(empty)"

        type_key = _object_name_to_type_key(object_name)
        _add_count(object_counts, object_name or "AcDbEntity")
        _add_count(type_counts, type_key)
        _add_count(layer_counts, layer)

        if not _is_readable_index_object_name(object_name):
            _add_count(omitted_type_counts, type_key)
            if (i + 1) % interval == 0:
                _send_progress(
                    i + 1,
                    total,
                    matched=len(entities),
                    failed=failed_count,
                    phase="read_entities",
                    message="正在扫描 CAD 可读实体",
                )
            continue

        try:
            serialized = _serialize_entity(ent)
        except Exception:
            failed_count += 1
            _add_count(omitted_type_counts, type_key)
            if (i + 1) % interval == 0:
                _send_progress(
                    i + 1,
                    total,
                    matched=len(entities),
                    failed=failed_count,
                    phase="read_entities",
                    message="正在扫描 CAD 可读实体",
                )
            continue

        entities.append(serialized)
        _add_count(indexed_type_counts, str(serialized.get("type") or type_key))

        if (i + 1) % interval == 0:
            _send_progress(
                i + 1,
                total,
                matched=len(entities),
                failed=failed_count,
                phase="read_entities",
                message="正在扫描 CAD 可读实体",
            )

    if total > 0:
        _send_progress(
            total,
            total,
            matched=len(entities),
            failed=failed_count,
            phase="read_entities",
            message="CAD 可读实体扫描完成",
        )

    omitted_count = max(0, total - len(entities))
    return {
        "entities": entities,
        "count": len(entities),
        "doc_name": _try_active_doc_name(),
        "summary": {
            "entity_schema_version": 4,
            "profile": READABLE_INDEX_PROFILE,
            "total": total,
            "source_entity_count": total,
            "indexed_entity_count": len(entities),
            "omitted_geometry_count": omitted_count,
            "by_object_name": object_counts,
            "by_type": type_counts,
            "by_layer": layer_counts,
            "indexed_by_type": indexed_type_counts,
            "omitted_by_type": omitted_type_counts,
            "readable_object_names": sorted(READABLE_INDEX_OBJECT_NAMES),
        },
    }


def _handle_entities_read_by_polygon(params: Dict[str, Any]) -> Dict[str, Any]:
    points = params.get("points")
    if not isinstance(points, list) or len(points) < 3:
        raise ValueError("points is required and must contain at least 3 points")
    converted: List[List[float]] = []
    for point in points:
        if isinstance(point, dict):
            converted.append(_point_to_xy(point))
        elif isinstance(point, list) and len(point) >= 2:
            converted.append([float(point[0]), float(point[1])])
        else:
            raise ValueError("invalid polygon point")
    result = _call_bridge("entity.read_by_polygon", {"points": converted})
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_selection_nearby(params: Dict[str, Any]) -> Dict[str, Any]:
    point = params.get("point")
    if not isinstance(point, dict):
        raise ValueError("point is required")
    result = _call_bridge(
        "selection.nearby",
        {
            "point": _point_to_xy(point),
            "radius": params.get("radius"),
            "layers": params.get("layers"),
            "types": params.get("types"),
        },
    )
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


def _handle_selection_nearest(params: Dict[str, Any]) -> Dict[str, Any]:
    point = params.get("point")
    if not isinstance(point, dict):
        raise ValueError("point is required")
    result = _call_bridge(
        "selection.nearest",
        {
            "point": _point_to_xy(point),
            "types": params.get("types"),
            "count": params.get("count"),
        },
    )
    if isinstance(result, dict):
        result.setdefault("doc_name", _try_active_doc_name())
    return result


HANDLERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    # existing protocol
    "cad.session.connect": _handle_session_connect,
    "cad.session.status": _handle_session_status,
    "cad.document.getActive": _handle_document_get_active,
    "cad.document.list": _handle_document_list,
    "cad.document.open": _handle_document_open,
    "cad.document.switch": _handle_document_switch,
    "cad.selection.readCurrent": _handle_selection_read_current,
    "cad.selection.selectWindow": _handle_selection_select_window,
    "cad.selection.selectByHandle": _handle_selection_select_by_handle,
    "cad.selection.clear": _handle_selection_clear,
    "cad.view.zoomWindow": _handle_view_zoom_window,
    "cad.view.zoomExtents": _handle_view_zoom_extents,
    "cad.view.zoomCenter": _handle_view_zoom_center,
    "cad.view.pan": _handle_view_pan,
    "cad.view.getCurrent": _handle_view_get_current,
    "cad.view.regen": _handle_view_regen,
    "cad.view.ensureVisible": _handle_view_ensure_visible,
    "cad.view.screenshot": _handle_view_screenshot,
    "cad.view.screenshotRegion": _handle_view_screenshot_region,
    "cad.view.plotRegion": _handle_view_plot_region,
    "cad.view.ensureModelSpace": _handle_view_ensure_model_space,
    "cad.document.plotLayoutToPdf": _handle_document_plot_layout_to_pdf,
    "cad.entities.extractSelection": _handle_entities_extract_selection,
    "cad.entities.extractWindow": _handle_entities_extract_window,
    "cad.entities.getByHandle": _handle_entities_get_by_handle,
    "cad.entities.readText": _handle_entities_read_text,
    "cad.capture.hint": _handle_capture_hint,
    "cad.collections.listLayers": _handle_collections_list_layers,
    "cad.collections.listLayouts": _handle_collections_list_layouts,
    "cad.collections.listBlocks": _handle_collections_list_blocks,
    "cad.variables.get": _handle_variables_get,
    "cad.commands.send": _handle_commands_send,
    # read-only extensions
    "cad.annotations.readAllText": _handle_annotations_read_all_text,
    "cad.annotations.readAllDimensions": _handle_annotations_read_all_dimensions,
    "cad.annotations.readAllTables": _handle_annotations_read_all_tables,
    "cad.annotations.findText": _handle_annotations_find_text,
    "cad.annotations.findTextPlus": _handle_annotations_find_text_plus,
    "cad.geometry.distancePointPoint": _handle_geometry_distance_pp,
    "cad.geometry.areaByHandle": _handle_geometry_area_by_handle,
    "cad.geometry.lengthByHandle": _handle_geometry_length_by_handle,
    "cad.geometry.boundingBoxByHandles": _handle_geometry_bbox_by_handles,
    "cad.composite.scanDrawing": _handle_composite_scan_drawing,
    "cad.composite.regionExtract": _handle_composite_region_extract,
    "cad.composite.batchRead": _handle_composite_batch_read,
    "cad.entities.readByFilter": _handle_entities_read_by_filter,
    "cad.entities.readReadableIndex": _handle_entities_read_readable_index,
    "cad.entities.readByPolygon": _handle_entities_read_by_polygon,
    "cad.selection.nearby": _handle_selection_nearby,
    "cad.selection.nearest": _handle_selection_nearest,
}


def main() -> None:
    global _BRIDGE_RUNTIME_ERROR, _CURRENT_REQUEST_ID
    sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    if billnova_bridge is not None:
        try:
            billnova_bridge.com_initialize()
        except Exception as exc:
            _BRIDGE_RUNTIME_ERROR = (
                "BillNova bridge COM initialize failed. "
                f"{exc}"
            )
    else:
        sys.stderr.write(f"[cad-worker:billnova] {_bridge_error_message()}\n")

    ready_result: Dict[str, Any] = {"status": "ready"}
    if billnova_bridge is None or _BRIDGE_RUNTIME_ERROR:
        ready_result["warning"] = _bridge_error_message()
    _send({"id": 0, "result": ready_result})

    for line in sys.stdin:
        text = line.strip()
        if not text:
            continue
        try:
            msg = json.loads(text)
        except json.JSONDecodeError as exc:
            _send({"id": 0, "error": {"code": -32700, "message": f"Parse error: {exc}"}})
            continue
        req_id = msg.get("id", 0)
        method = str(msg.get("method", "") or "")
        params = msg.get("params", {})
        if not isinstance(params, dict):
            params = {}
        if billnova_bridge is None or _BRIDGE_RUNTIME_ERROR:
            _send({"id": req_id, "error": {"code": -1, "message": _bridge_error_message()}})
            continue
        handler = HANDLERS.get(method)
        if handler is None:
            _send({"id": req_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}})
            continue
        _CURRENT_REQUEST_ID = req_id if isinstance(req_id, int) else None
        try:
            result = handler(params)
            _send({"id": req_id, "result": result})
        except Exception as exc:
            tb = traceback.format_exc()
            _send({"id": req_id, "error": {"code": -1, "message": f"{exc}\n{tb}"}})
        finally:
            _CURRENT_REQUEST_ID = None


if __name__ == "__main__":
    main()
