# CAD 原子能力查询 API

本文是 CAD 原子能力的前端联调契约。接口默认读取 `cad.capabilities.curated.v2`；仅含 THCAD V24 的 `cad.capabilities.curated.v1` 仍可通过 `dataset_id` 显式查询。接口只从 PostgreSQL `ontology` schema 读取真实数据，不读取 staging JSONL，也不提供运行时 mock。

## 数据对象

默认数据集包含 10 个库存快照和 334,049 个 `CapabilityAtom`：

- `surface`：技术面，当前实际值为 `com`、`dotnet`、`lisp`、`command`、`native`；
- `observed_host_ids`：已观测宿主，当前实际值为 `thcad-v24` 或 `autocad-2024`；前端不得写成封闭枚举；
- `atom_kind`：方法、getter、setter、字段读写、命令、宏、原生导出等技术原子形态；
- `classification_status`：`classified`、`deferred`、`failed` 或 `pending`；
- `operation_kinds`：可多选的读取、计算、创建、编辑、删除等操作分类；
- `domain_tags`：开放的领域标签；
- `member`、`source_artifact`、`declaring_symbol` 和 `provenance`：扫描器保存的完整技术事实。

当前分类把属性 setter 和可写字段表示为 `atom_kind=property_set|field_write`，操作分类通常为 `edit`；API 不把它们擅自改写成一个尚不存在的 `write` 分类。原生 PE 原子保持 `classification_status=pending` 和空 `operation_kinds`，因为它们只是未知调用协议的导出线索。

## 接口

### `GET /api/v1/cad-capabilities/atoms`

分页返回原子摘要，默认按 `atom_id` 稳定排序。

查询参数：

- `dataset_id`：默认 `cad.capabilities.curated.v2`；显式传 `cad.capabilities.curated.v1` 可查询旧快照；
- `surface`：技术面；
- `observed_host_id`：宿主观测 ID，例如 `thcad-v24`；
- `atom_kind`：原子种类；
- `classification_status`：分类状态；
- `operation_kind`：操作类型，例如 `read`、`edit`、`delete`；
- `domain_tag`：开放领域标签；
- `q`：在成员名、完整签名、声明符号全名和摘要中进行不区分大小写的包含查询；
- `limit`：默认 50，范围 1–200；
- `offset`：默认 0。

示例：

```http
GET /api/v1/cad-capabilities/atoms?surface=dotnet&observed_host_id=thcad-v24&operation_kind=read&q=ExplodeGeometry&limit=50&offset=0
```

响应字段：

```json
{
  "schema_version": "1.0",
  "dataset": {
    "dataset_id": "cad.capabilities.curated.v2",
    "schema_version": "1.0",
    "imported_at": "2026-08-28T00:00:00Z",
    "content_sha256": "..."
  },
  "total": 1,
  "items": [
    {
      "atom_id": "cap:dotnet:...",
      "inventory_id": "thcad-v24.dotnet",
      "surface": "dotnet",
      "atom_kind": "method",
      "observed_host_ids": ["thcad-v24"],
      "declaring_symbol_full_name": "...",
      "member_name": "ExplodeGeometry",
      "member_signature": "...",
      "return_type": "...",
      "is_static": false,
      "classification_status": "classified",
      "operation_kinds": ["invoke", "read", "compute"],
      "domain_tags": ["entity", "geometry"],
      "summary": "...",
      "classification_confidence": 0.98
    }
  ],
  "limit": 50,
  "offset": 0
}
```

筛选值是开放字符串。无匹配记录返回 `200`、`total=0`、`items=[]`，不是 404。

### `GET /api/v1/cad-capabilities/graph-atoms`

图谱专用批量通道：一次请求返回筛选后的**全部**原子（v2 全量为 334,049），NDJSON 流式响应，按 `atom_id` 稳定排序。

查询参数与 `/atoms` 的筛选部分相同（`dataset_id`、`surface`、`observed_host_id`、`atom_kind`、`classification_status`、`operation_kind`、`domain_tag`、`q`），**没有** `limit` / `offset`。

响应：

