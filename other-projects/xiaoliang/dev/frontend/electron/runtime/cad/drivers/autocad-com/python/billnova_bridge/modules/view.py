"""view.* RPC"""

import math
import os
import tempfile
import time
from typing import Any, Dict, List, Optional

import pythoncom
from win32com.client import VARIANT

from helpers.screenshot import (
    capture_cad_viewport_b64,
    capture_cad_viewport_png,
    rasterize_pdf_to_png,
)
from helpers.variant import make_point, round_point

# AcPlotType / AcPlotScale 常量
AC_PLOT_TYPE_DISPLAY = 0
AC_PLOT_TYPE_EXTENTS = 1
AC_PLOT_TYPE_WINDOW = 4
AC_PLOT_SCALE_TO_FIT = 0

MIN_VALID_PLOT_PDF_BYTES = 2048
MIN_VALID_PLOT_INK_RATIO = 0.0015
# AutoCAD PDF plotter may open *.pdf via the OS default viewer after PlotToFile.
# Use an unassociated extension for internal plot artifacts; pypdfium reads by file
# content, so the rasterizer does not require a .pdf suffix.
SILENT_PDF_OUTPUT_EXTENSION = ".cadplot"


def _pt2(x: float, y: float) -> VARIANT:
    """SetWindowToPlot 需要 2 维点（VT_ARRAY|VT_R8）。"""
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, (float(x), float(y)))


def _safe_get(obj, name: str):
    try:
        return getattr(obj, name)
    except Exception:
        return None


def _safe_set(obj, name: str, value: Any, warnings: Optional[List[str]] = None) -> None:
    try:
        setattr(obj, name, value)
    except Exception as exc:
        if warnings is not None:
            warnings.append(f"设置 {name}={value} 失败: {exc}")


def _restore_layout(layout, state: Dict[str, Any]) -> None:
    for name, value in state.items():
        if value is None:
            continue
        try:
            setattr(layout, name, value)
        except Exception:
            pass


def _window_aspect(min_x: float, min_y: float, max_x: float, max_y: float) -> float:
    width = max(1.0, abs(max_x - min_x))
    height = max(1.0, abs(max_y - min_y))
    return width / height


