# 006 — CAD 原子能力 PostgreSQL 物化与查询 API

## 背景

`specs/005-cad-capability-catalog/` 已经生成 THCAD V24 的 COM、.NET、LISP、Command/CUI 和原生 PE 原子能力 JSONL。首批数据已经完成完整性校验与人工抽查，现在需要把这些原子作为 Ontology 对象实例写入 PostgreSQL，并通过真实后端接口供前端浏览。

## 需求

- **R1** 建立 `cad.capabilities.curated.v1` 数据集。确定性管线只读取 005 的 manifest、原始 atom 和独立 enrichment；不得从 Markdown 重建成员。
- **R2** 首期只物化 `CapabilityInventory` 和 `CapabilityAtom`。enrichment 的状态、操作分类、领域标签、摘要、置信度和证据作为原子属性保存。
- **R3** 原子保留稳定 `atom_id`、完整签名、参数、返回类型、来源构件、声明符号、技术面、原子种类和 `observed_host_ids`。当前观测宿主仅为 `thcad-v24`，不得推断 AutoCAD 兼容性。
- **R4** `surface`、`atom_kind`、`observed_host_ids`、`classification_status`、`operation_kinds` 和 `domain_tags` 必须是可查询属性。API 不把 `.NET`、COM、THCAD 或操作类型写死为前端枚举。
- **R5** 提供分页只读接口：原子列表、单原子详情和筛选项计数；支持按技术面、宿主、原子种类、分类状态、操作类型、领域标签和文本查询筛选。
- **R6** PostgreSQL 物化只能由 `data/pipelines/cad_capabilities/` 的导入管线完成，连接只读取根 `.env` 的 `DATABASE_URL`。导入按 `dataset_id` 原子替换并核对提交前后计数。
- **R7** 数据库不可用返回脱敏 `503`；数据集或原子不存在返回稳定 `404`。领域和应用模型不得依赖 FastAPI 或 SQLAlchemy。
- **R8** OpenAPI、仓库 API 文档、测试和真实数据库验收必须与实现一致。前端生产代码只调用真实 `/api/v1`，不得使用 mock 兜底。

## 当前数据边界

- COM、.NET、LISP 和 Command/CUI 原子带完整 enrichment 归账；
- 原生 PE 只保存 `native_export` 元数据候选，`classification_status=pending`、`operation_kinds=[]`，不猜测调用协议；
- 当前数据中“写入”入口仍通过 `atom_kind=property_set|field_write` 与 `operation_kinds` 中的 `edit` 表达，不额外篡改 005 的分类结果。

## 非目标

- 不物化 SemanticCapability、IMPLEMENTS、Logic、AgentRun、Review 或运行时支持矩阵；
- 不提供创建、编辑、删除 CAD 实体的 HTTP 动作接口；
- 不在本规格实现能力图谱关系或 2D/3D 布局；
- 不把原生 PE 导出自动变成 P/Invoke；
- 不宣称当前 THCAD 观测能够代表 AutoCAD 或其他版本。

## 验收

1. curated manifest 与 PostgreSQL 中的库存数、原子数和按技术面计数一致；
2. 当前五个技术面的 79,549 个原子全部入库，稳定 ID 不变；
3. `surface=com`、`observed_host_id=thcad-v24`、`operation_kind=delete` 等筛选返回真实计数和分页数据；
4. 原子详情返回完整 member、source artifact、provenance 和 enrichment 属性；
5. 原生候选保持未知签名和 pending 状态；
6. API 自动化测试、迁移、真实数据库查询和文档校验通过。