- `200`，`Content-Type: application/x-ndjson`，每行一个最小投影对象：

  ```json
  {"atom_id": "cap:dotnet:...", "surface": "dotnet", "atom_kind": "method", "observed_host_ids": ["thcad-v24"], "member_name": "ExplodeGeometry", "declaring_symbol_full_name": "Teigha.DatabaseServices.Entity", "classification_status": "classified", "operation_kinds": ["invoke", "transform"], "domain_tags": ["entity", "geometry"]}
  ```

  最小投影只含 `atom_id`、`surface`、`atom_kind`、`observed_host_ids`、`member_name`、`declaring_symbol_full_name`、`classification_status`、`operation_kinds`、`domain_tags` 九个字段；签名、参数、证据和摘要继续在点击详情时经 `/atoms/{atom_id}` 获取。
- 响应头：`X-Total-Count`（筛选后总数）、`X-Dataset-Sha256`、`ETag`（绑定数据集内容哈希与筛选条件）、`Cache-Control: private, no-cache`、`Vary: Accept-Encoding`。
- 缓存：带 `If-None-Match` 重新验证，命中返回 `304` 空体；支持浏览器 gzip。不同 `dataset_id` 与筛选条件具有不同 ETag；不用 `immutable`，因为同一 `dataset_id` 重导入后内容可能变化。
- 取消：客户端断开时立即关闭流与数据库连接。

实现说明：v2 入库时在 PostgreSQL 内生成 18 个 gzip 最小投影，按“数据集 + `surface` + `observed_host_id`”和数据集内容哈希失效；例如 AutoCAD `.NET` 投影为 26,778 条、约 1.07 MB，不先加载 v2 全部 334,049 条。后端首次读取后再保留进程内快照，同一分片后续的操作类型、领域标签等筛选在内存完成。当前远程链路实测该分片冷请求 59.6 秒、热请求 2.46 秒；这是实测而非 SLA。带 `q` 的请求还要匹配签名和摘要，仍走 SQL 直连流。当前不把这些不可驱逐的大对象写入 Redis。

### `GET /api/v1/cad-capabilities/atoms/{atom_id}`

返回一个原子的完整属性。除列表字段外，还包括：

- `canonical_key`；
- `source_artifact`；
- `declaring_symbol`；
- 完整 `member.parameters`；
- `provenance` 与技术面原始 `surface_metadata`；
- `semantic_candidates`、`evidence`、`processor`、`processed_at` 和 `notes`。

冒号属于合法路径字符；调用方仍应使用 `encodeURIComponent(atom_id)` 构造 URL。

### `GET /api/v1/cad-capabilities/facets`

返回当前数据集中实际存在的筛选项及全量计数：

```json
{
  "schema_version": "1.0",
  "dataset_id": "cad.capabilities.curated.v2",
  "total_atoms": 334049,
  "surfaces": [
    {"value": "native", "count": 221591},
    {"value": "dotnet", "count": 45641},
    {"value": "com", "count": 30597},
    {"value": "command", "count": 25544},
    {"value": "lisp", "count": 10676}
  ],
  "observed_host_ids": [
    {"value": "autocad-2024", "count": 254500},
    {"value": "thcad-v24", "count": 79549}
  ],
  "atom_kinds": [{"value": "native_export", "count": 221591}],
  "classification_statuses": [
    {"value": "pending", "count": 221591},
    {"value": "classified", "count": 102398},
    {"value": "deferred", "count": 10060}
  ],
  "operation_kinds": [{"value": "read", "count": 36709}],
  "domain_tags": [{"value": "entity", "count": 100}]
}
```

上例的 `atom_kinds`、`operation_kinds` 和 `domain_tags` 只节选一个元素；真实响应返回全部实际值。

前端应以该接口生成筛选器，不维护一份自称完整的本地枚举。

## 错误

- 数据集不存在：`404`，`detail.code=capability_dataset_not_found`；
- 原子不存在：`404`，`detail.code=capability_atom_not_found`；
- PostgreSQL 不可用或数据库结果不符合契约：`503`，`detail.code=postgres_unavailable`；
- 查询参数越界：FastAPI `422`。

错误体不包含数据库地址、SQL、绝对路径或密钥。

## 前端边界

当前返回的是原子对象目录，不是语义关系图。批量加载时应使用聚合、分层加载或 GPU instancing，避免为 334,049 个原子分别创建高开销 DOM/mesh；属性详情仍按需查询。以后有正式 SemanticCapability/IMPLEMENTS 数据后，再另行定义图关系接口。
