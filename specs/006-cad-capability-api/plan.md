# 006 — 实施计划

## 数据流

```text
005 staging inventories
  → build_curated.py（校验并合并 atom + enrichment）
  → cad.capabilities.curated.v1/v2 JSONL
  → load_sqlite.py
  → data/datasets/local/cad-capabilities.sqlite
  → FastAPI /api/v1/cad-capabilities
  → 前端能力目录页
```

## 分层

- `ontology/cad_capabilities/v1/ontology.yaml`：对象、属性和库存链接类型契约；
- `data/pipelines/cad_capabilities/`：curated 构建；本机 SQLite 导入见 `data/pipelines/local_query_store/`；
- `backend/domain`：HTTP 无关的原子与筛选契约；
- `backend/application`：查询服务和端口；
- `backend/infrastructure`：本机 SQLite 参数化查询；
- `backend/api`：分页参数、筛选参数和错误映射。

## 查询形态

列表接口返回轻量摘要并强制分页；详情接口按 `atom_id` 返回完整参数、来源和证据。筛选项接口从本机 SQLite 实时聚合当前数据集实际存在的技术面、宿主、原子类型、状态、操作类型和领域标签，不让前端维护封闭枚举。

本阶段不返回图坐标，也不把全部原子塞进现有业务需求图谱。
