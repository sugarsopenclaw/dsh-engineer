# 业务需求图谱可视化 API 契约

> 契约版本：`0.1`  
> 数据集：`shenbian.client_requirements.curated.v1`  
> 状态：**已实现并通过真实 PostgreSQL 验收。** 前端直接调用本文接口。

## 第一版做什么

第一版只把业务需求本身画成图：

- 240 个 `BusinessRequirement` 节点；
- 249 条包含、拆分或复用关系；
- 支持 2D / 3D 切换；
- 点击节点后展示来源证据、适用范围、候选验收条件和待确认问题；
- 前端可按 `origin_kind`、`requirement_kind`、是否原子需求、是否待确认等字段做本地筛选。

来源证据、范围值、验收条件和待确认问题第一版不单独画成节点，避免第一屏从 240 个点膨胀成五百多个点。它们仍是独立业务对象，通过节点详情接口返回；以后可以增加多实体图谱视图。

## 接口状态

本文记录已投入联调的首版字段形状。

| 能力 | 当前状态 |
| --- | --- |
| PostgreSQL `ontology` schema | 已完成 |
| 业务需求数据导入 | 已完成 |
| 240 个需求与 249 条关系 | 已落库 |
| 初始 2D / 3D 坐标规则 | 本文确定 |
| 图谱 HTTP 查询接口 | 已完成 |
| 前端真实接口联调 | 可以开始 |

启动后端后可在 `http://127.0.0.1:8000/docs` 查看 Swagger/OpenAPI。接口已用根 `.env` 指向的真实数据库验证：240 个节点、249 条关系、201 个原子需求、20 个一级需求。

## 坐标是什么意思

坐标是 `GraphView` 的展示状态，不是 `BusinessRequirement` 的业务属性。同一个需求以后在“业务层级图”“能力复用图”“Agent 运行成效图”中可以拥有完全不同的位置。

第一版只给距离原点一种业务含义：

> **离原点越近，越贴近客户原始需求表达；离原点越远，越偏向规范化组织或领域拆分。**

角度、同一圈内的先后和 3D 高度暂时只用于稳定地摊开节点，不表达重要性、优先级、成功率或组织归属。

### 贴近原始需求的等级

| `source_proximity_rank` | 节点 | 含义 |
| --- | --- | --- |
| `0` | 根节点 `BR-000` | 视图原点和业务入口；它是总括性锚点，不等于客户逐字原话 |
| `1` | `origin_kind=customer_stated` | 直接来自客户资料的表达，最靠近原点 |
| `2` | `origin_kind=normalized` | 对客户表达做了命名或组织规范化 |
| `3` | `origin_kind=domain_decomposition` | 为开发、运行和验收而进行的领域拆分 |

`source_proximity_rank` 是离散语义等级。`derived_min_depth` 是需求层级深度，二者不是一回事。

### 初始布局 `initial-semantic-v1`

初始布局必须可复现：同一数据集、同一布局版本和同一维度下刷新页面，节点不能随机跳位置。

布局半径采用下面的首版规则：

```text
BR-000:
  radius = 0

其他节点:
  radius = 180 * source_proximity_rank
         + 55 * max(derived_min_depth - 1, 0)
```

单位只是渲染单位，不是毫米或任何 CAD 坐标。

角度规则：

1. 20 个一级需求按关系的 `display_order` 均匀分配扇区；
2. 子需求留在所属一级需求的扇区内；
3. 同级节点按 `display_order`、再按 `requirement_id` 稳定排序；
4. 被多个父节点复用的节点只保留一个位置，以最早的层级父关系确定主扇区，其余关系正常连线。

这部分只是“先排开”，没有额外业务含义。

### 2D

2D 使用笛卡尔坐标：

```text
x = radius * cos(theta)
y = radius * sin(theta)
z = 0
```

### 3D

