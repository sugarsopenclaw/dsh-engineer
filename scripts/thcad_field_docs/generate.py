"""Generate one analysis markdown file per inventory field, plus completeness report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .catalog import CATALOG_FILES, split_against_inventory
from .coverage import check_docs, format_report
from .inventory import build_inventory, field_filename, write_inventory_txt
from .knowledge import ALONE, COMBO, NONE, analysis_for
from .paths import FIELD_DOC_DIR, FIELD_MD_DIR, DRAWING_NAMES

VERDICT_LINE = {
    ALONE: "判定：单独可用",
    COMBO: "判定：仅与其他字段组合可用",
    NONE: "判定：目前不能支撑工程结论",
}


def _obs_section(obs: dict) -> str:
    lines = [
        f"- 来源文件：`{obs['source_file']}`",
        f"- JSON 路径：`{obs['json_path']}`",
        f"- 作用域：`{obs['scope']}`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）",
        f"- 抽取器 Serialize/Dump 是否声明该键：{'是' if obs['in_extractor'] else '否（派生产物或仅数据中出现）'}",
    ]
    present = obs["present_drawings"]
    absent = obs["absent_drawings"]
    if present:
        lines.append("- 在这些图纸的 JSON 中出现过：" + "、".join(f"`{x}`" for x in present))
    else:
        lines.append(
            "- **key absent on all seven drawings**：七张 `out-thcad/<图>/` 的 JSON/JSONL 都没有这个键"
            "（抽取器可能写了 null，JsonUtil 会丢弃 null；或该类图元本批没有）。"
        )
    if absent and present:
        lines.append("- 这些图纸上未出现该键：" + "、".join(f"`{x}`" for x in absent))
    counts = obs.get("counts") or {}
    if counts:
        lines.append(f"- 计数：{json.dumps(counts, ensure_ascii=False)}")
    if obs.get("examples"):
        lines.append("- 实测例子：")
        for ex in obs["examples"]:
            lines.append(f"  - `{ex}`")
    if obs.get("empty_examples"):
        lines.append("- 空值例子（图上没填或空串，不是漏抽）：")
        for ex in obs["empty_examples"]:
            lines.append(f"  - `{ex}`")
    if obs.get("notes"):
        lines.append("- 附注：")
        for n in obs["notes"][:8]:
            lines.append(f"  - {n}")
    if not present and not obs.get("examples"):
        lines.append("- 观察结论：本键在现行七张 THCAD 抽取里不落地，工程上只能当「抽取器能力预留」或「本批图纸没有这类对象」。")
    return "\n".join(lines)


def render_doc(obs: dict) -> str:
    ana = analysis_for(obs)
    verbatim = obs["verbatim"]
    fid = obs["id"]
    verdict = VERDICT_LINE[ana["verdict"]]
    return "\n".join(
        [
            f"# 字段：{verbatim}",
            "",
            f"- **字段 ID**：`{fid}`",
            f"- **JSON 路径**：`{obs['json_path']}`",
            f"- **来源表/文件**：`{obs['source_file']}`",
            f"- **作用域**：`{obs['scope']}`",
            "",
            "## 实测观察",
            "",
            _obs_section(obs),
            "",
            "## CAD 含义",
            "",
            ana["cad"],
            "",
            f"公开资料：{ana['research']}",
            "",
            "## 沈变工程能做什么",
            "",
            "对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），"
            "目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。",
            "",
            "### 单独使用",
            "",
            ana["alone"],
            "",
            "### 与其他字段组合",
            "",
            ana["combo"],
            "",
            "## 工程可用性判定",
            "",
            f"**{verdict}**",
            "",
            "内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。",
            "",
        ]
    )


def write_completeness(inv: dict[str, dict], path: Path) -> None:
    ids = set(inv)
    split = split_against_inventory(ids)
    catalog_names = [p.name for p in CATALOG_FILES]
    drawings = list(DRAWING_NAMES)

    def _md_list(items: list[str], limit: int = 40) -> str:
        if not items:
            return "（空集，已显式列出）"
        body = "\n".join(f"- `{x}`" for x in items[:limit])
        if len(items) > limit:
            body += f"\n- … 其余 {len(items) - limit} 个见 `_inventory.json` / 本文件完整列表附录"
        return body

    # Highlight verification examples.
    examples = [
        "drawing.tile_mode",
        "drawing.insunits",
        "drawing.measurement",
        "drawing.original_file_version",
        "drawing.last_saved_as_version",
        "report.source_sha256",
        "report.host",
        "report.host.application",
        "report.entity_count",
        "entity.semantic_type",
        "entity.color.index",
        "entity.color.is_by_layer",
        "entity.text.measurement",
        "entity.text.dimension_text",
        "entity.xdata.AcDbBlockRepETag",
        "entity.geometry.kind",
        "entity.custom.properties",
    ]
    example_rows = []
    for fid in examples:
        bucket = (
            "both"
            if fid in split["both"]
            else "only_data"
            if fid in split["only_data"]
            else "only_catalog"
            if fid in split["only_catalog"]
            else "not_in_inventory"
        )
        example_rows.append(f"| `{fid}` | {bucket} |")

    only_data = split["only_data"]
    appendix = "\n".join(f"- `{x}`" for x in only_data)

    text = f"""# THCAD 抽取字段完备性对照

对照对象：

- 目录文档（`docs/dev`）：
  - `{catalog_names[0]}`
  - `{catalog_names[1]}`
  - `{catalog_names[2]}`
