"""State-restoring AutoCAD window plotting with image quality gates.

Adapted from pi-engineering engineering/cad-bridge at
9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff (MIT).
"""

from __future__ import annotations

import math
import os
import struct
import tempfile
import zlib
from pathlib import Path

try:
    import pythoncom
    from win32com.client import VARIANT
except ModuleNotFoundError:
    pythoncom = None
    VARIANT = None

try:
    import pypdfium2
except ModuleNotFoundError:
    pypdfium2 = None

try:
    from PIL import Image, ImageChops
except ModuleNotFoundError:
    Image = None
    ImageChops = None

from xiaoliang_cad_bridge.domain.geometry import BBox, bbox_from_points
from xiaoliang_cad_bridge.errors import BridgeError, raise_if_call_rejected


AC_PLOT_TYPE_WINDOW = 4
AC_PLOT_SCALE_TO_FIT = 0
AC_WORLD = 0
AC_DISPLAY_DCS = 2
MIN_INK_RATIO = 0.0015
MAX_OUTPUT_PIXELS = 4096 * 4096
MAX_OUTPUT_EDGE = 4096
MAX_PDF_RASTER_PIXELS = MAX_OUTPUT_PIXELS * 2
PDF_RENDER_MARGIN = 1.03
PC3_CODEC_MARKER = b"pmzlibcodec"
PC3_VIEW_FILE_ENABLED = b'name="View_New_File\n  value=TRUE'
PC3_VIEW_FILE_DISABLED = b'name="View_New_File\n  value=FALSE'


def variant_point(values: tuple[float, ...]) -> object:
    if pythoncom is None or VARIANT is None:
        raise BridgeError("PYWIN32_UNAVAILABLE", "pywin32 is required for AutoCAD plotting", status_code=503)
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, values)


def safe_get(value: object, name: str) -> object:
    try:
        return getattr(value, name)
    except Exception as error:
        raise_if_call_rejected(error)
        return None


def safe_set(value: object, name: str, setting: object, warnings: list[str]) -> None:
    try:
        setattr(value, name, setting)
    except Exception as error:
        raise_if_call_rejected(error)
        warnings.append(f"could not set plot property {name}")


def push_dbmod_guard(document: object) -> int:
    try:
        original = int(document.GetVariable("DBMOD"))
        document.SendCommand("(acad-push-dbmod)\r")
        return original
    except Exception as error:
        raise_if_call_rejected(error)
        raise BridgeError(
            "DBMOD_GUARD_UNAVAILABLE",
            "AutoCAD could not protect the drawing modification state before plotting",
            status_code=422,
        ) from error


def pop_dbmod_guard(document: object, expected: int) -> None:
    try:
        document.SendCommand("(acad-pop-dbmod)\r")
        restored = int(document.GetVariable("DBMOD"))
    except Exception as error:
        raise_if_call_rejected(error)
        raise BridgeError(
            "VIEW_RESTORE_FAILED",
            "AutoCAD could not restore the drawing modification state after plotting",
            status_code=422,
        ) from error
    if restored != expected:
        raise BridgeError(
            "VIEW_RESTORE_FAILED",
            "AutoCAD did not restore the original drawing modification state after plotting",
            status_code=422,
            details={"expected_dbmod": expected, "actual_dbmod": restored},
        )


def resolve_generated_file(requested: Path, extension: str) -> Path | None:
    candidates = (requested, Path(f"{requested}{extension}"), requested.with_suffix(extension))
    return next(
        (candidate for candidate in candidates if candidate.exists() and candidate.stat().st_size > 0),
        None,
    )