3D 仍保持欧氏距离等于 `radius`。`phi` 由 `requirement_id + layout_version` 的稳定哈希映射到 `[-22.5°, 22.5°]`，只用于上下摊开：

```text
x = radius * cos(theta) * cos(phi)
y = radius * sin(theta) * cos(phi)
z = radius * sin(phi)
```

因此 2D 和 3D 都满足“越贴近客户原始需求，越靠近原点”。当前不能把正 Z、负 Z、高度差解释成任何业务事实。

## 接口一：取得完整图谱

```http
GET /api/v1/business-requirements/graph
```

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dataset_id` | `string` | `shenbian.client_requirements.curated.v1` | 数据集版本 |
| `view_id` | `string` | `GV-BUSINESS-DEFAULT` | 图谱视图 |
| `dimensions` | `2 \| 3` | `2` | 返回 2D 或 3D 初始坐标 |
| `layout_version` | `string` | `initial-semantic-v1` | 布局规则版本 |

第一版一次返回全部 240 个节点和 249 条关系，不分页。这个规模更适合前端一次加载后搜索、筛选和切换视角，也避免筛选后丢失边的端点。

### TypeScript 契约

```ts
export type GraphDimensions = 2 | 3;

export type RequirementOriginKind =
  | "customer_stated"
  | "normalized"
  | "domain_decomposition";

export type RequirementRelationKind =
  | "contains_requirement"
  | "decomposes_to"
  | "reuses_requirement";

export interface BusinessRequirementsGraphResponse {
  schema_version: "1.0";
  dataset: {
    dataset_id: string;
    schema_version: string;
    imported_at: string;
    content_sha256: string;
  };
  view: {
    graph_view_id: string;
    name: string;
    description: string;
    dimensions: GraphDimensions;
    layout_version: string;
    position_source: "generated:initial-semantic-v1" | "stored" | "mixed";
    coordinate_system: "cartesian";
    origin_meaning: string;
    persisted: boolean;
  };
  counts: {
    nodes: number;
    edges: number;
    atomic_requirements: number;
    level_one_requirements: number;
    needs_confirmation: number;
  };
  nodes: BusinessRequirementGraphNode[];
  edges: BusinessRequirementGraphEdge[];
}

export interface BusinessRequirementGraphNode {
  id: string;
  node_kind: "business_requirement";
  label: string;
  description: string | null;
  requirement_kind: string;
  origin_kind: RequirementOriginKind;
  atomic: boolean;
  customer_visible: boolean;
  needs_confirmation: boolean;
  lifecycle_status: string;
  priority_order: number | null;
  derived_min_depth: number;
  source_proximity_rank: 0 | 1 | 2 | 3;
  position: {
    x: number;
    y: number;
    z: number;
    radius: number;
    source: "generated:initial-semantic-v1" | "stored";
    locked: boolean;
  };
  summary: {
    direct_evidence_count: number;
    acceptance_criterion_count: number;
    open_question_count: number;
    scope_value_ids: string[];
  };
}

