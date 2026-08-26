# Specs

本仓库用 SDD：先写规格，再改代码。每个主题一个目录 `specs/NNN-slug/`，至少三份：

| 文件 | 写什么 |
| --- | --- |
| `spec.md` | 要解决什么、验收标准、明确不做什么 |
| `plan.md` | 目录、边界、数据流、取舍 |
| `tasks.md` | 可勾选的落地任务 |

编号按提出顺序递增，不复用。实现与 spec 冲突时，先改 spec 再改代码，或停下来问。

当前：

| 目录 | 主题 |
| --- | --- |
| [001-platform-layers](001-platform-layers/spec.md) | 客户资料 / Data Layer / Ontology / 插件 四层怎么拆 |
| [003-harness-deepseek-gateway](003-harness-deepseek-gateway/spec.md) | Harness 通过 FastAPI 模型网关访问 DeepSeek |
