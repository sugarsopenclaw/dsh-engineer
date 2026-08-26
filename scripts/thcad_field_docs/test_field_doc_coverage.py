"""Coverage tests that walk the real out-thcad extracts and the shipped field docs.

Run from repo root:

    python scripts/thcad_field_docs/test_field_doc_coverage.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from thcad_field_docs.coverage import check_docs, format_report  # noqa: E402
from thcad_field_docs.inventory import build_inventory  # noqa: E402
from thcad_field_docs.paths import FIELD_MD_DIR, OUT_THCAD  # noqa: E402


MUST_HAVE = (
    "drawing.tile_mode",
    "drawing.insunits",
    "report.source_sha256",
    "report.host.application",
    "entity.semantic_type",
    "entity.color.index",
    "entity.text.measurement",
    "entity.text.dimension_text",
    "entity.xdata.AcDbBlockRepETag",
    "entity.geometry.kind",
    "entity.geometry.start",
    "title.产品型号",
    "title.图样代号",
    "bom.序号",
    "bom.代号",
    "dict_key.PC_BOMXHRELATEDIC",
    "dict_key.明细表分列记录",
    "link.item.xuhao_handle",
    "pc.PC_TYDH_BLOCK.图样代号",
    "pc.PC_CSL_BLOCK",
)


def test_inventory_from_real_extracts() -> dict:
    assert (OUT_THCAD / "5TBC.384.A110050.2_1" / "entities.jsonl").exists()
    inv = build_inventory()
    missing = [fid for fid in MUST_HAVE if fid not in inv]
    assert not missing, f"inventory missing required ids: {missing}"
    # semantic_type is extractor-only (null stripped)
    st = inv["entity.semantic_type"]
    assert st["in_extractor"] is True
    assert st["in_data"] is False
    # tile_mode is actually in drawing.json
    tm = inv["drawing.tile_mode"]
    assert tm["in_data"] is True
    assert any("True" in x or "true" in x for x in tm["examples"])
    # 图样代号 real value
    th = inv["title.图样代号"]
    assert any("5TBC." in x or "8TBC." in x for x in th["examples"])
    kind = inv["entity.geometry.kind"]
    assert kind["in_data"] is True
    assert kind["counts"]["seen"] > 0
    kind_blob = " ".join(kind["examples"])
    assert any(
        token in kind_blob
        for token in ("line", "block_reference", "professional", "dimension", "wipeout", "unparsed")
    )
    return inv


def test_every_inventory_field_has_nonempty_doc(inv: dict) -> None:
    result = check_docs(list(inv), FIELD_MD_DIR)
    assert result["ok"], format_report(result)


def test_spot_docs_name_field_and_verdict() -> None:
    samples = {
        "title.产品型号.md": "产品型号",
        "entity.xdata.AcDbBlockRepETag.md": "AcDbBlockRepETag",
        "entity.text.dimension_text.md": "dimension_text",
        "bom.序号.md": "序号",
    }
    for name, needle in samples.items():
        path = FIELD_MD_DIR / name
        text = path.read_text(encoding="utf-8")
        assert needle in text
        assert "实测观察" in text
        assert (
            "判定：单独可用" in text
            or "判定：仅与其他字段组合可用" in text
            or "判定：目前不能支撑工程结论" in text
        )
        assert "5TBC." in text or "8TBC." in text or "key absent" in text


def main() -> int:
    inv = test_inventory_from_real_extracts()
    test_every_inventory_field_has_nonempty_doc(inv)
    test_spot_docs_name_field_and_verdict()
    print(f"PASS inventory={len(inv)} docs_ok")
    # keep a small proof blob next to the test when run in-repo
    proof = {
        "inventory_count": len(inv),
        "must_have": list(MUST_HAVE),
        "title_example": inv["title.图样代号"]["examples"][:3],
        "sha_example": inv["report.source_sha256"]["examples"][:2],
    }
    print(json.dumps(proof, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
