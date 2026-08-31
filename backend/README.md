# shenbian-api

本地 DeepSeek Harness Agent 的共享 API 与模型网关。Harness/沈变插件负责理解用户任务并调用 THCAD；FastAPI 按需提供模型转发、知识和规则读取、业务 CRUD 以及 PostgreSQL/Redis/OSS 适配。

当前第一条链路只解决一件事：Harness 的 DeepSeek 模型请求先经过本服务，再转发到 DeepSeek 上游。它覆盖主对话的 OpenAI-compatible Chat Completions，以及 Harness `web_search` 使用的 Anthropic-compatible Messages 接口；不要求上传当前 DWG，也不参与本地 CAD 图元读写。

## 启动

后端只读取仓库根目录 `.env`，不要在本目录创建第二份环境文件。

从仓库根目录只启动后端（会先执行 Alembic migration）：

```powershell
.\scripts\start-backend.ps1
```

也可以直接双击根目录 `start-backend.cmd`。该入口不会启动 Harness、THCAD、Redis、OSS 或前端。

分步启动仍然可用：

```powershell
cd backend
uv sync
uv run shenbian-api
```

默认监听 `127.0.0.1:8000`。开发时可直接运行：

```powershell
uv run uvicorn shenbian_api.app_factory:create_app --factory --reload
```

## 数据库迁移

后端用 Alembic 管理 PostgreSQL 表结构，连接仍只读取根 `.env`：

```powershell
cd backend
uv run alembic upgrade head
```

业务需求、CAD 原子能力和拓扑语义实例位于 `ontology` schema；表结构由后端迁移管理。客户需求只由 [`data/pipelines/shenbian_client_requirements/`](../data/pipelines/shenbian_client_requirements/) 导入，能力目录只由 [`data/pipelines/cad_capabilities/`](../data/pipelines/cad_capabilities/) 导入。拓扑语义由 Pi 在局部精读现场通过幂等接口登记；API 启动时不会偷偷重建或重灌数据。

当前 Harness 模型链路：

- `POST /api/v1/llm/deepseek/chat/completions`
- `POST /api/v1/llm/deepseek/anthropic/v1/messages`

已有的共享读取与诊断接口继续保留，但不构成 DWG 本地任务的前置流程：

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `GET /api/v1/ontology`
- `GET /api/v1/ontology/actions`
- `GET /api/v1/data-catalog`
- `GET /api/v1/business-requirements/graph`
- `GET /api/v1/business-requirements/{requirement_id}`
- `GET /api/v1/cad-capabilities/atoms`
- `GET /api/v1/cad-capabilities/graph-atoms`
- `GET /api/v1/cad-capabilities/atoms/{atom_id}`
- `GET /api/v1/cad-capabilities/facets`
- `POST /api/v1/topology-semantics/observations`
- `POST /api/v1/topology-semantics/descriptions`
- `POST /api/v1/topology-semantics/match`
- `GET /api/v1/topology-semantics/semantics`
- `GET /api/v1/topology-semantics/semantics/{description_id}`
- `GET /api/v1/topology-semantics/patterns`
- `GET /api/v1/topology-semantics/patterns/{pattern_id}`
- `GET /api/v1/topology-semantics/observations/{observation_id}`
- `GET /api/v1/topology-semantics/semantics/search?query=法兰`
- `GET /docs`

业务需求图谱接口的参数、响应类型、坐标语义和前端联调顺序见 [`docs/backend/business-requirements-graph-api.md`](../docs/backend/business-requirements-graph-api.md)。CAD 原子能力接口见 [`docs/backend/cad-capabilities-api.md`](../docs/backend/cad-capabilities-api.md)。

## 拓扑语义与局部精读记录

`delegate_thcad_bom_close_reading` 每完成一个序号段，就登记一条 `TopologyObservation` 和一条视觉 `SemanticDescription`；父 Agent 给出最终用户解释时，再追加一条可同时关联本次多个局部拓扑的主模型描述。记录包含：

- 实例级 `graph_hash`、消除平移/旋转/镜像/统一比例后的 `shape_hash`、保留实际尺寸的 `metric_hash`；
- 选中图元的句柄、世界坐标路径、图层/线型/颜色和局部范围；
- 完整 plot、去干扰 plot、确定性 sidecar 的本地引用与 SHA-256；
- BOM 序号段和 capability 21 同定义实例覆盖证据；
- 视觉模型结构化理解、原始输出/Session 引用和主模型最终解释。

Pi 先把请求写入 review bundle 内的不可变 `topology-semantics-outbox/`，再尝试本接口。同步回执位于 `.pi/runtime/thcad-reviews/semantic-sync/`，不会在 review bundle 定稿后改写其完整性清单。后端暂不可用不影响 THCAD 只读取证；恢复后在 Pi TUI 执行 `/thcad-semantic-sync` 重放。规格见 [`specs/015-topology-semantic-library/`](../specs/015-topology-semantic-library/)。

## 验证

```powershell
uv run pytest
uv run ruff check .
```

## Harness 接入

DSH 自带的 DeepSeek 适配器会请求 `{DEEPSEEK_BASE_URL}/chat/completions`。从仓库根运行：

```powershell
.\scripts\start-harness-via-backend.ps1
```

脚本把当前 DSH 子进程的两个 DeepSeek 地址指向本地网关：

```text
http://127.0.0.1:8000/api/v1/llm/deepseek
http://127.0.0.1:8000/api/v1/llm/deepseek/anthropic/v1
```

默认由 FastAPI 持有上游密钥：根目录 `.env` 的 `DEEPSEEK_API_KEY` 会替换 Harness 请求中的 Bearer，再发送给 DeepSeek。可选项：

1. `DEEPSEEK_UPSTREAM_API_KEY`：非空时优先于 `DEEPSEEK_API_KEY`，用于部署级覆盖。
2. `SHENBIAN_GATEWAY_API_KEY`：非空时校验 Harness 发来的 Bearer，适合后端不只监听本机的部署；本机开发默认留空。
3. 两个服务端上游 Key 都为空时，保留兼容行为，转发 Harness 自己的 Bearer。

模型请求体、工具定义、thinking 字段和 SSE 数据帧均不做业务改写。当前规格见 [`specs/003-harness-deepseek-gateway/`](../specs/003-harness-deepseek-gateway/)。

## 图像输入

DSH 已内置 DeepSeek 官方视觉链路。在 Web 模型选择器中选用
`deepseek-v4-flash-vision-exp` 后，可在输入框附加 JPEG、PNG、GIF 或 WebP：

1. DSH 将图片保存为本机内容寻址附件，Session 只记录附件引用；
2. 官方 `llm-deepseek` 适配器在请求时读取附件，并生成
   `image_url.url = data:<media-type>;base64,...`；
3. FastAPI 将包含图片的 Chat Completions 请求按原始字节转发，不解析图片正文；
4. DeepSeek 返回的 SSE 沿原链路交给本地 Agent。

Base64 data URL 是 DeepSeek 官方支持的本地图片传入方式，因此当前交互链路不需要把图片上传 OSS。已有公网或 OSS 签名 URL 的调用方也可以按官方 `image_url` 结构直接提交；网关同样透明转发。网关请求体上限为 48 MiB，与 DeepSeek 当前官方限制一致；DSH 自身仍会执行更严格的附件准入和历史图片预算。
