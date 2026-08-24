"""Win32 截取 AutoCAD 绘图区子窗口（类名含 AfxFrameOrView），输出 base64 PNG"""

import base64
import ctypes
import hashlib
import io
import os
from typing import Optional, Tuple

import win32gui
import win32ui
import win32con

try:
    from PIL import Image, ImageStat, ImageFilter, ImageGrab, ImageOps
except ImportError:
    Image = None  # type: ignore
    ImageStat = None  # type: ignore
    ImageFilter = None  # type: ignore
    ImageGrab = None  # type: ignore
    ImageOps = None  # type: ignore

# PrintWindow flag that asks Windows to render DirectComposition/GPU content
# into the supplied DC (helps capture some hardware-accelerated surfaces).
PW_RENDERFULLCONTENT = 0x00000002


def _enum_child_class_names(hwnd_parent):
    children = []

    def _cb(child_hwnd, _):
        try:
            cn = win32gui.GetClassName(child_hwnd)
            children.append((child_hwnd, cn))
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(hwnd_parent, _cb, None)
    except Exception:
        pass
    return children


def find_viewport_hwnd(acad_hwnd: int) -> int:
    """查找绘图区子窗口（类名含 AfxFrameOrView），取客户区面积最大者"""
    best = None
    best_area = -1
    for child_hwnd, class_name in _enum_child_class_names(acad_hwnd):
        if "AfxFrameOrView" not in class_name:
            continue
        try:
            left, top, right, bottom = win32gui.GetClientRect(child_hwnd)
            w = right - left
            h = bottom - top
            area = w * h
            if area > best_area:
                best_area = area
                best = child_hwnd
        except Exception:
            continue
    return best if best is not None else acad_hwnd


def _ink_ratio(gray) -> float:
    """绘图区"墨迹/边缘"占比：用边缘检测估计图纸线条/文字密度。

    空白绘图区（纯色画布）边缘极少 → 接近 0；
    含线条/文字/尺寸的有效图纸 → 明显大于 0。与背景明暗无关。
    """
    if ImageFilter is None:
        return 0.0
    try:
        edges = gray.filter(ImageFilter.FIND_EDGES)
        # FIND_EDGES 在最外 1px 环上无法求真实梯度、会留下等于原像素值的边框伪影，
        # 必须裁掉这一圈，否则纯色空白图也会被算出非零墨迹比。
        if edges.width > 4 and edges.height > 4:
            edges = edges.crop((1, 1, edges.width - 1, edges.height - 1))
        ehist = edges.histogram()
        total = max(1, int(edges.width) * int(edges.height))
        # 边缘幅度 >= 24 视为有效墨迹边缘，过滤压缩/抗锯齿噪声
        ink = sum(ehist[24:])
        return round(float(ink) / total, 6)
    except Exception:
        return 0.0


def _image_metrics(img) -> dict:
    if ImageStat is None:
        return {}
    gray = img.convert("L")
    stat = ImageStat.Stat(gray)
    histogram = gray.histogram()
    total = max(1, int(gray.width) * int(gray.height))
    black = histogram[0]
    white = histogram[255]
    near_black = sum(histogram[:16])
    near_white = sum(histogram[240:])
    return {
        "width": int(gray.width),
        "height": int(gray.height),
        "mean_brightness": round(float(stat.mean[0]), 4),
        "brightness_variance": round(float(stat.var[0]), 4),
        "black_ratio": round(float(black) / total, 6),
        "white_ratio": round(float(white) / total, 6),
        "near_black_ratio": round(float(near_black) / total, 6),
        "near_white_ratio": round(float(near_white) / total, 6),
        "ink_ratio": _ink_ratio(gray),
    }