export interface BusinessRequirementGraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_kind: RequirementRelationKind;
  display_order: number;
  rationale: string | null;
  origin_kind: string;
}
```

### 缩略响应示例

数值仅示范字段形状；正式坐标由 `initial-semantic-v1` 统一生成。

```json
{
  "schema_version": "1.0",
  "dataset": {
    "dataset_id": "shenbian.client_requirements.curated.v1",
    "schema_version": "1.0",
    "imported_at": "2026-08-27T12:00:00Z",
    "content_sha256": "<sha256>"
  },
  "view": {
    "graph_view_id": "GV-BUSINESS-DEFAULT",
    "name": "沈变客户需求业务图谱",
    "description": "首版业务需求层级与复用关系视图",
    "dimensions": 2,
    "layout_version": "initial-semantic-v1",
    "position_source": "generated:initial-semantic-v1",
    "coordinate_system": "cartesian",
    "origin_meaning": "距离越小，越贴近客户原始需求表达",
    "persisted": false
  },
  "counts": {
    "nodes": 240,
    "edges": 249,
    "atomic_requirements": 201,
    "level_one_requirements": 20,
    "needs_confirmation": 69
  },
  "nodes": [
    {
      "id": "BR-000",
      "node_kind": "business_requirement",
      "label": "智能审核和辅助设计变压器工程图纸",
      "description": "统一承载两份原始需求源中的审图、图纸转换、受控改图与二维转三维需求。",
      "requirement_kind": "portfolio",
      "origin_kind": "normalized",
      "atomic": false,
      "customer_visible": true,
      "needs_confirmation": false,
      "lifecycle_status": "discovery",
      "priority_order": null,
      "derived_min_depth": 0,
      "source_proximity_rank": 0,
      "position": {
        "x": 0,
        "y": 0,
        "z": 0,
        "radius": 0,
        "source": "generated:initial-semantic-v1",
        "locked": true
      },
      "summary": {
        "direct_evidence_count": 0,
        "acceptance_criterion_count": 0,
        "open_question_count": 4,
        "scope_value_ids": [
          "SV-ORG-SB",
          "SV-DISC-MECH",
          "SV-DOM-TRANSFORMER",
          "SV-ROLE-REVIEW",
          "SV-SYS-THCAD"
        ]
      }
    },
    {
      "id": "BR-A01",
      "node_kind": "business_requirement",
      "label": "审核图纸上的尺寸标注",
      "description": null,
      "requirement_kind": "business_outcome",
      "origin_kind": "customer_stated",
      "atomic": false,
      "customer_visible": true,
      "needs_confirmation": false,
      "lifecycle_status": "discovery",
      "priority_order": 1,
      "derived_min_depth": 1,
      "source_proximity_rank": 1,
      "position": {
        "x": 180,
        "y": 0,
        "z": 0,
        "radius": 180,
        "source": "generated:initial-semantic-v1",
        "locked": false
      },
      "summary": {
        "direct_evidence_count": 2,
        "acceptance_criterion_count": 0,
        "open_question_count": 2,
        "scope_value_ids": []
      }
    }
  ],
  "edges": [
    {
      "id": "RR-BR-000-BR-A01",
      "source_node_id": "BR-000",
      "target_node_id": "BR-A01",
      "relation_kind": "contains_requirement",
      "display_order": 1,
      "rationale": null,
      "origin_kind": "domain_modeling"
    }
  ]
}
```

上述计数来自当前 `v1` 数据集；后端不能把它们硬编码进接口。

## 接口二：取得节点详情

```http
GET /api/v1/business-requirements/{requirement_id}
```

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dataset_id` | `string` | `shenbian.client_requirements.curated.v1` | 数据集版本 |

### TypeScript 契约

```ts
export interface BusinessRequirementDetailResponse {
  dataset_id: string;
  requirement: Omit<BusinessRequirementGraphNode, "position"> & {
    verification_method: string | null;
    source_emphasis: string | null;
  };
  relations: {
    parents: BusinessRequirementGraphEdge[];
    children: BusinessRequirementGraphEdge[];
  };
  aliases: Array<{
    requirement_alias_id: string;
    alternate_name: string;
    alias_kind: string;
    note: string | null;
  }>;
  evidence: Array<{
    requirement_source_link_id: string;
    link_kind: string;
    source_evidence_id: string;
    evidence_kind: string;
    locator: Record<string, string | number>;
    verbatim_text: string;
    source_document: {
      source_document_id: string;
      name: string;
      source_kind: string;
      authority_rank: number;
    };
  }>;
  scopes: Array<{
    requirement_scope_link_id: string;
    applicability: string;
    inherit_to_descendants: boolean;
    dimension: {
      scope_dimension_id: string;
      name: string;
    };
    value: {
      scope_value_id: string;
      name: string;
      status: string;
    };
  }>;
  acceptance_criteria: Array<{
    acceptance_criterion_id: string;
    criterion_statement: string;
    criterion_status: string;
    threshold: unknown | null;
    measurement_method: string;
    origin_kind: string;
  }>;
  open_questions: Array<{
    open_question_id: string;
    question: string;
    blocking_kind: string;
    status: string;
  }>;
}
```

