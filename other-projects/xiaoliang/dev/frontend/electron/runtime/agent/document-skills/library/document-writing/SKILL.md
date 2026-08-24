---
name: document-writing
description: 生成结构化 Word DOCX 项目产物；当用户要求制作正式报告、审查意见、会议纪要、说明书或项目文档时使用。
---

# Word/DOCX 项目产物写入

使用 `project_artifact_create` 并传 `format="docx"` 生成新 Word 文档。工具只写入当前项目的 `xiaoliang-outputs`，接受结构化 blocks，并由受控本地 worker 统一排版。

## 工作流

1. 明确文档目的、读者、依据范围与输出文件名。
2. 从项目资料提取事实；无法核实的信息标记为“待确认”或假设。
3. 组织 `title`、可选 `subtitle`、`metadata` 与顺序明确的 `blocks`。
4. 调用 `project_artifact_create({ format: "docx", ... })`。除非用户明确要求覆盖，否则不要传 `overwrite_confirmed=true`。
5. 向用户报告返回的相对路径、warning 和自动打开结果。

## Blocks

- `heading`：传 `text`，`level` 仅用 1-3。
- `paragraph`：传完整但简洁的 `text`。
- `bullets`：传 `items`，每项表达一个要点。
- `key_values`：传 `items`，每项包含 `key` 与 `value`。
- `table`：传 `columns` 与对象数组 `rows`，用于可比较事实。
- `note`：传 `text`，用 `tone=note|warning` 标识假设或风险。

## 质量规则

- 正式文档必须有明确标题；项目名、生成依据、日期、限制放入 metadata。
- 结论必须能追溯到项目证据，保留相对来源路径。
- 不编造图号、人员、审批、日期、数量或测量值。
- 长篇叙述用段落，比较矩阵用表格；避免把大段正文塞进表格。
- 当前能力用于新建 DOCX；用户要求精确修改既有文档时，说明暂不支持结构化原位编辑。

## 推荐结构

正式报告通常按“结论摘要—审查范围—依据文件—主要发现—风险与待确认项—后续建议”组织。会议纪要通常包含时间、参与方、议题、决议、责任人、截止时间与依据。
