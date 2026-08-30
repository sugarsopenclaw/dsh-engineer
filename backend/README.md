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

业务需求和 CAD 原子能力实例位于 `ontology` schema；表结构由后端迁移管理。客户需求只由 [`data/pipelines/shenbian_client_requirements/`](../data/pipelines/shenbian_client_requirements/) 导入，能力目录只由 [`data/pipelines/cad_capabilities/`](../data/pipelines/cad_capabilities/) 导入，API 启动时不会偷偷重建或重灌数据。

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
- `GET /docs`

业务需求图谱接口的参数、响应类型、坐标语义和前端联调顺序见 [`docs/backend/business-requirements-graph-api.md`](../docs/backend/business-requirements-graph-api.md)。CAD 原子能力接口见 [`docs/backend/cad-capabilities-api.md`](../docs/backend/cad-capabilities-api.md)。

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
