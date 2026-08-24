---
name: presentation-writing
description: 生成结构化 PowerPoint PPTX 项目产物；当用户要求制作项目汇报、审查汇报、方案演示、管理层摘要或演示文稿时使用。
---

# PowerPoint/PPTX 项目产物写入

使用 `project_artifact_create` 并传 `format="pptx"` 生成新演示文稿。工具只写入当前项目的 `xiaoliang-outputs`，接受结构化 slides，并由受控本地 worker 生成可编辑 PPTX。

## 工作流

1. 明确受众、演示时长、核心结论与证据范围。
2. 先排叙事顺序，再构造 `title`、可选 `subtitle`、`metadata` 与 `slides`。
3. 每页只表达一个主要信息，标题优先写结论而不是宽泛主题。
4. 调用 `project_artifact_create({ format: "pptx", ... })`；未经明确要求不要覆盖同名文件。
5. 报告返回的相对路径、warning 和自动打开结果。

## Slides

- `title`：封面，使用 `title` 与可选 `subtitle`。
- `section`：章节分隔页。
- `bullets`：传 3-6 个精炼 `bullets`。
- `content`：传简短 `body`，适合一段结论或说明。
- `table`：传 `columns` 与对象数组 `rows`，仅放紧凑比较信息。
- `closing`：下一步、待决策事项或结束页。

## 质量规则

- 不编造来源、图号、批准、日期、数量或图表数据。
- 保留证据相对路径，可放在 `notes` 或正文末尾。
- 表格过密时把明细放 Excel/DOCX，PPT 只保留管理层需要的摘要。
- 缺失证据明确写成限制或待确认项。
- 当前能力用于新建 PPTX；用户要求精确修改既有文件时，说明暂不支持结构化原位编辑。
