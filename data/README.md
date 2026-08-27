# data

Data Layer：把 `client-data/` 里的原文变成可复现的数据集，供 `ontology/` 映射。

| 路径 | 进 git | 写什么 |
| --- | --- | --- |
| `catalog/` | 是 | 数据集登记（YAML）。ontology 引用登记 `id`，不引用磁盘路径。 |
| `pipelines/` | 是 | 转换代码。 |
| `datasets/` | 否 | 产物：`raw/` → `staging/` → `curated/`。删了能用同一 drop + 管线再生。 |

不要在 `client-data/` 写派生文件，也不要把表塞进 `plugins/`。

登记字段和数据流见 [`specs/001-platform-layers/plan.md`](../specs/001-platform-layers/plan.md)。

当前管线：

- [`pipelines/shenbian_client_requirements/`](pipelines/shenbian_client_requirements/)：将客户需求原文整理为可追溯的业务需求 DAG；登记见 [`catalog/shenbian-client-requirements.curated.yaml`](catalog/shenbian-client-requirements.curated.yaml)；
- [`pipelines/cad_capabilities/`](pipelines/cad_capabilities/)：把 COM/.NET/LISP/命令/原生盘点转换为逐原子的 staging JSONL，并支持 Agent 分批 enrichment；首批数据确认前不写 PostgreSQL。