详情接口用于右侧抽屉或浮层，不用于初次绘图。`verbatim_text` 属于客户资料，只在用户主动打开节点详情时显示。

## 错误响应

新接口统一使用 FastAPI 的 `detail` 外壳：

```json
{
  "detail": {
    "code": "requirement_not_found",
    "message": "Requirement BR-UNKNOWN was not found in the selected dataset."
  }
}
```

| HTTP | `code` | 场景 |
| --- | --- | --- |
| `404` | `dataset_not_found` | 数据集不存在 |
| `404` | `graph_view_not_found` | 视图不存在 |
| `404` | `requirement_not_found` | 需求不存在 |
| `422` | FastAPI 参数校验错误 | `dimensions` 等参数非法 |
| `503` | `postgres_unavailable` | PostgreSQL 暂时不可用 |

错误消息不能包含数据库连接串、源文件绝对路径或客户文档正文。

## 前端联调顺序

1. 用上面的 TypeScript 类型建立真实 API client；
2. 请求完整 240 个节点，完成缩放、平移、悬停、选择和关系高亮；
3. 2D / 3D 都消费相同的 `nodes`、`edges`，只切换 `dimensions` 与相机；
4. 节点筛选先在前端完成：数据量只有 240；
5. 点击节点后请求详情接口并实现证据、范围、验收条件和待确认问题抽屉；
6. 显示布局图例：“越靠近中心，越贴近客户原始需求”；
7. 不要把正负 Z、角度、节点颜色擅自解释成优先级或质量评分。

开发时建议让前端开发服务器把 `/api` 代理到 `http://127.0.0.1:8000`，不要为了本机联调先扩大 CORS。当前客户数据只适合本机或受控内网环境；远程部署的鉴权另开规格。

## 后端实现时的数据映射

| API 内容 | PostgreSQL 表 |
| --- | --- |
| 数据集元数据 | `ontology.dataset_builds` |
| 节点 | `ontology.requirement_nodes` |
| 边 | `ontology.requirement_relations` |
| 坐标记录 | `ontology.graph_layout_positions` |
| 图谱视图 | `ontology.graph_views`、`ontology.graph_view_filters` |
| 节点来源 | `ontology.requirement_source_links`、`ontology.source_evidence`、`ontology.source_documents` |
| 别名 | `ontology.requirement_aliases` |
| 适用范围 | `ontology.requirement_scope_links`、`ontology.scope_values`、`ontology.scope_dimensions` |
| 验收条件 | `ontology.acceptance_criteria` |
| 待确认问题 | `ontology.open_question_requirement_links`、`ontology.open_questions` |

数据库中的 `graph_layout_positions.x/y/z` 当前为空。后端首版按 `initial-semantic-v1` 生成数值并返回，`view.persisted=false`；等我们观察并认可排布后，再决定是否把某个布局版本持久化。前端不应直接连接 PostgreSQL。

## 第一版明确不做

- 不把 capability、logic、AgentRun、Review 提前混进这张业务需求图；
- 不保存用户拖拽位置；
- 不把布局坐标当成需求事实；
- 不做服务端分页、全文搜索或复杂图查询；
- 不根据七张样图或当前需求集硬编码不可演进的业务枚举；
- 不在前端暴露源文件磁盘路径、数据库信息或密钥。

后续真正产生 `Requirement ↔ Logic ↔ Capability ↔ AgentRun ↔ Review` 连接后，应新增图谱视图和布局版本，而不是悄悄改变 `initial-semantic-v1` 的含义。
