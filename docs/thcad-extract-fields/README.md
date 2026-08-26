# THCAD 全量抽取字段工程分析

本目录是对 `docs/dev` 三篇 THCAD 抽取目录的字段级工程释义：对照七张 `out-thcad` 实测 JSON，逐字段说明在沈变变压器图纸里能做什么（或明确做不到）。

- 完备性对照：[`00-completeness.md`](./00-completeness.md)
- 字段文档：[`fields/`](./fields/)（共 455 篇，一字段一篇）
- 库存清单：[`_inventory.txt`](./_inventory.txt)
- 公开资料检索记录：[`_research-log.txt`](./_research-log.txt)

## 粒度

一篇文档 = 一个抽取字段，不是一条图元、不是一行明细、不是一个 TypedValue 组码。

包含：各 JSON 文件的记录列、一层嵌套键（`color.*`、`geometry.<key>` 跨 kind 同名合一、`text.*`、`attributes[]` 项键、`custom`/`explode` 载荷键、`proxy.*`）、标题栏 30 个中文 tag、明细 8 个 tag、其它 PC 块 tag、每个实测 XData **应用名**、每个命名字典 **键名**。同名键按表加前缀。

## 每篇结构

JSON 路径、来源表、out-thcad 例子（含全空或键不在）、CAD 含义、沈变用途（单独 / 与谁组合）、**判定**三选一：单独可用 / 仅与其他字段组合可用 / 目前不能支撑工程结论。

生成器：`scripts/thcad_field_docs/`。覆盖率检查（会再走一遍七张 `out-thcad`）：

```text
python scripts/thcad_field_docs/test_field_doc_coverage.py
```
