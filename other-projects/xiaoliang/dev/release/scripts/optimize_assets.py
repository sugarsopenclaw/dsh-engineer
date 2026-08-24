"""Convert source artwork into web-sized WebP under src/assets/generated.

The landing page ships its imagery in the Vite bundle rather than proxying it
through OSS: the production bucket is private, so a static build cannot embed a
durable URL, and a redirect hop per image would be slower than letting nginx
serve hashed, long-cached files.

Sources are 1.5-2 MB PNGs; at the widths we actually render them, WebP brings
the whole page under a megabyte.

    python scripts/optimize_assets.py           # only rebuild stale outputs
    python scripts/optimize_assets.py --force
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

RELEASE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = RELEASE_ROOT.parents[1]
WEB_PUBLIC = REPO_ROOT / "my-projects" / "xiaoliangweb-main" / "xiaoliangweb-main" / "public"
OUT_DIR = RELEASE_ROOT / "src" / "assets" / "generated"


@dataclass(frozen=True)
class Asset:
    source: Path
    name: str
    max_width: int
    quality: int = 82
    # Marks carry uneven margins that stop a logo row from sharing one optical
    # height, so they get trimmed to their ink before anything else.
    trim: bool = False
    # BUCEA ships a white wordmark meant for a dark backdrop; on the light page
    # it has to be flipped to dark ink or it disappears.
    invert: bool = False
    # Logos sit on white and light grey panels, so they keep their alpha
    # instead of being baked onto one specific background colour.
    alpha: bool = False


ASSETS: tuple[Asset, ...] = (
    Asset(WEB_PUBLIC / "logo.png", "logo-xiaoliang", 480, 90, trim=True, alpha=True),
    Asset(WEB_PUBLIC / "quantity-agent.png", "agent-quantity", 960),
    # cost-agent.png in the source set is a corrupt stream; this HUD render
    # carries the cost/compliance panels and stands in for that capability.
    Asset(WEB_PUBLIC / "ai-hub-3d.png", "agent-cost", 960),
    Asset(WEB_PUBLIC / "review-agent.png", "agent-review", 960),
    Asset(WEB_PUBLIC / "construction-agent.png", "agent-construction", 960),
    Asset(WEB_PUBLIC / "baidu-qianfan-logo.png", "logo-qianfan", 420, 90, trim=True, alpha=True),
    Asset(
        WEB_PUBLIC / "bucea-logo.png",
        "logo-bucea",
        420,
        90,
        trim=True,
        invert=True,
        alpha=True,
    ),
)


def trim_margins(image: Image.Image) -> Image.Image:
    """Crop away a transparent or flat-white border."""
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        # Fully opaque source: fall back to differencing against white.
        rgb = image.convert("RGB")
        backdrop = Image.new("RGB", rgb.size, (255, 255, 255))
        bbox = ImageChops.difference(rgb, backdrop).getbbox()
    return image.crop(bbox) if bbox else image


def invert_ink(image: Image.Image) -> Image.Image:
    """Flip RGB while leaving the alpha mask untouched."""
    rgb = ImageOps.invert(image.convert("RGB"))
    return Image.merge("RGBA", (*rgb.split(), image.getchannel("A")))


def convert(asset: Asset, *, force: bool) -> tuple[int, int] | None:
    target = OUT_DIR / f"{asset.name}.webp"
    if not asset.source.exists():
        print(f"  !! missing source: {asset.source}")
        return None
    if (
        not force
        and target.exists()
        and target.stat().st_mtime >= asset.source.stat().st_mtime
    ):
        print(f"  -- {asset.name}.webp up to date")
        return None

    with Image.open(asset.source) as image:
        image.load()
        canvas = image.convert("RGBA")
        if asset.trim:
            canvas = trim_margins(canvas)
        if asset.invert:
            canvas = invert_ink(canvas)
        if canvas.width > asset.max_width:
            height = round(canvas.height * asset.max_width / canvas.width)
            canvas = canvas.resize((asset.max_width, height), Image.LANCZOS)
        if not asset.alpha:
            canvas = canvas.convert("RGB")
        canvas.save(target, "WEBP", quality=asset.quality, method=6)

    before = asset.source.stat().st_size
    after = target.stat().st_size
    print(
        f"  ok {asset.name}.webp  {before / 1024:>7.0f} KB -> {after / 1024:>6.0f} KB"
        f"  ({100 - after / before * 100:.0f}% smaller)"
    )
    return before, after


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="rebuild even if up to date")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"writing to {OUT_DIR.relative_to(RELEASE_ROOT)}")

    total_before = 0
    total_after = 0
    failures = 0
    for asset in ASSETS:
        result = convert(asset, force=args.force)
        if result is None:
            if not asset.source.exists():
                failures += 1
            continue
        total_before += result[0]
        total_after += result[1]

    if total_before:
        print(
            f"\ntotal {total_before / 1024:.0f} KB -> {total_after / 1024:.0f} KB"
            f" ({100 - total_after / total_before * 100:.0f}% smaller)"
        )

    expected = {f"{asset.name}.webp" for asset in ASSETS}
    for stale in sorted(OUT_DIR.glob("*.webp")):
        if stale.name not in expected:
            stale.unlink()
            print(f"  rm {stale.name} (no longer referenced)")

    bundled = sum(path.stat().st_size for path in OUT_DIR.glob("*.webp"))
    print(f"bundle image weight: {bundled / 1024:.0f} KB")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
