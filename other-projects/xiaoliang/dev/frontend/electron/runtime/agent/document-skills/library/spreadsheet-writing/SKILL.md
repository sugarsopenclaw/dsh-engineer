---
name: spreadsheet-writing
description: 生成结构化 Excel/XLSX 项目产物；当用户要求制作 WBS、工程量清单、算量结果、台账、汇总或定额套用明细时使用。
---

# Excel/XLSX 项目产物写入

使用 `project_artifact_create` 并传 `format="xlsx"` 生成项目 Excel 产物。该工具会写入当前项目的 `xiaoliang-outputs` 目录，并由本地 worker 统一生成易读样式：表头、边框、列宽、换行、冻结首行、筛选和 Excel Table。

## 规则

- 用户要求“导出 Excel / 保存清单 / WBS / 工程量表 / 算量结果 / 定额套用明细”时，优先使用 `project_artifact_create({ format: "xlsx", ... })`。
- 只传结构化数据，不要把 Markdown 表格或大段文本塞进一个单元格。
- sheet 名应短而明确，例如 `WBS`、`工程量清单`、`算量明细`、`定额套用`、`参数说明`。
- 每张表第一行必须是稳定字段名；同类数据不要频繁换列名。
- 金额、数量、面积、体积、长度、费率等字段尽量传数字，不要传带单位的字符串；单位单独放在 `单位` 列。
- 关键来源和不确定项放入 `metadata` 或单独 `说明` sheet，不要混在明细行里。
- 需要多专业或多构件时，优先多 sheet；同一 sheet 内保留 `专业`、`构件类型`、`楼层/部位`、`图纸来源` 等可筛选字段。
- 默认允许工具自动打开生成的 Excel；用户明确说不打开时传 `open_after_write=false`。
- 默认不覆盖同名文件；只有用户明确确认覆盖时，才传 `overwrite_confirmed=true`。

## 推荐列

WBS：

- `WBS编码`
- `父级编码`
- `层级`
- `名称`
- `专业`
- `部位`
- `计量口径`
- `备注`

工程量清单：

- `项目编码`
- `项目名称`
- `项目特征`
- `单位`
- `工程量`
- `计算式`
- `图纸来源`
- `复核状态`
- `备注`

算量明细：

- `构件编号`
- `构件类型`
- `楼层/部位`
- `长度`
- `宽度`
- `高度/厚度`
- `数量`
- `单位`
- `工程量`
- `计算式`
- `证据来源`
- `备注`

定额套用：

- `清单项`
- `定额编号`
- `定额名称`
- `单位`
- `工程量`
- `单价`
- `合价`
- `套用依据`
- `备注`

## 推荐调用

- 生成 WBS：`project_artifact_create({ format: "xlsx", path: "wbs/项目WBS.xlsx", sheets: [{ name: "WBS", rows }] })`。
- 生成工程量清单：`project_artifact_create({ format: "xlsx", path: "quantity/工程量清单.xlsx", sheets: [{ name: "工程量清单", rows }, { name: "说明", rows: notes }] })`。
- 同时交付结果和依据：把明细、汇总、说明分成不同 sheet，并用 `metadata` 写入项目名、生成时间、数据来源和未确认项。