def _metric_number(metrics: Dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        value = metrics.get(key)
        return float(value) if value is not None else default
    except Exception:
        return default


def _resolve_plot_output_path(requested_path: str) -> str:
    candidates = [
        requested_path,
        f"{requested_path}.pdf",
        f"{os.path.splitext(requested_path)[0]}.pdf",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return requested_path


def _plot_quality_score(result: Dict[str, Any]) -> float:
    metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
    ink_ratio = _metric_number(metrics, "ink_ratio")
    byte_length = _metric_number(metrics, "byte_length")
    output_width = _metric_number(metrics, "output_content_width", _metric_number(metrics, "width"))
    output_height = _metric_number(metrics, "output_content_height", _metric_number(metrics, "height"))
    crop_area_ratio = _metric_number(metrics, "crop_area_ratio")
    content_area_ratio = _metric_number(metrics, "content_area_ratio")
    if ink_ratio < MIN_VALID_PLOT_INK_RATIO or output_width < 240 or output_height < 180:
        return 0.0
    return (
        ink_ratio * 1000.0
        + min(byte_length / 200000.0, 6.0)
        + min(output_width * output_height / 2500000.0, 6.0)
        + min(crop_area_ratio * 4.0, 4.0)
        + min(content_area_ratio * 3.0, 3.0)
    )


def _is_plot_result_valid(result: Dict[str, Any]) -> bool:
    return _plot_quality_score(result) > 0.0


def _ensure_model_space(doc) -> List[str]:
    """确保当前在模型空间（TILEMODE=1），返回告警列表。"""
    warnings: List[str] = []
    try:
        tilemode = doc.GetVariable("TILEMODE")
        if int(tilemode) != 1:
            doc.SetVariable("TILEMODE", 1)
            warnings.append("已从图纸空间切换到模型空间 (TILEMODE=1)")
    except Exception as exc:
        warnings.append(f"确保模型空间失败: {exc}")
    return warnings


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


def rpc_view_zoom_window(acad, params) -> Dict[str, Any]:
    params = params or {}
    mn = params.get("min")
    mx = params.get("max")
    if not mn or not mx:
        raise ValueError("min and max required")
    pt1 = make_point(float(mn[0]), float(mn[1]))
    pt2 = make_point(float(mx[0]), float(mx[1]))
    acad.ZoomWindow(pt1, pt2)
    return {"ok": True}


def rpc_view_zoom_extents(acad, _params) -> Dict[str, Any]:
    acad.ZoomExtents()
    return {"ok": True}


def rpc_view_zoom_center(acad, params) -> Dict[str, Any]:
    params = params or {}
    c = params.get("center")
    if not c:
        raise ValueError("center required")
    mag = float(params.get("scale") or 1.0)
    pt = make_point(float(c[0]), float(c[1]))
    acad.ZoomCenter(pt, mag)
    return {"ok": True}


def rpc_view_zoom_object(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    padding = float(params.get("padding") or 0.0)
    doc = _active_doc(acad)
    obj = doc.HandleToObject(_normalize_handle(str(handle)))
    mn, mx = obj.GetBoundingBox()
    min_pt = [float(mn[0]) - padding, float(mn[1]) - padding]
    max_pt = [float(mx[0]) + padding, float(mx[1]) + padding]
    pt1 = make_point(min_pt[0], min_pt[1])
    pt2 = make_point(max_pt[0], max_pt[1])
    acad.ZoomWindow(pt1, pt2)
    return {"ok": True}


def rpc_view_pan(acad, params) -> Dict[str, Any]:
    params = params or {}
    off = params.get("offset")
    if not off or len(off) < 2:
        raise ValueError("offset [dx,dy] required")
    doc = _active_doc(acad)
    vc = doc.GetVariable("VIEWCTR")
    nx = float(vc[0]) + float(off[0])
    ny = float(vc[1]) + float(off[1])
    pt = make_point(nx, ny)
    acad.ZoomCenter(pt, 1.0)
    return {"ok": True}


def rpc_view_get_current(acad, _params) -> Dict[str, Any]:
    doc = _active_doc(acad)
    vc = doc.GetVariable("VIEWCTR")
    vs = doc.GetVariable("VIEWSIZE")
    ss = doc.GetVariable("SCREENSIZE")
    screen: List[float]
    try:
        screen = [round(float(ss[0]), 2), round(float(ss[1]), 2)]
    except Exception:
        screen = [0.0, 0.0]
    return {
        "view_center": round_point(vc),
        "view_size": round(float(vs), 4) if vs is not None else None,
        "screen_size": screen,
    }


def rpc_view_screenshot(acad, params) -> Dict[str, Any]:
    params = params or {}
    w = params.get("width")
    h = params.get("height")
    wi = int(w) if w is not None else None
    hi = int(h) if h is not None else None
    return capture_cad_viewport_png(acad, width=wi, height=hi)


def rpc_view_screenshot_region(acad, params) -> Dict[str, Any]:
    params = params or {}
    mn = params.get("min")
    mx = params.get("max")
    if not mn or not mx:
        raise ValueError("min and max required")
    w = params.get("width")
    h = params.get("height")
    wi = int(w) if w is not None else None
    hi = int(h) if h is not None else None
    doc = _active_doc(acad)
    rpc_view_zoom_window(acad, {"min": mn, "max": mx})
    b64 = capture_cad_viewport_b64(acad, width=wi, height=hi)
    doc.SendCommand("ZOOM P\n")
    return {"image_base64": b64, "format": "png"}


def rpc_view_regen(acad, _params) -> Dict[str, Any]:
    doc = _active_doc(acad)
    doc.SendCommand("REGEN\n")
    return {"ok": True}


def rpc_view_ensure_model_space(acad, _params) -> Dict[str, Any]:
    doc = _active_doc(acad)
    warnings = _ensure_model_space(doc)
    active_layout = ""
    try:
        active_layout = str(doc.ActiveLayout.Name)
    except Exception:
        pass
    return {"ok": True, "active_layout": active_layout, "warnings": warnings}


def rpc_view_plot_region(acad, params) -> Dict[str, Any]:
    """按 CAD 坐标窗口出图，返回尽量高有效像素占比的 PNG。

    通用策略：
    1. 先尝试 COM acWindow 精确窗口出图；
    2. 若窗口出图为空白/低质量，ZoomWindow 后用 acDisplay 出当前显示区域；
    3. overview/profile 场景可再用 acExtents 兜底拿全图分布。

    每次尝试都会把 PDF、raster、cropped、final 图片写入 trace 目录，便于复盘采样。"""
    params = params or {}
    mn = params.get("min")
    mx = params.get("max")
    if not mn or not mx:
        raise ValueError("min and max required")
    dpi = int(params.get("dpi") or 150)
    w = params.get("width")
    h = params.get("height")
    wi = int(w) if w is not None else None
    hi = int(h) if h is not None else None
    config_name = str(params.get("plot_config") or "DWG To PDF.pc3")
    media_name = params.get("media")
    variant = str(params.get("variant") or "color").lower()
    profile = str(params.get("profile") or "region").lower()
    fit_mode = str(params.get("fit_mode") or "max").lower()
    keep_diagnostics = bool(params.get("keep_diagnostics", False))
    strategy = str(params.get("strategy") or "auto").lower()
    plot_style = params.get("plot_style")
    if not plot_style and variant in ("mono", "both"):
        plot_style = "monochrome.ctb"

    doc = _active_doc(acad)
    warnings = _ensure_model_space(doc)

    x1, y1 = float(mn[0]), float(mn[1])
    x2, y2 = float(mx[0]), float(mx[1])
    min_x = min(x1, x2)
    min_y = min(y1, y2)
    max_x = max(x1, x2)
    max_y = max(y1, y2)
    requested_aspect = _window_aspect(min_x, min_y, max_x, max_y)

    layout = doc.ActiveLayout
    restore_state = {
        "PlotType": _safe_get(layout, "PlotType"),
        "UseStandardScale": _safe_get(layout, "UseStandardScale"),
        "StandardScale": _safe_get(layout, "StandardScale"),
        "CenterPlot": _safe_get(layout, "CenterPlot"),
        "PlotRotation": _safe_get(layout, "PlotRotation"),
        "PlotWithLineweights": _safe_get(layout, "PlotWithLineweights"),
        "PlotWithPlotStyles": _safe_get(layout, "PlotWithPlotStyles"),
        "ConfigName": _safe_get(layout, "ConfigName"),
        "StyleSheet": _safe_get(layout, "StyleSheet"),
        "CanonicalMediaName": _safe_get(layout, "CanonicalMediaName"),
    }

    try:
        doc.SetVariable("BACKGROUNDPLOT", 0)
    except Exception:
        pass

    trace_dir = tempfile.mkdtemp(prefix="cad_plot_trace_") if keep_diagnostics else None
    temp_dir = trace_dir or tempfile.mkdtemp(prefix="cad_plot_")

    def configure_common(plot_type: int, attempt_warnings: List[str]) -> None:
        _safe_set(layout, "ConfigName", config_name, attempt_warnings)
        try:
            layout.RefreshPlotDeviceInfo()
        except Exception:
            pass
        if media_name:
            _safe_set(layout, "CanonicalMediaName", str(media_name), attempt_warnings)
        _safe_set(layout, "PlotType", plot_type, attempt_warnings)
        _safe_set(layout, "UseStandardScale", True, attempt_warnings)
        _safe_set(layout, "StandardScale", AC_PLOT_SCALE_TO_FIT, attempt_warnings)
        _safe_set(layout, "CenterPlot", True, attempt_warnings)
        _safe_set(layout, "PlotRotation", 0, attempt_warnings)
        _safe_set(layout, "PlotWithLineweights", True, attempt_warnings)
        _safe_set(layout, "PlotWithPlotStyles", True, attempt_warnings)
        if plot_style:
            _safe_set(layout, "StyleSheet", str(plot_style), attempt_warnings)

    def plot_attempt(name: str) -> Dict[str, Any]:
        attempt_warnings: List[str] = []
        pdf_path = os.path.join(temp_dir, f"{name}{SILENT_PDF_OUTPUT_EXTENSION}")
        started_at = time.time()
        try:
            if name == "window":
                configure_common(AC_PLOT_TYPE_WINDOW, attempt_warnings)
                try:
                    layout.SetWindowToPlot(_pt2(min_x, min_y), _pt2(max_x, max_y))
                    _safe_set(layout, "PlotType", AC_PLOT_TYPE_WINDOW, attempt_warnings)
                except Exception as exc:
                    raise RuntimeError(f"SetWindowToPlot 失败: {exc}") from exc
            elif name == "display":
                try:
                    acad.ZoomWindow(make_point(min_x, min_y), make_point(max_x, max_y))
                except Exception as exc:
                    attempt_warnings.append(f"ZoomWindow 失败: {exc}")
                configure_common(AC_PLOT_TYPE_DISPLAY, attempt_warnings)
            elif name == "extents":
                try:
                    acad.ZoomExtents()
                except Exception as exc:
                    attempt_warnings.append(f"ZoomExtents 失败: {exc}")
                configure_common(AC_PLOT_TYPE_EXTENTS, attempt_warnings)
            else:
                raise RuntimeError(f"未知 plot strategy: {name}")

            ok = doc.Plot.PlotToFile(pdf_path)
            actual_pdf_path = _resolve_plot_output_path(pdf_path)
            pdf_bytes = int(os.path.getsize(actual_pdf_path)) if os.path.exists(actual_pdf_path) else 0
            if ok is False or pdf_bytes <= 0:
                raise RuntimeError("PlotToFile 未生成有效 PDF")
            if pdf_bytes < MIN_VALID_PLOT_PDF_BYTES:
                raise RuntimeError(f"PlotToFile PDF 过小，疑似空白: {pdf_bytes} bytes")

            result = rasterize_pdf_to_png(
                actual_pdf_path,
                dpi=dpi,
                width=wi,
                height=hi,
                variant=variant,
                fit_mode=fit_mode,
                diagnostic_dir=trace_dir,
                diagnostic_prefix=name,
            )
            metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
            metrics.update({
                "plot_strategy": name,
                "requested_window_min_x": min_x,
                "requested_window_min_y": min_y,
                "requested_window_max_x": max_x,
                "requested_window_max_y": max_y,
                "requested_window_aspect": round(requested_aspect, 6),
                "trace_dir": trace_dir,
                "trace_pdf_path": actual_pdf_path if trace_dir else None,
                "plot_pdf_extension_suppressed": actual_pdf_path == pdf_path,
            })
            if attempt_warnings:
                result["warning"] = "；".join(attempt_warnings)
            result["metrics"] = metrics
            result["plot_strategy"] = name
            result["trace_dir"] = trace_dir
            result["trace_pdf_path"] = actual_pdf_path if trace_dir else None
            result["score"] = _plot_quality_score(result)
            return {
                "strategy": name,
                "success": True,
                "valid": _is_plot_result_valid(result),
                "score": result["score"],
                "pdf_path": actual_pdf_path if trace_dir else None,
                "pdf_bytes": pdf_bytes,
                "elapsed_ms": int(round((time.time() - started_at) * 1000)),
                "warning": "；".join(attempt_warnings) if attempt_warnings else None,
                "metrics": metrics,
                "result": result,
            }
        except Exception as exc:
            actual_pdf_path = _resolve_plot_output_path(pdf_path)
            pdf_bytes = int(os.path.getsize(actual_pdf_path)) if os.path.exists(actual_pdf_path) else 0
            return {
                "strategy": name,
                "success": False,
                "valid": False,
                "score": 0.0,
                "pdf_path": actual_pdf_path if trace_dir and os.path.exists(actual_pdf_path) else None,
                "pdf_bytes": pdf_bytes,
                "elapsed_ms": int(round((time.time() - started_at) * 1000)),
                "warning": "；".join(attempt_warnings) if attempt_warnings else None,
                "error": str(exc),
            }

    if strategy in ("window", "display", "extents"):
        strategy_order = [strategy]
    else:
        strategy_order = ["window", "display"]
        if profile == "overview":
            strategy_order.append("extents")

    attempts: List[Dict[str, Any]] = []
    valid_attempts: List[Dict[str, Any]] = []
    selected: Optional[Dict[str, Any]] = None
    try:
        attempts = [plot_attempt(name) for name in strategy_order]
        valid_attempts = [attempt for attempt in attempts if attempt.get("valid") and isinstance(attempt.get("result"), dict)]
        selected = max(valid_attempts, key=lambda item: float(item.get("score") or 0.0)) if valid_attempts else None
    finally:
        try:
            _restore_layout(layout, restore_state)
        except Exception:
            pass

    if selected is None:
        if not trace_dir:
            try:
                for name in os.listdir(temp_dir):
                    os.remove(os.path.join(temp_dir, name))
                os.rmdir(temp_dir)
            except Exception:
                pass
        summary = "；".join(
            f"{item.get('strategy')}: {item.get('error') or item.get('warning') or 'invalid'}"
            for item in attempts
        )
        raise RuntimeError(f"AutoCAD plot 未获得有效图片：{summary}")

    if not trace_dir:
        try:
            for name in os.listdir(temp_dir):
                os.remove(os.path.join(temp_dir, name))
            os.rmdir(temp_dir)
        except Exception:
            pass

    result = selected["result"]
    attempt_summaries = [
        {key: value for key, value in item.items() if key != "result"}
        for item in attempts
    ]
    result["plot_attempts"] = attempt_summaries
    result["plot_strategy"] = selected.get("strategy")
    result["trace_dir"] = trace_dir
    if isinstance(result.get("metrics"), dict):
        result["metrics"]["plot_attempt_count"] = len(attempts)
        result["metrics"]["plot_valid_attempt_count"] = len(valid_attempts)
        if not trace_dir:
            result["metrics"]["pdf_path"] = None
            result["metrics"]["trace_pdf_path"] = None
    invalid_notes = [
        f"{item.get('strategy')}: {item.get('error') or item.get('warning')}"
        for item in attempts
        if not item.get("valid") and (item.get("error") or item.get("warning"))
    ]
    if warnings or invalid_notes or result.get("warning"):
        result["warning"] = "；".join(
            str(item)
            for item in [result.get("warning"), *warnings, *invalid_notes]
            if item
        )

    result["capture_method"] = "autocad-plot"
    result["variant"] = variant
    result["profile"] = profile
    result["fit_mode"] = fit_mode
    return result