def resolve_plot_config(acad: object, config_name: str) -> Path:
    try:
        configured_paths = str(acad.Preferences.Files.PrinterConfigPath)
    except Exception as error:
        raise_if_call_rejected(error)
        raise BridgeError(
            "PLOT_CONFIG_UNAVAILABLE",
            "AutoCAD printer configuration path is unavailable",
            status_code=422,
        ) from error
    for raw_path in configured_paths.split(";"):
        root = raw_path.strip().strip('"')
        if not root:
            continue
        candidate = Path(os.path.expandvars(root)) / config_name
        if candidate.is_file():
            return candidate
    raise BridgeError(
        "PLOT_CONFIG_UNAVAILABLE",
        f"AutoCAD plot configuration {config_name} was not found",
        status_code=422,
    )


def inspect_plot_environment(acad: object | None) -> dict[str, object]:
    """Inspect plot prerequisites without changing AutoCAD or drawing state."""
    dependencies = {
        "pywin32": pythoncom is not None and VARIANT is not None,
        "pillow": Image is not None and ImageChops is not None,
        "pdfium": pypdfium2 is not None,
    }
    configurations: dict[str, bool | None] = {"pdf": None, "png": None}
    warnings: list[str] = []
    if acad is None:
        warnings.append("AUTOCAD_NOT_RUNNING")
    else:
        for key, config_name in (
            ("pdf", "DWG To PDF.pc3"),
            ("png", "PublishToWeb PNG.pc3"),
        ):
            try:
                resolve_plot_config(acad, config_name)
                configurations[key] = True
            except BridgeError as error:
                configurations[key] = False
                warnings.append(error.code)
    pdf_ready = bool(
        dependencies["pillow"]
        and dependencies["pdfium"]
        and configurations["pdf"]
    )
    png_ready = bool(dependencies["pillow"] and configurations["png"])
    return {
        "ready": bool(acad is not None and dependencies["pywin32"] and (pdf_ready or png_ready)),
        "dependencies": dependencies,
        "configurations": configurations,
        "warnings": sorted(set(warnings)),
    }


def write_plot_config_without_viewer(source: Path, target: Path) -> None:
    encoded = source.read_bytes()
    marker_offset = encoded.find(PC3_CODEC_MARKER)
    metadata_offset = marker_offset + len(PC3_CODEC_MARKER)
    if marker_offset < 0 or metadata_offset + 12 > len(encoded):
        raise BridgeError("PLOT_CONFIG_UNSUPPORTED", "AutoCAD PDF plot configuration is invalid", status_code=422)
    checksum, raw_size, compressed_size = struct.unpack_from("<III", encoded, metadata_offset)
    compressed_offset = metadata_offset + 12
    compressed_end = compressed_offset + compressed_size
    if compressed_end > len(encoded):
        raise BridgeError("PLOT_CONFIG_UNSUPPORTED", "AutoCAD PDF plot configuration is truncated", status_code=422)
    compressed = encoded[compressed_offset:compressed_end]
    if zlib.adler32(compressed) & 0xFFFFFFFF != checksum:
        raise BridgeError("PLOT_CONFIG_UNSUPPORTED", "AutoCAD PDF plot configuration checksum failed", status_code=422)
    try:
        raw = zlib.decompress(compressed)
    except zlib.error as error:
        raise BridgeError(
            "PLOT_CONFIG_UNSUPPORTED",
            "AutoCAD PDF plot configuration could not be decoded",
            status_code=422,
        ) from error
    if len(raw) != raw_size:
        raise BridgeError("PLOT_CONFIG_UNSUPPORTED", "AutoCAD PDF plot configuration size is invalid", status_code=422)
    if PC3_VIEW_FILE_ENABLED in raw:
        raw = raw.replace(PC3_VIEW_FILE_ENABLED, PC3_VIEW_FILE_DISABLED, 1)
    elif PC3_VIEW_FILE_DISABLED not in raw:
        raise BridgeError(
            "PLOT_CONFIG_UNSUPPORTED",
            "AutoCAD PDF plot configuration has no viewer setting",
            status_code=422,
        )
    compressed = zlib.compress(raw, level=9)
    metadata = struct.pack(
        "<III",
        zlib.adler32(compressed) & 0xFFFFFFFF,
        len(raw),
        len(compressed),
    )
    target.write_bytes(encoded[:metadata_offset] + metadata + compressed + encoded[compressed_end:])


