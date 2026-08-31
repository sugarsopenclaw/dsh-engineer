# 21 · BOM 实例覆盖对账

21 把 04 的序号段、11 的块实例世界坐标和 13 的视图区整理成“同定义实例是否已有序号指向”的确定性账本。它回答哪些同类块实例值得继续复核，不回答图纸是否漏标或 BOM 是否错误。

## 输入与输出

- 输入：04 的 BOM 行、序号段和全部序号端点，11 的叶子 occurrence、块引用 definition handle、世界变换，13 的区域 bounds；
- 输出：每段的块定义锚点、全图同定义实例、序号覆盖分类、视图分账、BOM 数量原文和诊断；
- 产物：`bom-instance-coverage.json` 与面向人和 LLM 的 `bom-instance-coverage.md`。

## 确定性边界

1. 序号目标点先匹配最近叶子几何，再沿 occurrence id 取最深 `ref:` owner；块身份只用该引用的 `target_definition_handle`。
2. 同定义的每个块引用 occurrence 独立计数，包含 MINSERT 单元格、嵌套与镜像；实例位置取世界变换平移项，足迹取 owner 下叶子 bounds 并集。
3. 全部序号端点先倒排到实例 owner。本段命中为 `pointed`，其他段命中为 `pointed_by_other_item`，无人命中才是 `unpointed_candidate`。
4. 实例位置落入最小非 `sheet_structure_region` 区域；文档区中的无人命中项标为 `in_documentation_region`，不列作候选。
5. `unpointed_candidate` 不是漏标结论。多视图、对称和示意表达都可能合法，21 不跨视图合并身份，也不拿 BOM 数量作裁决。
6. 根空间散线只输出 `not_matchable_loose_geometry`；匿名块按 handle 继续匹配并留诊断，动态 authoring definition 收束留待后续能力。

## 运行回归

```powershell
powershell -ExecutionPolicy Bypass -File .\local-dev\cad\core\21-bom-instance-coverage\test-bom-instance-coverage.ps1
```

测试覆盖三实例两处已有序号、散线锚点、MINSERT 与镜像、文档区排除及同定义跨序号占用。
