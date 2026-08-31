# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "Pillow==11.3.0",
#   "pypdfium2==5.12.1",
# ]
# ///

"""Rasterize one THCAD window-plot PDF page into a bounded PNG."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageOps
import pypdfium2


def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    rgb = image.convert("RGB")
    try:
        white = Image.new("RGB", rgb.size, (255, 255, 255))
        try:
            difference = ImageChops.difference(rgb, white).convert("L")
            try:
                mask = difference.point(lambda value: 255 if value > 18 else 0)
                try:
                    return mask.getbbox()
                finally:
                    mask.close()
            finally:
                difference.close()
        finally:
            white.close()
    finally:
        rgb.close()


def rasterize(source: Path, target: Path, width: int, height: int) -> dict[str, object]:
    document = pypdfium2.PdfDocument(str(source))
    try:
        if len(document) < 1:
            raise RuntimeError("PDF_HAS_NO_PAGES")
        page = document[0]
        try:
            page_width, page_height = page.get_size()
            scale = max(width / max(page_width, 1), height / max(page_height, 1)) * 1.35
            bitmap = page.render(scale=max(1.0, min(scale, 12.0)))
            try:
                raster = bitmap.to_pil().convert("RGB")
            finally:
                bitmap.close()
        finally:
            page.close()
    finally:
        document.close()

    try:
        bbox = content_bbox(raster)
        if bbox is None:
            raise RuntimeError("PDF_PAGE_HAS_NO_INK")
        margin_x = max(4, round((bbox[2] - bbox[0]) * 0.035))
        margin_y = max(4, round((bbox[3] - bbox[1]) * 0.035))
        expanded = (
            max(0, bbox[0] - margin_x),
            max(0, bbox[1] - margin_y),
            min(raster.width, bbox[2] + margin_x),
            min(raster.height, bbox[3] + margin_y),
        )
        cropped = raster.crop(expanded)
        try:
            fitted = ImageOps.contain(cropped, (width, height), method=Image.Resampling.LANCZOS)
            try:
                canvas = Image.new("RGB", (width, height), (255, 255, 255))
                try:
                    offset = ((width - fitted.width) // 2, (height - fitted.height) // 2)
                    canvas.paste(fitted, offset)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    canvas.save(target, format="PNG", optimize=True)
                finally:
                    canvas.close()
            finally:
                fitted.close()
        finally:
            cropped.close()
    finally:
        raster.close()

    payload = target.read_bytes()
    output = Image.open(target)
    try:
        sample = output.convert("RGB")
        try:
            sample.thumbnail((512, 512), Image.Resampling.BILINEAR)
            white = Image.new("RGB", sample.size, (255, 255, 255))
            try:
                difference = ImageChops.difference(sample, white).convert("L")
                try:
                    histogram = difference.histogram()
                    ink = sum(histogram[19:])
                    pixels = max(1, sample.width * sample.height)
                finally:
                    difference.close()
            finally:
                white.close()
        finally:
            sample.close()
    finally:
        output.close()
    return {
        "source_pdf_bytes": source.stat().st_size,
        "png_bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "width": width,
        "height": height,
        "ink_ratio": round(ink / pixels, 6),
        "content_bbox_before_fit": list(bbox),
        "rasterizer": "pypdfium2_window_plot_page_1",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    arguments = parser.parse_args()
    if not arguments.source.is_file():
        raise SystemExit("SOURCE_PDF_MISSING")
    if not 32 <= arguments.width <= 4096 or not 32 <= arguments.height <= 4096:
        raise SystemExit("INVALID_TARGET_DIMENSIONS")
    print(json.dumps(rasterize(
        arguments.source.resolve(),
        arguments.target.resolve(),
        arguments.width,
        arguments.height,
    ), ensure_ascii=False))


if __name__ == "__main__":
    main()
