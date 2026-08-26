"""Coverage checker: inventory ids vs field analysis documents."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .inventory import field_filename
from .paths import FIELD_MD_DIR

VERDICTS = (
    "判定：单独可用",
    "判定：仅与其他字段组合可用",
    "判定：目前不能支撑工程结论",
)


def check_docs(inventory_ids: list[str], doc_dir: Path | None = None) -> dict:
    md_dir = doc_dir or FIELD_MD_DIR
    if not md_dir.is_dir():
        return {
            "ok": False,
            "missing": list(inventory_ids),
            "extra": [],
            "empty": [],
            "bad": [f"doc dir missing: {md_dir}"],
            "counts": {
                "inventory": len(inventory_ids),
                "docs": 0,
                "missing": len(inventory_ids),
                "extra": 0,
                "empty": 0,
                "bad": 1,
            },
        }

    expected = {fid: field_filename(fid) for fid in inventory_ids}
    on_disk = {p.name: p for p in md_dir.glob("*.md") if p.name != "README.md"}

    missing = [fid for fid, fn in expected.items() if fn not in on_disk]
    extra = sorted(name for name in on_disk if name not in expected.values())
    empty = []
    bad = []

    for fid, fn in expected.items():
        path = on_disk.get(fn)
        if path is None:
            continue
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            empty.append(fid)
            continue
        problems = []
        verbatim = fid.split(".")[-1]
        # Chinese tags and app names must appear verbatim.
        if verbatim not in text and fid not in text:
            problems.append("verbatim name missing")
        if "实测观察" not in text:
            problems.append("no 实测观察")
        if not any(v in text for v in VERDICTS):
            problems.append("no verdict")
        # Must cite real extract: a drawing folder, or explicit absence/empty.
        has_obs = (
            "5TBC." in text
            or "8TBC." in text
            or "key absent" in text
            or "键不在" in text
            or "空文件" in text
            or "七张图" in text
            or "本抽取" in text
            or "out-thcad" in text
        )
        if not has_obs:
            problems.append("no out-thcad observation")
        if problems:
            bad.append(f"{fid}: {', '.join(problems)}")

    ok = not missing and not extra and not empty and not bad
    return {
        "ok": ok,
        "missing": missing,
        "extra": extra,
        "empty": empty,
        "bad": bad,
        "counts": {
            "inventory": len(inventory_ids),
            "docs": len(on_disk),
            "missing": len(missing),
            "extra": len(extra),
            "empty": len(empty),
            "bad": len(bad),
        },
    }


def format_report(result: dict) -> str:
    c = result["counts"]
    lines = [
        f"inventory={c['inventory']} docs={c['docs']} "
        f"missing={c['missing']} extra={c['extra']} empty={c['empty']} bad={c['bad']}",
        f"ok={result['ok']}",
    ]
    if result["missing"]:
        lines.append("MISSING:")
        lines.extend(f"  {x}" for x in result["missing"][:50])
        if len(result["missing"]) > 50:
            lines.append(f"  … {len(result['missing']) - 50} more")
    if result["extra"]:
        lines.append("EXTRA:")
        lines.extend(f"  {x}" for x in result["extra"][:50])
    if result["empty"]:
        lines.append("EMPTY:")
        lines.extend(f"  {x}" for x in result["empty"][:50])
    if result["bad"]:
        lines.append("BAD:")
        lines.extend(f"  {x}" for x in result["bad"][:80])
        if len(result["bad"]) > 80:
            lines.append(f"  … {len(result['bad']) - 80} more")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--docs", type=Path, default=FIELD_MD_DIR)
    args = parser.parse_args(argv)
    ids = [
        line.strip()
        for line in args.inventory.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    result = check_docs(ids, args.docs)
    sys.stdout.write(format_report(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
