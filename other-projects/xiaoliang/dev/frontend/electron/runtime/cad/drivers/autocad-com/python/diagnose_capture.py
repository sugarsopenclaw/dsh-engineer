"""CAD 坐标出图链路诊断脚本（一次性，去风险用）。

对当前连接的 AutoCAD 文档，针对一个已知有实体的 CAD 坐标窗口，依次跑 4 种捕获
方式并落盘 PNG + 指标，同时回读 zoom 前后的 VIEWCTR/VIEWSIZE，用于人工对比：

  1. gdi-bitblt      现有主路径（GDI BitBlt 绘图区子窗口）——预期空白
  2. printwindow     PrintWindow(PW_RENDERFULLCONTENT)——尝试拿 GPU 内容
  3. screen-crop     PIL ImageGrab 屏幕区域裁剪（经桌面合成器）——预期有内容
  4. plot-pdf        Plot acWindow -> PDF -> pypdfium2 栅格化——预期最清晰、确定性强

用法（在装有 AutoCAD 且已打开目标 DWG 的机器上）：

  python diagnose_capture.py --min 0,0 --max 100000,100000 --out ./_diag --dpi 150

不带 --min/--max 时，默认对图纸 extents 的中心 1/2 区域取窗。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

THIS_DIR = Path(__file__).resolve().parent
BRIDGE_DIR = THIS_DIR / "billnova_bridge"
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

import win32gui  # type: ignore  # noqa: E402

import cad_bridge  # type: ignore  # noqa: E402
from helpers import screenshot as shot  # type: ignore  # noqa: E402
from modules import view as view_mod  # type: ignore  # noqa: E402


def _parse_xy(text: Optional[str]) -> Optional[Tuple[float, float]]:
    if not text:
        return None
    parts = [p.strip() for p in text.replace(";", ",").split(",") if p.strip()]
    if len(parts) < 2:
        raise ValueError(f"invalid point: {text!r}")
    return float(parts[0]), float(parts[1])


def _extents(doc) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    emin = doc.GetVariable("EXTMIN")
    emax = doc.GetVariable("EXTMAX")
    return (float(emin[0]), float(emin[1])), (float(emax[0]), float(emax[1]))


def _default_window(doc) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    (x0, y0), (x1, y1) = _extents(doc)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    half_w = max(1.0, (x1 - x0) / 4.0)
    half_h = max(1.0, (y1 - y0) / 4.0)
    return (cx - half_w, cy - half_h), (cx + half_w, cy + half_h)


def _read_view(doc) -> Dict[str, Any]:
    try:
        vc = doc.GetVariable("VIEWCTR")
        vs = doc.GetVariable("VIEWSIZE")
        return {
            "view_center": [round(float(vc[0]), 3), round(float(vc[1]), 3)],
            "view_size": round(float(vs), 4),
        }
    except Exception as exc:
        return {"error": str(exc)}


def _viewport_screen_bbox(acad) -> Tuple[int, int, int, int]:
    hwnd = int(acad.HWND)
    vp = shot.find_viewport_hwnd(hwnd)
    left, top, right, bottom = win32gui.GetClientRect(vp)
    sl, st = win32gui.ClientToScreen(vp, (left, top))
    sr, sb = win32gui.ClientToScreen(vp, (right, bottom))
    return sl, st, sr, sb


AC_PLOT_TYPE_DISPLAY = 0
AC_PLOT_TYPE_EXTENTS = 1
AC_PLOT_TYPE_WINDOW = 4


def _read_plot_settings(layout) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for attr in (
        "PlotType",
        "UseStandardScale",
        "StandardScale",
        "CenterPlot",
        "ConfigName",
        "CanonicalMediaName",
        "PlotRotation",
        "PlotWithLineweights",
        "StyleSheet",
    ):
        try:
            out[attr] = getattr(layout, attr)
        except Exception as exc:
            out[attr] = f"<err: {exc}>"
    return out


def _configure_and_plot(
    acad,
    doc,
    mn: Tuple[float, float],
    mx: Tuple[float, float],
    plot_type: int,
    pdf_path: str,
    config_name: str = "DWG To PDF.pc3",
) -> Dict[str, Any]:
    """配置并出图到指定 PDF，回读关键打印设置，返回诊断字典。"""
    info: Dict[str, Any] = {"plot_type": plot_type, "pdf_path": pdf_path}
    ms_warnings = view_mod._ensure_model_space(doc)
    info["ensure_model_space"] = ms_warnings
    try:
        info["tilemode"] = int(doc.GetVariable("TILEMODE"))
    except Exception as exc:
        info["tilemode"] = f"<err: {exc}>"

    layout = doc.ActiveLayout
    try:
        info["active_layout"] = str(layout.Name)
    except Exception:
        info["active_layout"] = "<unknown>"

    try:
        if plot_type == AC_PLOT_TYPE_WINDOW:
            ll = view_mod._pt2(min(mn[0], mx[0]), min(mn[1], mx[1]))
            ur = view_mod._pt2(max(mn[0], mx[0]), max(mn[1], mx[1]))
            layout.SetWindowToPlot(ll, ur)
            # 回读 AutoCAD 实际存入的窗口，确认 SetWindowToPlot 是否生效
            try:
                got = layout.GetWindowToPlot()
                if isinstance(got, (tuple, list)) and len(got) >= 2:
                    info["window_readback"] = {
                        "lower_left": list(got[0]),
                        "upper_right": list(got[1]),
                    }
                else:
                    info["window_readback"] = repr(got)
            except Exception as exc:
                info["window_readback_error"] = str(exc)
        layout.PlotType = plot_type
        layout.UseStandardScale = True
        layout.StandardScale = 0  # acScaleToFit
        layout.CenterPlot = True
        try:
            layout.PlotRotation = 0
        except Exception:
            pass
        try:
            layout.ConfigName = config_name
        except Exception as exc:
            info["config_name_error"] = str(exc)
    except Exception as exc:
        info["configure_error"] = str(exc)

    info["readback"] = _read_plot_settings(layout)

    try:
        doc.SetVariable("BACKGROUNDPLOT", 0)
    except Exception:
        pass

    try:
        ok = doc.Plot.PlotToFile(pdf_path)
        info["plot_to_file_return"] = bool(ok) if ok is not None else None
    except Exception as exc:
        info["plot_to_file_error"] = str(exc)
        return info

    if os.path.exists(pdf_path):
        info["pdf_bytes"] = os.path.getsize(pdf_path)
        try:
            res = shot.rasterize_pdf_to_png(pdf_path, dpi=150, width=1600, height=1050)
            info["raster_metrics"] = {
                k: res["metrics"].get(k)
                for k in ("mean_brightness", "ink_ratio", "near_white_ratio", "byte_length")
            }
            png_path = str(Path(pdf_path).with_suffix(".png"))
            import base64 as _b64
            Path(png_path).write_bytes(_b64.b64decode(res["image_base64"]))
            info["raster_png"] = png_path
        except Exception as exc:
            info["raster_error"] = str(exc)
    else:
        info["pdf_bytes"] = 0
        info["pdf_missing"] = True
    return info


def _plot_debug(acad, doc, mn, mx, out_dir: Path) -> Dict[str, Any]:
    """对比 acWindow 与 acExtents 两种出图，定位 Plot 空白根因。"""
    debug: Dict[str, Any] = {}
    print("[plot-debug] === acWindow ===")
    win = _configure_and_plot(
        acad, doc, mn, mx, AC_PLOT_TYPE_WINDOW, str(out_dir / "plot_window.pdf")
    )
    print(f"[plot-debug] acWindow: readback={win.get('readback')}")
    print(f"[plot-debug] acWindow: pdf_bytes={win.get('pdf_bytes')} raster={win.get('raster_metrics')}")
    debug["acWindow"] = win

    print(f"[plot-debug] acWindow: window_readback={win.get('window_readback') or win.get('window_readback_error')}")

    print("[plot-debug] === acExtents (sanity: 整个模型能否出图) ===")
    ext = _configure_and_plot(
        acad, doc, mn, mx, AC_PLOT_TYPE_EXTENTS, str(out_dir / "plot_extents.pdf")
    )
    print(f"[plot-debug] acExtents: pdf_bytes={ext.get('pdf_bytes')} raster={ext.get('raster_metrics')}")
    debug["acExtents"] = ext

    print("[plot-debug] === acDisplay after zoomWindow (候选替代法) ===")
    try:
        view_mod.rpc_view_zoom_window(acad, {"min": list(mn), "max": list(mx)})
        time.sleep(0.3)
    except Exception as exc:
        print(f"[plot-debug] zoom before display failed: {exc}")
    disp = _configure_and_plot(
        acad, doc, mn, mx, AC_PLOT_TYPE_DISPLAY, str(out_dir / "plot_display.pdf")
    )
    print(f"[plot-debug] acDisplay: pdf_bytes={disp.get('pdf_bytes')} raster={disp.get('raster_metrics')}")
    debug["acDisplay"] = disp
    return debug


def _save(result: Dict[str, Any], out_dir: Path, name: str) -> Dict[str, Any]:
    import base64

    b64 = result.get("image_base64")
    saved_path = None
    if b64:
        png_path = out_dir / f"{name}.png"
        png_path.write_bytes(base64.b64decode(b64))
        saved_path = str(png_path)
    summary = {
        "method": name,
        "saved_png": saved_path,
        "image_hash": result.get("image_hash"),
        "width": result.get("width"),
        "height": result.get("height"),
        "metrics": result.get("metrics"),
        "warning": result.get("warning"),
    }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="CAD capture diagnostics")
    parser.add_argument("--min", dest="min_pt", default=None, help="window min 'x,y'")
    parser.add_argument("--max", dest="max_pt", default=None, help="window max 'x,y'")
    parser.add_argument("--out", dest="out", default="./_cad_capture_diag")
    parser.add_argument("--dpi", dest="dpi", type=int, default=150)
    parser.add_argument("--width", dest="width", type=int, default=1600)
    parser.add_argument("--height", dest="height", type=int, default=1050)
    args = parser.parse_args()

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    cad_bridge.com_initialize()
    acad = cad_bridge.get_application()
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active AutoCAD document")

    mn = _parse_xy(args.min_pt)
    mx = _parse_xy(args.max_pt)
    if mn is None or mx is None:
        mn, mx = _default_window(doc)

    report: Dict[str, Any] = {
        "doc_name": str(getattr(doc, "Name", "")),
        "window": {"min": list(mn), "max": list(mx)},
        "dpi": args.dpi,
        "view_before_zoom": _read_view(doc),
        "methods": [],
    }
    print(f"[diag] doc={report['doc_name']} window min={mn} max={mx}")
    print(f"[diag] view before zoom: {report['view_before_zoom']}")

    # 先 zoom 到窗口（GDI/PrintWindow/screen-crop 都依赖当前视口）
    try:
        view_mod.rpc_view_zoom_window(acad, {"min": list(mn), "max": list(mx)})
        time.sleep(0.4)
    except Exception as exc:
        report["zoom_error"] = str(exc)
        print(f"[diag] zoom_window failed: {exc}")
    report["view_after_zoom"] = _read_view(doc)
    print(f"[diag] view after zoom: {report['view_after_zoom']}")

    methods: List[Tuple[str, Any]] = [
        ("gdi-bitblt", lambda: shot.capture_cad_viewport_png(acad, width=args.width, height=args.height)),
        (
            "printwindow",
            lambda: shot.capture_hwnd_printwindow_png(
                shot.find_viewport_hwnd(int(acad.HWND)), width=args.width, height=args.height
            ),
        ),
        (
            "screen-crop",
            lambda: shot.capture_screen_region_png(
                _viewport_screen_bbox(acad), width=args.width, height=args.height
            ),
        ),
        (
            "plot-pdf",
            lambda: view_mod.rpc_view_plot_region(
                acad,
                {"min": list(mn), "max": list(mx), "dpi": args.dpi, "width": args.width, "height": args.height},
            ),
        ),
    ]

    for name, fn in methods:
        try:
            result = fn()
            summary = _save(result, out_dir, name)
            print(f"[diag] {name}: ok hash={summary['image_hash']} metrics={summary['metrics']}")
        except Exception as exc:
            summary = {"method": name, "error": str(exc)}
            print(f"[diag] {name}: FAILED {exc}")
        report["methods"].append(summary)

    # hash 去重检测：不同方法之间、与"应当随窗口变化"的判断
    hashes = {m["method"]: m.get("image_hash") for m in report["methods"] if m.get("image_hash")}
    report["distinct_hashes"] = len(set(hashes.values()))
    report["hash_by_method"] = hashes

    # Plot 空白根因诊断：回读打印设置 + 对比 acWindow / acExtents
    try:
        report["plot_debug"] = _plot_debug(acad, doc, mn, mx, out_dir)
    except Exception as exc:
        report["plot_debug_error"] = str(exc)
        print(f"[plot-debug] FAILED {exc}")

    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[diag] report saved: {report_path}")
    print(f"[diag] distinct hashes across methods: {report['distinct_hashes']}")


if __name__ == "__main__":
    main()
