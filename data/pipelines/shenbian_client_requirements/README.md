# 沈变客户需求业务建模管线

读取 `client-data/client-requirements/` 的 4 份不可变原文，生成可追溯、可去重、可继续连接能力图谱和运行图谱的业务需求数据集。

## 事实分层

- `customer_primary`：原始 XLSX、DOCX 和 DOCX 内嵌附件，作为客户需求主证据。
- `derived_analysis`：两份 Markdown 整理稿，只作为解释和拆分参考，不覆盖原始证据。
- `customer_stated`：直接由客户原文形成的需求实体。
- `normalized`：只调整命名或组织层级，不新增客户事实。
- `domain_decomposition`：为独立开发和验收而拆出的原子点，仍可能需要客户补充规则、公差或样本。

## 生成

```powershell
C:\Users\Microsoft\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  data\pipelines\shenbian_client_requirements\build_curated.py
```

默认输出到 `data/datasets/curated/shenbian-client-requirements/v1/`。该目录是可再生产物，不进 Git。

## 写入本机 SQLite

查询物化是本机 SQLite，不再写入 `DATABASE_URL`。JSONL 仍是可复现产物。

```powershell
uv run --project backend python `
  data\pipelines\local_query_store\load_sqlite.py `
  --kind business-requirements
```

默认写入 `data/datasets/local/business-requirements.sqlite`。旧的 `load_postgres.py` 入口会立即失败。详见 [`../local_query_store/README.md`](../local_query_store/README.md)。

## 数据表

| 表 | 一行代表什么 | 关键说明 |
| --- | --- | --- |
| `source_documents.jsonl` | 一份来源文档 | 区分原始客户资料、内嵌附件和二次整理稿 |
| `source_evidence.jsonl` | 一段可定位原文 | 保留 sheet/cell、段落或表格位置及原文摘录 |
| `requirement_nodes.jsonl` | 一个业务需求实体 | 一级需求使用客户能看懂的朴素名称；叶子可独立验证 |
| `requirement_relations.jsonl` | 一条需求间关系 | 支持包含、拆分和复用；整体是 DAG，不强行做单父树 |
| `requirement_source_links.jsonl` | 需求与证据的一次连接 | 客户原述必须有直接主证据 |
| `requirement_aliases.jsonl` | 一个别名 | “线圈/绕组”“图纸去标注/生产用图纸净化”等不再复制节点 |
| `dedup_decisions.jsonl` | 一次去重或保留决定 | 记录为什么合并、拆开或只共享下层需求 |
| `dedup_decision_requirement_links.jsonl` | 去重决定涉及的一个需求 | 不在去重决定节点上重复保存需求 ID 数组 |
| `scope_dimensions.jsonl` | 一种可扩展筛选维度 | 机构、CAD 专业、产品领域、组部件、图纸类型等 |
| `scope_values.jsonl` | 一个维度值 | 不把“沈变/机械/变压器”等写死为枚举 |
| `requirement_scope_links.jsonl` | 需求的一次适用范围声明 | 可继承到下层需求，并保留包含/排除/条件适用语义 |
| `acceptance_criteria.jsonl` | 一个原子需求的候选验收条件 | 当前没有擅填数值阈值；需客户确认的会明确标记 |
| `open_questions.jsonl` | 一个尚未闭合的问题 | 关联受影响需求，不混入已经确认的业务事实 |
| `open_question_requirement_links.jsonl` | 待确认问题影响的一个需求 | 一个问题可以影响多个需求，一个需求也可受多个问题影响 |
| `graph_views.jsonl` | 一个图谱视图 | 记录筛选条件和布局版本，不把视觉布局当业务事实 |
| `graph_view_filters.jsonl` | 一个视图采用的范围筛选值 | 机构、专业和产品领域均引用可扩展范围字典 |
| `graph_layout_positions.jsonl` | 某视图中一个节点的位置 | `x/y/z` 当前全部为 `null`，坐标含义由未来布局算法决定 |

`requirements-tree.md` 是完整的 LLM/人工阅读视图，`source-matrix.md` 是 20 个一级需求与原始证据的对照。

## 校验

每次生成都会检查：来源文件哈希、ID 唯一性、关系端点、层级环、从根需求的可达性、原子需求是否仍有子节点、原子需求是否具有验证方法，以及客户原述是否有直接证据。

`extract_docx.py` 与 `extract_xlsx.mjs` 是原文核对工具。XLSX 工具使用工作区提供的 `@oai/artifact-tool`；`node_modules` 只是本机运行时 junction，不属于仓库内容。