def pixel_dimensions(aspect_ratio: float, max_pixels: int = MAX_OUTPUT_PIXELS) -> tuple[int, int]:
    if not math.isfinite(aspect_ratio) or aspect_ratio <= 0:
        raise ValueError("aspect_ratio must be a positive finite number")
    if max_pixels < 1:
        raise ValueError("max_pixels must be positive")
    width = max(1, math.floor(math.sqrt(max_pixels * aspect_ratio)))
    height = max(1, math.floor(math.sqrt(max_pixels / aspect_ratio)))
    if width > MAX_OUTPUT_EDGE:
        height = max(1, round(height * MAX_OUTPUT_EDGE / width))
        width = MAX_OUTPUT_EDGE
    if height > MAX_OUTPUT_EDGE:
        width = max(1, round(width * MAX_OUTPUT_EDGE / height))
        height = MAX_OUTPUT_EDGE
    if width * height > max_pixels:
        if width >= height:
            width = max(1, max_pixels // height)
        else:
            height = max(1, max_pixels // width)
    return width, height


def content_bbox(image: object) -> tuple[int, int, int, int] | None:
    if Image is None or ImageChops is None:
        raise BridgeError("PILLOW_UNAVAILABLE", "Pillow is required for plot validation", status_code=503)
    background = Image.new("RGB", image.size, "white")
    try:
        difference = ImageChops.difference(image, background).convert("L")
        try:
            mask = difference.point(lambda value: 255 if value > 10 else 0)
            try:
                return mask.getbbox()
            finally:
                mask.close()
        finally:
            difference.close()
    finally:
        background.close()


def crop_and_measure(source: Path, target: Path, max_pixels: int = MAX_OUTPUT_PIXELS) -> dict[str, object]:
    if Image is None or ImageChops is None:
        raise BridgeError("PILLOW_UNAVAILABLE", "Pillow is required for plot validation", status_code=503)
    with Image.open(source) as opened:
        image = opened.convert("RGB")
        try:
            detected_bbox = content_bbox(image)
            if detected_bbox is None:
                raise BridgeError("PLOT_EMPTY", "AutoCAD plot contains no visible ink", status_code=422)
            left, top, right, bottom = detected_bbox
            padding = max(4, round(max(image.size) * 0.005))
            crop_box = (
                max(0, left - padding),
                max(0, top - padding),
                min(image.width, right + padding),
                min(image.height, bottom + padding),
            )
            cropped = image.crop(crop_box)
            try:
                grayscale = cropped.convert("L")
                try:
                    histogram = grayscale.histogram()
                finally:
                    grayscale.close()
                ink_pixels = sum(histogram[:245])
                total_pixels = cropped.width * cropped.height
                ink_ratio = ink_pixels / total_pixels if total_pixels else 0.0
                if ink_ratio < MIN_INK_RATIO:
                    raise BridgeError(
                        "PLOT_EMPTY",
                        "AutoCAD plot did not meet the minimum ink ratio",
                        status_code=422,
                        details={"ink_ratio": round(ink_ratio, 6), "minimum": MIN_INK_RATIO},
                    )
                output_width, output_height = pixel_dimensions(cropped.width / cropped.height, max_pixels)
                target.parent.mkdir(parents=True, exist_ok=True)
                if cropped.size == (output_width, output_height):
                    cropped.save(target, format="PNG", optimize=True)
                else:
                    resized = cropped.resize((output_width, output_height), Image.Resampling.LANCZOS)
                    try:
                        resized.save(target, format="PNG", optimize=True)
                    finally:
                        resized.close()
                return {
                    "width": output_width,
                    "height": output_height,
                    "pixel_count": output_width * output_height,
                    "ink_ratio": round(ink_ratio, 6),
                    "crop_box": list(crop_box),
                }
            finally:
                cropped.close()
        finally:
            image.close()


def rasterize_pdf(source: Path, target: Path, target_dimensions: tuple[int, int]) -> None:
    if pypdfium2 is None:
        raise BridgeError("PDFIUM_UNAVAILABLE", "pypdfium2 is required for PDF plotting", status_code=503)
    document = pypdfium2.PdfDocument(str(source))
    try:
        if len(document) == 0:
            raise BridgeError("PLOT_EMPTY", "AutoCAD PDF plot has no pages", status_code=422)
        page = document[0]
        try:
            preview_bitmap = page.render(scale=1)
            try:
                preview = preview_bitmap.to_pil().convert("RGB")
                try:
                    preview_width, preview_height = preview.size
                    preview_bbox = content_bbox(preview)
                    if preview_bbox is None:
                        raise BridgeError("PLOT_EMPTY", "AutoCAD PDF plot contains no visible ink", status_code=422)
                    content_width = max(1, preview_bbox[2] - preview_bbox[0])
                    content_height = max(1, preview_bbox[3] - preview_bbox[1])
                finally:
                    preview.close()
            finally:
                preview_bitmap.close()
            target_width, target_height = target_dimensions
            requested_scale = PDF_RENDER_MARGIN * max(target_width / content_width, target_height / content_height)
            maximum_scale = math.sqrt(MAX_PDF_RASTER_PIXELS / (preview_width * preview_height))
            scale = min(requested_scale, maximum_scale)
            bitmap = page.render(scale=max(1.0, scale))
            try:
                bitmap.to_pil().save(target, format="PNG")
            finally:
                bitmap.close()
        finally:
            page.close()
    finally:
        document.close()


def layout_state(layout: object) -> dict[str, object]:
    return {
        name: safe_get(layout, name)
        for name in (
            "PlotType",
            "UseStandardScale",
            "StandardScale",
            "CenterPlot",
            "PlotRotation",
            "PlotWithLineweights",
            "PlotWithPlotStyles",
            "ConfigName",
            "StyleSheet",
            "CanonicalMediaName",
        )
    }


def configure_layout(layout: object, config_name: str, warnings: list[str]) -> None:
    try:
        layout.RefreshPlotDeviceInfo()
    except Exception as error:
        raise_if_call_rejected(error)
        warnings.append("could not refresh available plot devices")
    safe_set(layout, "ConfigName", config_name, warnings)
    try:
        layout.RefreshPlotDeviceInfo()
    except Exception as error:
        raise_if_call_rejected(error)
        warnings.append(f"could not refresh plot device {config_name}")
    safe_set(layout, "PlotType", AC_PLOT_TYPE_WINDOW, warnings)
    safe_set(layout, "UseStandardScale", True, warnings)
    safe_set(layout, "StandardScale", AC_PLOT_SCALE_TO_FIT, warnings)
    safe_set(layout, "CenterPlot", True, warnings)
    safe_set(layout, "PlotRotation", 0, warnings)
    safe_set(layout, "PlotWithLineweights", True, warnings)
    safe_set(layout, "PlotWithPlotStyles", True, warnings)
    safe_set(layout, "StyleSheet", "acad.ctb", warnings)


def display_bbox(document: object, bbox: BBox) -> BBox:
    min_x, min_y = bbox["min"]
    max_x, max_y = bbox["max"]
    corners = (
        (min_x, min_y, 0.0),
        (min_x, max_y, 0.0),
        (max_x, min_y, 0.0),
        (max_x, max_y, 0.0),
    )
    try:
        translated = [
            document.Utility.TranslateCoordinates(variant_point(corner), AC_WORLD, AC_DISPLAY_DCS, False)
            for corner in corners
        ]
    except Exception as error:
        raise_if_call_rejected(error)
        raise BridgeError(
            "PLOT_COORDINATE_TRANSFORM_FAILED",
            "AutoCAD could not transform the WCS plot window into display coordinates",
            status_code=422,
        ) from error
    normalized = bbox_from_points(translated)
    if normalized is None:
        raise BridgeError(
            "PLOT_COORDINATE_TRANSFORM_FAILED",
            "AutoCAD returned an invalid display-coordinate plot window",
            status_code=422,
        )
    return normalized


def plot_window(acad: object, document: object, bbox: BBox, output_path: Path) -> dict[str, object]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    layout = document.ActiveLayout
    original_layout = layout_state(layout)
    original_layout_name = str(safe_get(layout, "Name") or "")
    original_document_name = str(safe_get(document, "Name") or "")
    original_variables: dict[str, object] = {}
    for name in ("TILEMODE", "BACKGROUNDPLOT", "VIEWCTR", "VIEWSIZE"):
        try:
            original_variables[name] = document.GetVariable(name)
        except Exception as error:
            raise_if_call_rejected(error)
            original_variables[name] = None
    attempts: list[str] = []
    temporary_plot_configs: list[Path] = []
    selected: dict[str, object] | None = None
    original_dbmod = push_dbmod_guard(document)
    dbmod_guard_active = True
    try:
        try:
            document.SetVariable("TILEMODE", 1)
        except Exception as error:
            raise_if_call_rejected(error)
            warnings.append("could not force model-space plotting")
        layout = document.ActiveLayout
        original_layout = layout_state(layout)
        plot_bbox = display_bbox(document, bbox)
        plot_width = plot_bbox["max"][0] - plot_bbox["min"][0]
        plot_height = plot_bbox["max"][1] - plot_bbox["min"][1]
        if plot_width <= 0 or plot_height <= 0:
            raise BridgeError("INVALID_BBOX", "Plot bbox must have positive width and height", status_code=422)
        target_dimensions = pixel_dimensions(plot_width / plot_height)
        minimum = variant_point((plot_bbox["min"][0], plot_bbox["min"][1]))
        maximum = variant_point((plot_bbox["max"][0], plot_bbox["max"][1]))
        try:
            document.SetVariable("BACKGROUNDPLOT", 0)
        except Exception as error:
            raise_if_call_rejected(error)
            warnings.append("could not force foreground plotting")
        with tempfile.TemporaryDirectory(prefix="xiaoliang-cad-plot-", ignore_cleanup_errors=True) as temporary_name:
            temporary = Path(temporary_name)
            for strategy, config_name, extension in (
                ("pdf", "DWG To PDF.pc3", ".pdf"),
                ("png", "PublishToWeb PNG.pc3", ".png"),
            ):
                attempts.append(strategy)
                requested = temporary / f"window{extension}"
                raster = requested if strategy == "png" else temporary / "window-raster.png"
                validated_handle, validated_name = tempfile.mkstemp(
                    prefix=f".{output_path.stem}-{strategy}-",
                    suffix=".png",
                    dir=output_path.parent,
                )
                os.close(validated_handle)
                validated = Path(validated_name)
                attempt_warnings: list[str] = []
                try:
                    effective_config_name = config_name
                    if strategy == "pdf":
                        source_config = resolve_plot_config(acad, config_name)
                        config_handle, config_path = tempfile.mkstemp(
                            prefix="xiaoliang-silent-",
                            suffix=".pc3",
                            dir=source_config.parent,
                        )
                        os.close(config_handle)
                        silent_config = Path(config_path)
                        temporary_plot_configs.append(silent_config)
                        write_plot_config_without_viewer(source_config, silent_config)
                        effective_config_name = silent_config.name
                    configure_layout(layout, effective_config_name, attempt_warnings)
                    active_config_name = str(safe_get(layout, "ConfigName") or "")
                    if strategy == "pdf" and active_config_name.casefold() != effective_config_name.casefold():
                        raise BridgeError(
                            "PLOT_CONFIG_UNAVAILABLE",
                            "AutoCAD did not activate the silent PDF plot configuration",
                            status_code=422,
                        )
                    layout.SetWindowToPlot(minimum, maximum)
                    layout.PlotType = AC_PLOT_TYPE_WINDOW
                    result = document.Plot.PlotToFile(str(requested))
                    generated = resolve_generated_file(requested, extension)
                    if result is False or generated is None:
                        raise BridgeError("PLOT_EMPTY", f"{config_name} did not generate an output file", status_code=422)
                    if strategy == "pdf":
                        if generated.stat().st_size < 2_048:
                            raise BridgeError("PLOT_EMPTY", "AutoCAD PDF plot is too small", status_code=422)
                        rasterize_pdf(generated, raster, target_dimensions)
                    metrics = crop_and_measure(raster, validated)
                    os.replace(validated, output_path)
                    selected = {"strategy": strategy, **metrics}
                    warnings.extend(attempt_warnings)
                    break
                except BridgeError as error:
                    warnings.extend(attempt_warnings)
                    warnings.append(f"{strategy} plot attempt failed: {error.code}")
                except Exception as error:
                    raise_if_call_rejected(error)
                    warnings.extend(attempt_warnings)
                    warnings.append(f"{strategy} plot attempt failed: {type(error).__name__}")
                finally:
                    try:
                        validated.unlink(missing_ok=True)
                    except OSError:
                        pass
    finally:
        restore_failures: list[str] = []
        try:
            active = acad.ActiveDocument
            if str(safe_get(active, "Name") or "") != original_document_name:
                try:
                    document.Activate()
                    active = acad.ActiveDocument
                except Exception:
                    restore_failures.append("active document")
            if str(safe_get(active, "Name") or "") == original_document_name:
                for name in (
                    "ConfigName",
                    "CanonicalMediaName",
                    "PlotType",
                    "UseStandardScale",
                    "StandardScale",
                    "CenterPlot",
                    "PlotRotation",
                    "PlotWithLineweights",
                    "PlotWithPlotStyles",
                    "StyleSheet",
                ):
                    value = original_layout.get(name)
                    if value is not None:
                        try:
                            setattr(layout, name, value)
                            if name == "ConfigName":
                                layout.RefreshPlotDeviceInfo()
                        except Exception:
                            restore_failures.append(f"layout.{name}")
                background_plot = original_variables.get("BACKGROUNDPLOT")
                if background_plot is not None:
                    try:
                        document.SetVariable("BACKGROUNDPLOT", background_plot)
                    except Exception:
                        restore_failures.append("BACKGROUNDPLOT")
                tile_mode = original_variables.get("TILEMODE")
                if tile_mode is not None:
                    try:
                        document.SetVariable("TILEMODE", tile_mode)
                    except Exception:
                        restore_failures.append("TILEMODE")
                if tile_mode == 0 and original_layout_name:
                    try:
                        document.ActiveLayout = document.Layouts.Item(original_layout_name)
                    except Exception:
                        restore_failures.append("active layout")
                view_center = original_variables.get("VIEWCTR")
                view_size = original_variables.get("VIEWSIZE")
                if view_center is not None and view_size is not None:
                    try:
                        center = tuple(float(value) for value in list(view_center)[:2]) + (0.0,)
                        acad.ZoomCenter(variant_point(center), float(view_size))
                    except Exception:
                        restore_failures.append("view")
            else:
                restore_failures.append("active document changed; remaining restore skipped")
        except Exception:
            restore_failures.append("active document")
        for temporary_config in temporary_plot_configs:
            try:
                temporary_config.unlink(missing_ok=True)
            except OSError:
                restore_failures.append("temporary plot configuration")
        if dbmod_guard_active:
            try:
                pop_dbmod_guard(document, original_dbmod)
                dbmod_guard_active = False
            except BridgeError:
                restore_failures.append("DBMOD")
        if restore_failures:
            warnings.append(f"VIEW_RESTORE_FAILED: {', '.join(restore_failures)}")
    if selected is None:
        raise BridgeError(
            "PLOT_EMPTY",
            "AutoCAD PDF and PNG plot attempts failed quality validation",
            status_code=422,
            details={"attempts": attempts, "warnings": warnings},
        )
    return {**selected, "warnings": warnings}