def _encode_image_result(
    img,
    width: Optional[int] = None,
    height: Optional[int] = None,
    extra_metrics: Optional[dict] = None,
    fit_mode: str = "contain",
) -> dict:
    """把 PIL 图像统一编码为 {image_base64, format, metrics, image_hash, width, height}。"""
    if Image is None:
        raise RuntimeError("Pillow (PIL) is required for PNG screenshot output")
    source_width = int(img.width)
    source_height = int(img.height)
    fit_scale = 1.0
    output_content_width = source_width
    output_content_height = source_height
    padding_left = 0
    padding_top = 0
    padding_right = 0
    padding_bottom = 0
    normalized_fit_mode = str(fit_mode or "contain").lower()
    if width is not None and height is not None and (width != img.width or height != img.height):
        target_width = int(width)
        target_height = int(height)
        fit_scale = min(
            float(target_width) / max(1, float(img.width)),
            float(target_height) / max(1, float(img.height)),
        )
        output_content_width = max(1, int(round(float(img.width) * fit_scale)))
        output_content_height = max(1, int(round(float(img.height) * fit_scale)))
        resized = img.resize((output_content_width, output_content_height), Image.Resampling.LANCZOS)
        if normalized_fit_mode == "max":
            img = resized
        else:
            canvas = Image.new("RGB", (target_width, target_height), "white")
            padding_left = max(0, (target_width - output_content_width) // 2)
            padding_top = max(0, (target_height - output_content_height) // 2)
            canvas.paste(resized, (padding_left, padding_top))
            padding_right = max(0, target_width - output_content_width - padding_left)
            padding_bottom = max(0, target_height - output_content_height - padding_top)
            img = canvas
    metrics = _image_metrics(img)
    metrics.update({
        "source_width": source_width,
        "source_height": source_height,
        "resize_scale_x": round(fit_scale, 6),
        "resize_scale_y": round(fit_scale, 6),
        "upscale_ratio": round(max(1.0, fit_scale), 6),
        "fit_scale": round(fit_scale, 6),
        "output_content_width": int(output_content_width),
        "output_content_height": int(output_content_height),
        "padding_left": int(padding_left),
        "padding_top": int(padding_top),
        "padding_right": int(padding_right),
        "padding_bottom": int(padding_bottom),
        "aspect_preserved": 1,
        "fit_mode": normalized_fit_mode,
    })
    if extra_metrics:
        metrics.update(extra_metrics)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    payload = buf.getvalue()
    metrics["byte_length"] = len(payload)
    return {
        "image_base64": base64.b64encode(payload).decode("ascii"),
        "format": "png",
        "metrics": metrics,
        "image_hash": hashlib.sha256(payload).hexdigest(),
        "width": int(img.width),
        "height": int(img.height),
    }


def _to_mono_high_contrast(img):
    """把彩色 CAD plot 转成模型/OCR 友好的黑白高对比图。

    CAD 彩色出图里黄色、浅蓝文字在白底上对视觉模型很不友好。这里把非白像素
    统一压成黑色、白底保持白色，让文字/尺寸/线条优先可读。
    """
    if Image is None:
        return img
    gray = img.convert("L")
    if ImageOps is not None:
        try:
            gray = ImageOps.autocontrast(gray, cutoff=0.5)
        except Exception:
            pass
    # 黄色文字灰度通常在 220-235，阈值取高一点以保留浅色图元。
    bw = gray.point(lambda value: 255 if value >= 246 else 0, mode="1")
    return bw.convert("RGB")


def capture_hwnd_client_png(
    hwnd: int,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> dict:
    left, top, right, bottom = win32gui.GetClientRect(hwnd)
    w = right - left
    h = bottom - top
    if w <= 0 or h <= 0:
        raise RuntimeError("invalid client rect for capture")

    hwnd_dc = win32gui.GetWindowDC(hwnd)
    mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
    save_dc = mfc_dc.CreateCompatibleDC()
    save_bitmap = win32ui.CreateBitmap()
    save_bitmap.CreateCompatibleBitmap(mfc_dc, w, h)
    save_dc.SelectObject(save_bitmap)
    save_dc.BitBlt((0, 0), (w, h), mfc_dc, (0, 0), win32con.SRCCOPY)

    bmpinfo = save_bitmap.GetInfo()
    bmpstr = save_bitmap.GetBitmapBits(True)

    win32gui.DeleteObject(save_bitmap.GetHandle())
    save_dc.DeleteDC()
    mfc_dc.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwnd_dc)

    if Image is None:
        raise RuntimeError("Pillow (PIL) is required for PNG screenshot output")

    img = Image.frombuffer(
        "RGB",
        (bmpinfo["bmWidth"], bmpinfo["bmHeight"]),
        bmpstr,
        "raw",
        "BGRX",
        0,
        1,
    )
    return _encode_image_result(img, width=width, height=height)


def capture_hwnd_printwindow_png(
    hwnd: int,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> dict:
    """用 PrintWindow(PW_RENDERFULLCONTENT) 捕获窗口，尝试拿到 GPU 渲染内容。

    对部分 DirectX/DirectComposition 表面比裸 BitBlt 更有效，但对 AutoCAD
    绘图区通常仍不可靠，仅作诊断/兜底。"""
    left, top, right, bottom = win32gui.GetClientRect(hwnd)
    w = right - left
    h = bottom - top
    if w <= 0 or h <= 0:
        raise RuntimeError("invalid client rect for printwindow capture")

    hwnd_dc = win32gui.GetWindowDC(hwnd)
    mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
    save_dc = mfc_dc.CreateCompatibleDC()
    save_bitmap = win32ui.CreateBitmap()
    save_bitmap.CreateCompatibleBitmap(mfc_dc, w, h)
    save_dc.SelectObject(save_bitmap)
    ok = ctypes.windll.user32.PrintWindow(hwnd, save_dc.GetSafeHdc(), PW_RENDERFULLCONTENT)

    bmpinfo = save_bitmap.GetInfo()
    bmpstr = save_bitmap.GetBitmapBits(True)

    win32gui.DeleteObject(save_bitmap.GetHandle())
    save_dc.DeleteDC()
    mfc_dc.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwnd_dc)

    if not ok:
        raise RuntimeError("PrintWindow failed")
    if Image is None:
        raise RuntimeError("Pillow (PIL) is required for PNG screenshot output")

    img = Image.frombuffer(
        "RGB",
        (bmpinfo["bmWidth"], bmpinfo["bmHeight"]),
        bmpstr,
        "raw",
        "BGRX",
        0,
        1,
    )
    return _encode_image_result(img, width=width, height=height)


def capture_screen_region_png(
    bbox: Tuple[int, int, int, int],
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> dict:
    """通过 PIL ImageGrab 截取屏幕区域（经桌面合成器，能拿到 GPU 内容）。

    bbox = (left, top, right, bottom)，屏幕坐标。仅用于诊断对照；线上的屏幕
    裁剪兜底由 Electron desktopCapturer 完成。"""
    if ImageGrab is None or Image is None:
        raise RuntimeError("Pillow (PIL) ImageGrab is required for screen-region capture")
    left, top, right, bottom = (int(v) for v in bbox)
    if right - left <= 0 or bottom - top <= 0:
        raise RuntimeError(f"invalid screen bbox: {bbox}")
    img = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True).convert("RGB")
    return _encode_image_result(img, width=width, height=height)


def _autocrop_white_border(img, threshold: int = 250):
    """裁掉 Plot 出图四周的纯白边距，保留绘图内容。"""
    if Image is None:
        return img
    try:
        gray = img.convert("L")
        # 反相后非白（墨迹）区域 > 0，getbbox 求其外接框
        inverted = gray.point(lambda value: 0 if value >= threshold else 255)
        bbox = inverted.getbbox()
        if bbox:
            pad = 6
            left = max(0, bbox[0] - pad)
            top = max(0, bbox[1] - pad)
            right = min(img.width, bbox[2] + pad)
            bottom = min(img.height, bbox[3] + pad)
            if right - left > 16 and bottom - top > 16:
                return img.crop((left, top, right, bottom))
    except Exception:
        pass
    return img


def _non_white_bbox(img, threshold: int = 250):
    """返回非白内容 bbox；用于诊断 PDF 有效图面占比。"""
    if Image is None:
        return None
    try:
        gray = img.convert("L")
        inverted = gray.point(lambda value: 0 if value >= threshold else 255)
        return inverted.getbbox()
    except Exception:
        return None


def _safe_save_png(img, path: str) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path, format="PNG")
    except Exception:
        pass


def rasterize_pdf_to_png(
    pdf_path: str,
    dpi: int = 150,
    page_index: int = 0,
    autocrop: bool = True,
    width: Optional[int] = None,
    height: Optional[int] = None,
    variant: str = "color",
    fit_mode: str = "max",
    diagnostic_dir: Optional[str] = None,
    diagnostic_prefix: str = "region",
) -> dict:
    """用 pypdfium2 把 PDF 指定页栅格化为 PNG，返回标准图像结果字典。"""
    if Image is None:
        raise RuntimeError("Pillow (PIL) is required for PDF rasterization output")
    try:
        import pypdfium2 as pdfium  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency guard
        raise RuntimeError(
            "pypdfium2 is required for PDF rasterization. Please install pypdfium2."
        ) from exc

    scale = max(0.1, float(dpi) / 72.0)
    pdf = pdfium.PdfDocument(pdf_path)
    page_width_pt = None
    page_height_pt = None
    try:
        if len(pdf) <= page_index:
            raise RuntimeError(f"pdf has no page index {page_index}")
        page = pdf[page_index]
        try:
            size = page.get_size()
            page_width_pt = float(size[0])
            page_height_pt = float(size[1])
        except Exception:
            try:
                page_width_pt = float(page.get_width())
                page_height_pt = float(page.get_height())
            except Exception:
                pass
        bitmap = page.render(scale=scale)
        img = bitmap.to_pil().convert("RGB")
    finally:
        try:
            pdf.close()
        except Exception:
            pass
    raster_width = int(img.width)
    raster_height = int(img.height)
    content_bbox = _non_white_bbox(img)
    content_area_ratio = 0.0
    if content_bbox:
        content_area_ratio = round(
            ((content_bbox[2] - content_bbox[0]) * (content_bbox[3] - content_bbox[1])) /
            max(1, raster_width * raster_height),
            6,
        )
    if diagnostic_dir:
        _safe_save_png(img, os.path.join(diagnostic_dir, f"{diagnostic_prefix}.raster.png"))
    if autocrop:
        img = _autocrop_white_border(img)
    crop_width = int(img.width)
    crop_height = int(img.height)
    crop_area_ratio = round((crop_width * crop_height) / max(1, raster_width * raster_height), 6)
    if diagnostic_dir:
        _safe_save_png(img, os.path.join(diagnostic_dir, f"{diagnostic_prefix}.cropped.png"))
    extra_metrics = {
        "pdf_page_width_pt": page_width_pt,
        "pdf_page_height_pt": page_height_pt,
        "pdf_dpi": int(dpi),
        "pdf_path": pdf_path,
        "pdf_bytes": int(os.path.getsize(pdf_path)) if os.path.exists(pdf_path) else None,
        "raster_width": raster_width,
        "raster_height": raster_height,
        "content_area_ratio": content_area_ratio,
        "crop_width": crop_width,
        "crop_height": crop_height,
        "crop_area_ratio": crop_area_ratio,
        "fit_mode": str(fit_mode or "max").lower(),
    }
    if content_bbox:
        extra_metrics.update({
            "content_bbox_left": int(content_bbox[0]),
            "content_bbox_top": int(content_bbox[1]),
            "content_bbox_right": int(content_bbox[2]),
            "content_bbox_bottom": int(content_bbox[3]),
        })
    if diagnostic_dir:
        extra_metrics["diagnostic_dir"] = diagnostic_dir
    normalized_variant = str(variant or "color").lower()
    if normalized_variant == "mono":
        encoded = _encode_image_result(
            _to_mono_high_contrast(img),
            width=width,
            height=height,
            extra_metrics=extra_metrics,
            fit_mode=fit_mode,
        )
        if diagnostic_dir:
            try:
                decoded = Image.open(io.BytesIO(base64.b64decode(encoded["image_base64"]))).convert("RGB")
                _safe_save_png(decoded, os.path.join(diagnostic_dir, f"{diagnostic_prefix}.mono.final.png"))
            except Exception:
                pass
        return encoded
    if normalized_variant == "both":
        color = _encode_image_result(img, width=width, height=height, extra_metrics=extra_metrics, fit_mode=fit_mode)
        mono = _encode_image_result(
            _to_mono_high_contrast(img),
            width=width,
            height=height,
            extra_metrics=extra_metrics,
            fit_mode=fit_mode,
        )
        color["variants"] = {
            "color": dict(color),
            "mono": mono,
        }
        # Avoid recursively embedding variants in the color variant.
        color["variants"]["color"].pop("variants", None)
        if diagnostic_dir:
            try:
                decoded_color = Image.open(io.BytesIO(base64.b64decode(color["image_base64"]))).convert("RGB")
                decoded_mono = Image.open(io.BytesIO(base64.b64decode(mono["image_base64"]))).convert("RGB")
                _safe_save_png(decoded_color, os.path.join(diagnostic_dir, f"{diagnostic_prefix}.color.final.png"))
                _safe_save_png(decoded_mono, os.path.join(diagnostic_dir, f"{diagnostic_prefix}.mono.final.png"))
            except Exception:
                pass
        return color
    encoded = _encode_image_result(img, width=width, height=height, extra_metrics=extra_metrics, fit_mode=fit_mode)
    if diagnostic_dir:
        try:
            decoded = Image.open(io.BytesIO(base64.b64decode(encoded["image_base64"]))).convert("RGB")
            _safe_save_png(decoded, os.path.join(diagnostic_dir, f"{diagnostic_prefix}.color.final.png"))
        except Exception:
            pass
    return encoded


def capture_hwnd_client_png_b64(hwnd: int, width: Optional[int] = None, height: Optional[int] = None) -> str:
    return str(capture_hwnd_client_png(hwnd, width=width, height=height)["image_base64"])


def capture_cad_viewport_png(acad, width: Optional[int] = None, height: Optional[int] = None) -> dict:
    hwnd = int(acad.HWND)
    vp = find_viewport_hwnd(hwnd)
    result = capture_hwnd_client_png(vp, width=width, height=height)
    result["hwnd"] = vp
    return result


def capture_cad_viewport_b64(acad, width: Optional[int] = None, height: Optional[int] = None) -> str:
    return str(capture_cad_viewport_png(acad, width=width, height=height)["image_base64"])
