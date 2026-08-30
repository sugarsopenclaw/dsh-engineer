# 008 — CAD 原子能力多宿主数据集

## 目标

把已经人工确认的 THCAD V24 与 AutoCAD 2024 原子库存作为同一种 `CapabilityAtom` 对象物化到 PostgreSQL，并通过现有 `/api/v1/cad-capabilities` 契约查询。每个宿主的观测保持独立行，不按名称或猜测合并原子。

## 数据版本

- `cad.capabilities.curated.v1` 保持不变，只含 5 个 `thcad-v24.*` 库存和 79,549 个原子；
- 新建 `cad.capabilities.curated.v2`，包含 5 个 `thcad-v24.*` 与 5 个 `autocad-2024.*` 库存；
- v2 预期共 10 个库存、334,049 个原子；
- v2 默认由 API 使用，调用方仍可显式传 `dataset_id=cad.capabilities.curated.v1` 查询旧快照。

## 要求

- **R1 独立身份**：原始 `atom_id`、`canonical_key`、`inventory_id` 和 `observed_host_ids` 原样进入对象属性，不给 THCAD 行追加 AutoCAD 宿主，也不给 AutoCAD 行追加 THCAD 宿主。
- **R2 同一对象类型**：两个宿主都写入现有 `ontology.capability_atoms` 和 `ontology.capability_inventories`，由 `dataset_id` 区分数据集版本，不新建宿主专用表。
- **R3 旧版保护**：生成和导入 v2 不得删除、覆盖或改写 v1 文件与数据库行。
- **R4 确定性**：v2 的库存与原子按 ID 稳定排序；输入不变时输出文件哈希不变。
- **R5 完整归账**：COM、.NET、LISP、Command 均须 `pending=0`；Native 可以保持显式 `pending`。构建和入库后核对库存总数、原子总数及各技术面计数。
- **R6 宿主筛选**：API 继续把 `observed_host_id`、`surface`、`operation_kind` 等作为开放筛选属性，facets 必须由真实 v2 数据生成。
- **R7 内存边界**：构建器逐库存处理，并以有界内存合并已排序结果；不得把十个库存的全部 JSON 对象同时留在内存。
- **R8 图投影传输**：远程 PostgreSQL 链路不得为每次冷启动逐行传输数万条宽记录。允许由同一 dataset 内容确定性生成 gzip 最小投影并随 dataset 级联失效；投影不是新原子或语义关系。

## 明确不做

- 不建立跨宿主同义、兼容、共用或独有关系；
- 不生成 SemanticCapability、Logic 关联或运行记录；
- 不把名称相似解释为功能相同；
- 不修改前端图谱布局和交互。

## 验收标准

1. v2 manifest 为 10 个库存、334,049 个原子，技术面计数与两批 staging 之和一致。
2. PostgreSQL 同时存在 v1 的 79,549 条和 v2 的 334,049 条原子。
3. 默认 facets 返回 v2；显式查询 v1 仍返回旧数据。
4. `observed_host_id=thcad-v24` 与 `autocad-2024` 分别得到 79,549 与 254,500 条。
5. 数据管线测试、后端测试与真实 API 验收通过。
6. AutoCAD `.NET` 图投影冷请求返回 26,778 条，且不先加载全量 v2。
