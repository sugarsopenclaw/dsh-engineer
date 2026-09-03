# 沈变共享 API

`shenbian-api`（`backend/`）为本地 Pi Agent 提供共享读取接口与拓扑语义存储。本文档按当前实现列出全部 HTTP 接口；规格仍以 `specs/` 为准。

业务需求图谱的完整前端联调契约见 [`business-requirements-graph-api.md`](business-requirements-graph-api.md)，CAD 原子能力目录契约见 [`cad-capabilities-api.md`](cad-capabilities-api.md)。

- 服务标题：沈变共享 API
- 版本：`0.4.0`
- 默认监听：`http://127.0.0.1:8000`
- 业务前缀：`/api/v1`
- 交互式文档：启动后访问 [`/docs`](http://127.0.0.1:8000/docs)（OpenAPI）

启动：

```powershell
cd backend
uv run shenbian-api
```

---

## 通用约定

| 项 | 约定 |
| --- | --- |
| 协议 | HTTP/1.1，JSON 默认 `application/json; charset=utf-8` |
| 路径 | 业务接口一律在 `/api/v1` 下 |
| 鉴权 | 当前本机/受控内网部署中**不鉴权** |
| 成功 | `2xx`，响应体为对应模型 JSON |
| 失败 | 见各接口错误表 |

---

## 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health/live` | 否 | 进程存活 |
| `GET` | `/api/v1/health/ready` | 否 | 依赖就绪（SQLite / Redis / OSS） |
| `GET` | `/api/v1/ontology` | 否 | Ontology 摘要 |
| `GET` | `/api/v1/ontology/actions` | 否 | 全部动作类型契约 |
| `GET` | `/api/v1/data-catalog` | 否 | 已登记数据集目录 |
| `GET` | `/api/v1/business-requirements/graph` | 否 | 本机 SQLite 业务需求图谱及 2D/3D 坐标 |
| `GET` | `/api/v1/business-requirements/{requirement_id}` | 否 | 需求、证据、范围、验收条件和待确认项详情 |
| `GET` | `/api/v1/cad-capabilities/atoms` | 否 | 本机 SQLite 分页查询 CAD 原子能力及属性筛选 |
| `GET` | `/api/v1/cad-capabilities/graph-atoms` | 否 | 本机 SQLite NDJSON 批量返回筛选后的图谱最小投影 |
| `GET` | `/api/v1/cad-capabilities/atoms/{atom_id}` | 否 | 本机 SQLite 查询单个原子的完整技术事实与分类属性 |
| `GET` | `/api/v1/cad-capabilities/facets` | 否 | 本机 SQLite 查询技术面、宿主、操作类型等筛选项计数 |

当前业务需求和 CAD 能力对象实例只提供上述只读查询；尚未提供写入 CRUD、图纸上传或图元读写接口。

---

## 健康检查

### `GET /api/v1/health/live`

进程是否在跑。不探测外部依赖。

**响应** `200`

```json
{
  "status": "alive"
}
```

```http
GET /api/v1/health/live HTTP/1.1
Host: 127.0.0.1:8000
```

---

### `GET /api/v1/health/ready`

并行探测拓扑语义 SQLite、Redis、OSS。任一失败则整体 `not_ready`，HTTP 状态为 `503`。探测超时 5 秒。错误只回异常类型名，不含连接串或密钥。

**响应** `200`（全部 `ok`）

```json
{
  "status": "ready",
  "dependencies": [
    { "name": "sqlite", "status": "ok", "latency_ms": 1.23, "error_type": null },
    { "name": "redis", "status": "ok", "latency_ms": 3.21, "error_type": null },
    { "name": "oss", "status": "ok", "latency_ms": 45.67, "error_type": null }
  ]
}
```

**响应** `503`（任一依赖失败）

```json
{
  "status": "not_ready",
  "dependencies": [
    {
      "name": "sqlite",
      "status": "error",
      "latency_ms": 8.1,
      "error_type": "TimeoutError"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `string` | `ready` 或 `not_ready` |
| `dependencies[].name` | `string` | `sqlite` / `redis` / `oss` |
| `dependencies[].status` | `string` | `ok` 或 `error` |
| `dependencies[].latency_ms` | `number` | 该探测耗时，毫秒 |
| `dependencies[].error_type` | `string \| null` | 失败时的异常类名 |

---

## Ontology

数据源：仓库 `ontology/shenbian/v1/ontology.yaml`，进程启动时加载。接口只读，不写实例。

### `GET /api/v1/ontology`

返回当前 Ontology 的计数与类型 ID 列表，不含对象/链接的完整字段定义。

**响应** `200`（字段形状；计数与 ID 随 YAML 变化）

```json
{
  "schema_version": "1.0",
  "namespace": "shenbian.drawing_review",
  "display_name": "沈变图纸审查 Ontology",
  "description": "面向生产用 DXF 图纸净化与铁芯叠片一致性校验的首期运营语义模型。",
  "object_type_count": 15,
  "link_type_count": 16,
  "action_type_count": 14,
  "object_type_ids": [
    "product_project",
    "data_asset",
    "drawing",
    "drawing_revision",
    "extraction_snapshot",
    "engineering_feature",
    "parameter_set",
    "rule_version",
    "review_task",
    "check_run",
    "finding",
    "issue",
    "evidence",
    "artifact",
    "approval"
  ],
  "link_type_ids": [
    "drawing_belongs_to_project",
    "revision_of_drawing",
    "revision_backed_by_asset",
    "snapshot_extracted_from_revision",
    "feature_observed_in_snapshot",
    "parameter_set_describes_revision",
    "task_uses_revision",
    "run_executes_task",
    "run_applies_rule",
    "finding_produced_by_run",
    "finding_targets_feature",
    "finding_supported_by_evidence",
    "issue_confirmed_from_finding",
    "artifact_derived_from_revision",
    "artifact_validated_by_run",
    "approval_authorizes_artifact"
  ],
  "action_type_ids": [
    "create_dxf_purification_task",
    "confirm_manufacturing_region",
    "preview_dxf_purification",
    "generate_dwg_working_copy",
    "validate_manufacturing_geometry",
    "export_production_dxf",
    "create_lamination_review_task",
    "pair_drawing_and_parameter_versions",
    "reconstruct_expected_lamination",
    "align_lamination_views",
    "run_lamination_consistency_check",
    "disposition_finding",
    "rerun_review_task",
    "publish_review_report"
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schema_version` | `string` | Ontology schema 版本 |
| `namespace` | `string` | 命名空间 |
| `display_name` | `string` | 显示名 |
| `description` | `string` | 说明 |
| `object_type_count` | `integer` | 对象类型数量 |
| `link_type_count` | `integer` | 链接类型数量 |
| `action_type_count` | `integer` | 动作类型数量 |
| `object_type_ids` | `string[]` | 对象类型 ID，顺序与 YAML 一致 |
| `link_type_ids` | `string[]` | 链接类型 ID |
| `action_type_ids` | `string[]` | 动作类型 ID |

---

### `GET /api/v1/ontology/actions`

返回全部动作类型的风险与审批契约，供 Agent / 插件在调用动作前判断是否只读、是否需要审批。

**响应** `200`：`ActionTypeDefinition[]`

```json
[
  {
    "id": "preview_dxf_purification",
    "display_name": "预览 DXF 净化",
    "risk": "read_only",
    "requires_approval": false,
    "input_types": ["review_task"],
    "output_types": ["artifact", "finding"]
  },
  {
    "id": "export_production_dxf",
    "display_name": "导出生产 DXF",
    "risk": "external_side_effect",
    "requires_approval": true,
    "input_types": ["artifact", "check_run", "approval"],
    "output_types": ["artifact"]
  }
]
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 动作类型 ID |
| `display_name` | `string` | 显示名 |
| `risk` | `string` | `read_only` / `reversible_write` / `external_side_effect` |
| `requires_approval` | `boolean` | 是否必须先有审批记录 |
| `input_types` | `string[]` | 输入对象类型 ID，至少一个 |
| `output_types` | `string[]` | 输出对象类型 ID，至少一个 |

`risk` 与 `requires_approval` 是独立字段：只读动作也可以要求审批，写动作也可以不要求。

---

## 数据目录

数据源：仓库 `data/catalog/*.yaml`，按文件名排序后加载。登记层只描述数据集，不返回对象实例或抽取正文。

### `GET /api/v1/data-catalog`

**响应** `200`（当前登记 8 个数据集：raw 3、staging 2、curated 3）

```json
{
  "dataset_count": 8,
  "by_stage": {
    "curated": 3,
    "raw": 3,
    "staging": 2
  },
  "datasets": [
    {
      "schema_version": "1.0",
      "id": "shenbian.client_requirements.raw.v1",
      "stage": "raw",
      "status": "available_local",
      "description": "沈变需求、调研和优先级原始资料。",
      "source": {
        "kind": "client_data_drop",
        "path": "client-data/client-requirements"
      },
      "format": "mixed_documents",
      "media_types": [
        "text/markdown",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ],
      "pipeline": null,
      "governance": {
        "sensitivity": "customer_confidential",
        "immutable": true,
        "git_tracked": false
      },
      "observed": {
        "file_count": 4,
        "markdown_count": 2,
        "docx_count": 1,
        "xlsx_count": 1
      }
    }
  ]
}
```

当前已登记 ID：

| `id` | `stage` | 说明 |
| --- | --- | --- |
| `shenbian.client_requirements.raw.v1` | `raw` | 需求与调研原文 |
| `shenbian.client_requirements.curated.v1` | `curated` | 可追溯的业务需求实体、关系、范围和图谱视图 |
| `cad.capabilities.staging.v1` | `staging` | THCAD V24 与 AutoCAD 2024 的宿主隔离原子能力扫描与 enrichment |
| `cad.capabilities.curated.v1` | `curated` | 仅含 THCAD V24 的历史原子能力快照 |
| `cad.capabilities.curated.v2` | `curated` | THCAD V24 与 AutoCAD 2024 的综合原子对象数据集（默认） |
| `shenbian.general_knowledge.raw.v1` | `raw` | 标准类知识资料 |
| `shenbian.thcad_extraction.staging.v1` | `staging` | THCAD 抽取旁数据库事实 |
| `shenbian.transformer_drawings.raw.v1` | `raw` | 变压器二维 CAD 原始交付 |

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `dataset_count` | `integer` | 登记条数 |
| `by_stage` | `object` | 按 `stage` 计数，键已排序 |
| `datasets[].schema_version` | `string` | 目录条目 schema |
| `datasets[].id` | `string` | 数据集 ID，全局唯一 |
| `datasets[].stage` | `string` | `raw` / `staging` / `curated` |
| `datasets[].status` | `string` | 运营状态，自由字符串 |
| `datasets[].description` | `string` | 说明 |
| `datasets[].source.kind` | `string` | 来源种类 |
| `datasets[].source.path` | `string \| null` | 仓库相对路径（如客户 drop） |
| `datasets[].source.dataset_id` | `string \| null` | 派生自哪个数据集 |
| `datasets[].source.import_path` | `string \| null` | 导入路径 |
| `datasets[].format` | `string` | 逻辑格式名 |
| `datasets[].media_types` | `string[]` | MIME 列表 |
| `datasets[].pipeline` | `string \| null` | 生成该数据集的管线路径 |
| `datasets[].governance.sensitivity` | `string` | 敏感级别 |
| `datasets[].governance.immutable` | `boolean` | 是否禁止改写 |
| `datasets[].governance.git_tracked` | `boolean` | 是否进 git |
| `datasets[].observed` | `object` | 观测统计，键不固定 |

`source`、`governance`、`observed` 允许 YAML 中的额外字段一并返回（例如 `governance.ontology_ready`、`observed.note`）。

## 相关

| 文档 | 内容 |
| --- | --- |
| [`backend/README.md`](../../backend/README.md) | 启动与验证 |
| [`ontology/shenbian/v1/ontology.yaml`](../../ontology/shenbian/v1/ontology.yaml) | Ontology 源 |
| [`ontology/cad_capabilities/v1/ontology.yaml`](../../ontology/cad_capabilities/v1/ontology.yaml) | CAD 原子能力对象类型契约 |
| [`data/catalog/`](../../data/catalog/) | 数据集登记 YAML |
