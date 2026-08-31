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
| [003-harness-deepseek-gateway](003-harness-deepseek-gateway/spec.md) | Harness 通过 FastAPI 模型网关访问 DeepSeek（迁移期遗留） |
| [004-business-requirements-graph-api](004-business-requirements-graph-api/spec.md) | 从真实 PostgreSQL 查询业务需求图谱与节点详情 |
| [005-cad-capability-catalog](005-cad-capability-catalog/spec.md) | COM/.NET/LISP/命令/原生原子能力 JSONL、归账与可恢复 Agent 循环 |
| [006-cad-capability-api](006-cad-capability-api/spec.md) | 从 PostgreSQL 查询 CAD 原子能力、筛选项与详情 |
| [007-autocad-2024-capability-catalog](007-autocad-2024-capability-catalog/spec.md) | AutoCAD 2024 五个技术面的隔离原子能力采集 |
| [008-cad-capability-multi-host-dataset](008-cad-capability-multi-host-dataset/spec.md) | 将 THCAD V24 与 AutoCAD 2024 独立原子物化为同一多宿主数据集 |
| [009-pi-coding-agent-foundation](009-pi-coding-agent-foundation/spec.md) | 固定 Pi 上游、建立 project-local package、二开 TUI 与升级门禁 |
| [010-pi-thcad-mechanical-subagent](010-pi-thcad-mechanical-subagent/spec.md) | 通过外置 Pi 插件接入 THCAD .NET 01–20 与机械子代理 |
| [011-thcad-review-dataset](011-thcad-review-dataset/spec.md) | 留存父子会话、工具轨迹、图像与内容寻址证据供 review |
| [012-pi-thcad-visual-overview](012-pi-thcad-visual-overview/spec.md) | 基于确定性图框的视觉概览子代理 |
| [013-thcad-drawing-session-and-text-index](013-thcad-drawing-session-and-text-index/spec.md) | 多图纸会话、只读客户图、工作区保存与项目级文字/BOM 路由索引 |
| [014-bom-instance-coverage](014-bom-instance-coverage/spec.md) | 用序号锚点与块定义实例建立 BOM 图面覆盖账本 |
| [015-topology-semantic-library](015-topology-semantic-library/spec.md) | 持久化局部拓扑、两类 plot、BOM/21 证据及视觉/主模型语义并支持双向检索 |
