---
name: report-writing
description: 生成 Markdown、文本、JSON 或 CSV 项目产物；当用户要求保存报告、审查记录、说明、结构化数据或可复用交付文件时使用。
---

# 报告与文本项目产物写入

使用 `project_artifact_create` 并选择 `text/markdown/json/csv` format，将交付物写入当前项目的 `xiaoliang-outputs`。

## 规则

- 面向人的报告和审查记录优先使用 Markdown；机器读取时才使用 JSON 或 CSV。
- 把事实、假设、未确认项和下一步分开，重要结论保留项目相对来源路径。
- 不编造不存在的文件、图号、人员、日期、审批或测量数据。
- 未经用户明确要求，不传 `overwrite_confirmed=true`。
- 写入后给出工具返回的相对路径、warning 和内容摘要。

## 推荐 Markdown 结构

`# 标题`、`## 结论`、`## 依据`、`## 明细`、`## 未确认项`、`## 后续建议`。
