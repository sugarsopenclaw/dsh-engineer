# 005 — CAD 原子能力目录与可恢复盘点循环

## 背景

仓库已经分别生成 THCAD V24 的 .NET、COM、LISP/命令和原生能力盘点，但当前主要产物是供人阅读的 Markdown。Markdown 合并了部分同名重载，也没有逐原子的处理状态，不能直接证明 Agent 是否完整处理了指定库存。

本规格先建立机器可遍历、可校验、可中断恢复的 staging 数据集。确定性导出器负责产生原始 JSONL，Agent 只在独立 enrichment JSONL 中补充分类、语义候选和验证结果。PostgreSQL、API、跨技术语义去重和图谱前端在确认首批数据后另开规格。

## 术语

- **Inventory**：某次针对指定宿主安装和能力面的可重建快照。
- **CapabilityAtom**：一次可独立调用或访问的技术原子，例如方法重载、属性 getter、属性 setter、构造器、事件订阅入口、LISP 函数或命令。
- **Enrichment**：对一个原子的操作分类、简述、领域标签和语义能力候选；不得改写原始原子。
- **Observed host**：已经在某宿主安装或运行时观测到该原子，不等于该原子由该宿主厂商独有。
- **Bounded completeness**：在 manifest 明确声明的程序集、类型库、源码、CUI 或运行时快照范围内无漏项；不声称覆盖未公开私有实现。

## 需求

- **R1** 每个能力面必须由确定性扫描器直接输出 `capability-atoms.jsonl` 和 `inventory-manifest.json`，不得由 LLM 从 Markdown 重新抄写。
- **R2** 原子粒度必须保留完整签名：方法和构造器按重载拆分；属性 getter/setter 拆分；事件订阅/取消入口可区分；同名不同声明类型不得合并。
- **R3** 原始原子必须包含稳定 `atom_id`、`canonical_key`、来源构件、声明符号、完整签名、参数、返回类型、提取器和来源定位。
- **R4** 当前 THCAD 扫描得到的原子只建立 `observed_host_ids=["thcad-v24"]` 的观测事实，不推断 AutoCAD 或其他宿主兼容性，也不宣称 THCAD 独有。
- **R5** Agent 只能写独立的 enrichment 记录。每条必须引用已存在的 `atom_id`；允许 `classified`、`deferred`、`failed`，不允许无证据地把推测写成已验证事实。
- **R6** 操作分类支持多值，至少覆盖读取、计算、创建、编辑、删除、变换、保存、导入、导出、选择、导航、显示、调用、事件和生命周期。
- **R7** 批处理工具必须能从多个 enrichment part 文件计算进度、输出下一批尚未处理的原子，并在中断后继续；单 Agent 串行处理时不依赖可变的队列服务。
- **R8** 完整性校验必须检查 JSON、必填字段、稳定 ID、原子唯一性、enrichment 唯一性、未知 ID、manifest 总数、按类型计数和原子文件 SHA-256。
- **R9** 完成条件为 `pending=0` 且 `raw_total=classified+deferred+failed`。`deferred` 和 `failed` 仍需保留原因，不能静默跳过。
- **R10** 原始技术原子不得因跨 COM/.NET/LISP 功能相似而删除。后续通过 `IMPLEMENTS semantic_capability` 或候选等价关系连接。关系模型见 [`semantic-capability.md`](semantic-capability.md)。
- **R11** JSONL 产物写入 `data/datasets/staging/cad-capabilities/`，属于可再生产物且不进 Git；导出器、schema、校验代码和规格进 Git。
- **R12** 在首批 JSONL 经人工抽查并确认前，不建立 PostgreSQL capability 实例表，不提供图谱 API，也不将推测语义物化为正式 Ontology 事实。

## 原子范围

首批可执行/可访问原子包括：

- .NET/COM 方法重载与构造器重载；
- 属性 getter 与 setter；
- 事件订阅与取消入口；
- 可读写字段（枚举常量作为支持符号，不伪装成 Action）；
- LISP 函数、`C:` 命令和可验证的命令 token；
- ProgID 激活入口；
- 原生 PE 导出只作为 `native_export` 候选，签名未知时不得推断调用协议；
- CUI 菜单宏作为 `macro`/工作流记录，并在以后连接其调用的命令，不与命令原子合并。

读取/计算原子是 Ontology Function 的候选底层实现；会改变 CAD、文档或文件状态的原子是 Ontology Action 的候选底层实现。`CapabilityAtom` 本身不等同于已经可供业务 Agent 稳定调用的正式 Action。

## 数据流

```text
程序集 / 类型库 / LSP / CUI / 当前会话
  → 确定性 surface exporter
  → inventory-manifest.json + capability-atoms.jsonl（不可改）
  → next-batch（只选 pending atom_id）
  → Agent enrichment part-xxxxx.jsonl
  → validate / progress
  → 人工抽查与运行时 probe
  → 后续 curated 数据集与 PostgreSQL 物化
```

## 验收

1. 同一输入快照重复导出时，原子顺序、`canonical_key`、`atom_id` 和文件 SHA-256 完全一致。
2. 修改任意原始签名会改变稳定 ID 或导致校验失败，Agent 无法用不存在的 ID 写 enrichment。
3. 处理一部分后重新执行 `next-batch`，已处理原子不会再次进入批次。
4. enrichment 出现重复 ID、未知 ID、缺分类证据或非法状态时校验失败。
5. `--require-complete` 在存在 pending 时失败；全部原子被 classified/deferred/failed 归账后成功。
6. COM、.NET 和 LISP/命令分别保留自身可证明的库存边界与源计数，不把 LISP 三路证据并集描述成全部原生命令。
7. 在未获人工确认前，没有 capability 数据被导入 PostgreSQL。

## 非目标

- 不在本规格逐个执行会修改当前用户图纸的 API；
- 不自动证明每个成员在所有实体类型、许可证和图纸状态下都可用；
- 不自动合并跨技术原子；
- 不宣称覆盖天河未公开私有实现或无法枚举的隐藏命令；
- 不实现 Neo4j、PostgreSQL 表、后端 API 或 2D/3D 页面。