- 实测数据：`dev-test/visualstudionetframework/out-thcad/` 下七张图
{chr(10).join(f'  - `{n}`' for n in drawings)}
- 抽取器字段图：`dev-test/visualstudionetframework/ThcadExtractor/DrawingExtractor.cs`（SerializeEntity / DumpTables / GeometryOf / TextOf / SemanticBlock / HostInfo）

字段粒度见本目录 README（不是每条 Line、不是每个 TypedValue code）。

统计：库存 **{len(inv)}** 个字段；两边都有 **{len(split['both'])}**；只在目录 **{len(split['only_catalog'])}**；只在数据/抽取器 **{len(split['only_data'])}**。

## 验证例键落在哪一侧

这些键是计划里点名要交代的。若目录已经写过，这里标明 `both` 而不是跳过。

| 字段 ID | 落点 |
| --- | --- |
{chr(10).join(example_rows)}

说明：

- `drawing.tile_mode` / `insunits` / 版本枚举：字段目录只把 `drawing.json` 写成「图纸元数据」，没有把这些键列进表，故属 **只在数据**。
- `report.source_sha256` / `host.*` / 计数：字段目录把 `extraction-report.json` 写成「计数」，未列 sha256/host 子键，故属 **只在数据**。
- `entity.semantic_type`：抽取器写入但恒 null，JSON 省略，属库存中的抽取器键，目录实体表未列。
- `entity.color.*`：字段目录 §1 写成 `color.index / is_by_layer / is_by_block / name`，属 **两边都有**。
- `entity.text.measurement` + `dimension_text`：数据底座选型文明确写了尺寸同时带 measurement 与 dimension_text；字段目录 geometry 也写了 measurement，属 **两边都有**。
- `entity.xdata.AcDbBlockRepETag`：字段目录 §2.6 把它列为 **RegApp 注册名**，§11.3「实体上实际带值的 XData」表却没点它的名；实测 20319 条实体带这包数据，故作为 **实体 XData 应用名** 记入 **只在数据**（RegApp 表本身已在目录）。
- `geometry.kind` 的值 `wipeout` / `unparsed` / `polyline2d`：目录 §11.2 已写，不是独立字段；本库存只有 `entity.geometry.kind` 一个字段。

## 只在目录（only in docs）

{_md_list(split['only_catalog'], 80)}

## 两边都有（in both）

{_md_list(split['both'], 80)}

完整 both 列表见附录 `_completeness-both.txt`（生成时写出）。

## 只在数据或抽取器（only in data）

数量 {len(only_data)}。包括 drawing.json 顶层键、extraction-report 的 sha256/host/计数字段、实体嵌套 geometry.*、custom.properties.*、未写入目录 §11.3 的 XData 应用名、全部 NOD 键、错误/proxy 预留键等。

完整 only-in-data 列表：

{appendix}
"""
    path.write_text(text, encoding="utf-8")
    (path.parent / "_completeness-both.txt").write_text(
        "\n".join(split["both"]) + "\n", encoding="utf-8"
    )
    (path.parent / "_completeness-only-catalog.txt").write_text(
        "\n".join(split["only_catalog"]) + "\n", encoding="utf-8"
    )
    (path.parent / "_completeness-only-data.txt").write_text(
        "\n".join(split["only_data"]) + "\n", encoding="utf-8"
    )


def write_readme(n: int, path: Path) -> None:
    path.write_text(
        f"""# THCAD 全量抽取字段工程分析

本目录是对 `docs/dev` 三篇 THCAD 抽取目录的字段级工程释义：对照七张 `out-thcad` 实测 JSON，逐字段说明在沈变变压器图纸里能做什么（或明确做不到）。

- 完备性对照：[`00-completeness.md`](./00-completeness.md)
- 字段文档：[`fields/`](./fields/)（共 {n} 篇，一字段一篇）
- 库存清单：[`_inventory.txt`](./_inventory.txt)

## 粒度

一篇文档 = 一个抽取字段，不是一条图元、不是一行明细、不是一个 TypedValue 组码。

包含：各 JSON 文件的记录列、一层嵌套键（`color.*`、`geometry.<key>` 跨 kind 同名合一、`text.*`、`attributes[]` 项键、`custom`/`explode` 载荷键、`proxy.*`）、标题栏 30 个中文 tag、明细 8 个 tag、其它 PC 块 tag、每个实测 XData **应用名**、每个命名字典 **键名**。同名键按表加前缀。

## 每篇结构

JSON 路径、来源表、out-thcad 例子（含全空或键不在）、CAD 含义、沈变用途（单独 / 与谁组合）、**判定**三选一：单独可用 / 仅与其他字段组合可用 / 目前不能支撑工程结论。

生成器：`scripts/thcad_field_docs/`。覆盖率检查：`python -m scripts.thcad_field_docs.check`。
""",
        encoding="utf-8",
    )


def generate(doc_root: Path | None = None) -> dict[str, dict]:
    root = doc_root or FIELD_DOC_DIR
    md_dir = root / "fields"
    md_dir.mkdir(parents=True, exist_ok=True)
    # drop stale field docs
    for old in md_dir.glob("*.md"):
        old.unlink()

    inv = build_inventory()
    write_inventory_txt(inv, root / "_inventory.txt")
    (root / "_inventory.json").write_text(
        json.dumps(inv, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_completeness(inv, root / "00-completeness.md")
    write_readme(len(inv), root / "README.md")

    for fid, obs in inv.items():
        (md_dir / field_filename(fid)).write_text(render_doc(obs), encoding="utf-8")
    return inv


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=FIELD_DOC_DIR)
    args = parser.parse_args(argv)
    inv = generate(args.out)
    result = check_docs(list(inv), args.out / "fields")
    print(f"wrote {len(inv)} field docs to {args.out / 'fields'}")
    print(format_report(result), end="")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
