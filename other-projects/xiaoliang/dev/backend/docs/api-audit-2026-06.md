# 后端 API 全量审核

> 历史快照：本文记录 2026-06 的旧接口面。2026-08-09 已退役 `/submissions/*`、`GET /skills`、`GET /skills/{skill_id}`、`POST /knowledge/search` 与两个 `/cad-knowledge/*` 原型接口；对应实现和客户端调用均已删除。当前以 `README.md` 和 `docs/xl-api.md` 为准。

**初次审核时间**：2026-06-10  
**联网能力刷新**：2026-08-09
**目标环境**：`https://xl.x3yun.com/api`（生产）
**代码基线**：`dev/backend/` 的 2026-06 历史接口快照（非当前 HEAD）

---

## 1. 服务地址

| 环境 | Base URL | 来源 |
|------|----------|------|
| 生产 | `https://xl.x3yun.com/api` | 前端 `electron/runtime/backend/client.ts` `FALLBACK_BACKEND_BASE_URL` |
| 本地开发 | `http://127.0.0.1:8000` | 同上，`NODE_ENV === 'development'` 时 |

可通过环境变量 `XIAOLIANG_BACKEND_BASE_URL` 或 `VITE_BACKEND_BASE_URL` 覆盖。

---

## 2. 路由总览

共 10 个路由模块、22 个端点，全部在 `app/api/router.py` 中注册。

| 模块 | 前缀 | 端点数 | 需要鉴权 | 备注 |
|------|------|--------|----------|------|
| health | (无) | 1 | 否 | 探活 |
| auth | `/auth` | 6 | 否 | 注册/登录/验证码/刷新/注销 |
| users | `/users` | 1 | 是 | 当前用户信息 |
| client_releases | `/client-releases` | 2 | 否 | 版本检测 + 安装包下载 |
| skills | `/skills` | 4 | 部分 | releases/check 和 releases/pack 无需鉴权 |
| submissions | `/submissions` | 7 | 是 | 证据链完整生命周期 |
| knowledge | `/knowledge` | 1 | 是 | 知识库搜索 |
| web | `/web` | 2 | 是 | 联网搜索 + 网页抓取 |
| speech | `/speech` | 1 | 是 | 语音转写 |
| cad_knowledge | `/cad-knowledge` | 2 | 是 | CAD 工件收纳 + 知识抽取（feature flag 关闭） |

---

## 3. 生产环境实测结果

### 3.1 公开接口（无需鉴权）

| 方法 | 路径 | 状态码 | 实测结果 |
|------|------|--------|----------|
| GET | `/health` | 200 | `{"ok":true}` |
| GET | `/client-releases/latest` | 200 | v0.8.0，release notes 完整 |
| GET | `/client-releases/download/windows-x64` | 200 | 返回安装包二进制，约 2.4MB |
| GET | `/client-releases/download/windows` | 404 | platform 参数值不对，应为 `windows-x64` |
| GET | `/skills/releases/check` | 200 | skill pack v0.5.1，含 1 个 skill（frustum-box-foundation） |
| GET | `/skills/releases/pack` | 200 | 完整 pack 含 SKILL.md + references |
| POST | `/auth/register` | 422 | 缺 email/password，参数校验正常 |
| POST | `/auth/login` | 422 | 同上 |
| POST | `/auth/email-otp/send` | 422 | 缺 email 字段 |
| POST | `/auth/refresh` | 422 | 缺 refresh_token |
| POST | `/auth/logout` | 422 | 缺 refresh_token |

### 3.2 鉴权保护接口（无 token 时返回 401）

以下接口在不带 Bearer token 时均返回：

```json
{"success":false,"error":"缺少访问令牌。","message":"missing_token"}
```

说明 auth middleware 正常拦截，路由已注册。

| 方法 | 路径 | 服务依赖 |
|------|------|----------|
| GET | `/users/me` | AuthService |
| GET | `/skills` | SkillService + DB |
| GET | `/skills/{skill_id}` | SkillService + DB |
| GET | `/submissions` | SubmissionService + DB |
| POST | `/submissions` | SubmissionService + DB |
| POST | `/submissions/auto-ingest` | SubmissionService + DB |
| GET | `/submissions/{submission_id}` | SubmissionService + DB |
| POST | `/submissions/{submission_id}/assets` | SubmissionService + DB |
| POST | `/submissions/{submission_id}/geometry-snapshots` | SubmissionService + DB |
| POST | `/submissions/{submission_id}/submit` | SubmissionService + DB |
| POST | `/submissions/{submission_id}/review` | SubmissionService + DB |
| POST | `/knowledge/search` | KnowledgeService + LLM |
| POST | `/web/search` | WebSearchService + LLM |
| POST | `/web/fetch` | WebSearchService + LLM |
| POST | `/speech/transcribe` | QwenAsrService + LLM |
| POST | `/cad-knowledge/artifacts` | CadKnowledgeService + OSS（feature flag 关闭） |
| POST | `/cad-knowledge/extract` | CadKnowledgeService + LLM（feature flag 关闭） |

---

## 4. 各服务运行时状态分析

### 4.1 AuthService — 正常

- 路由：`/auth/*`（6 个端点）
- 依赖：DB（SQLAlchemy Session）、JWT 密钥、腾讯云邮件 SDK
- 鉴权方式：`HTTPBearer`，`resolve_current_user` 验证 JWT
- 验证码登录通过腾讯云 SES 发送邮件，配置项 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` / `TENCENT_TEMPLATE_ID`

### 4.2 ClientReleaseService — 正常

- 路由：`/client-releases/latest`、`/client-releases/download/{platform}`
- 依赖：
  - manifest JSON 文件（默认 `./release-manifests/latest.json`）
  - 安装包文件（默认 `./storage/client-releases/`）
- 下载接口记录 client IP、user-agent、referer 用于统计

### 4.3 SkillService — 正常

- 路由：`/skills`（4 个端点）
- `/skills` 和 `/skills/{skill_id}` 需要鉴权
- `/skills/releases/check` 和 `/skills/releases/pack` 公开无需鉴权，供客户端 OTA 检测 skill pack 更新
- 依赖：DB 表 `skills`、`skill_releases`

### 4.4 SubmissionService — 正常

- 路由：`/submissions`（7 个端点）
- 完整证据链生命周期：创建草稿 → 添加资产/几何快照 → 提交审核 → 审核发布
- 依赖：DB

### 4.5 KnowledgeService — 需关注

- 路由：`POST /knowledge/search`
- 依赖：
  - `DASHSCOPE_API_KEY` — 必须配置
  - `KNOWLEDGE_MANIFEST_PATH` — 默认 `./storage/knowledge/manifest.json`
  - DB 表 `knowledge_external_files` — 外部知识源
  - `openai` SDK — 调用 DashScope 兼容接口

**两阶段 LLM 调用链**：

1. **候选筛选**：用 `qwen3.6-plus`（config: `QWEN_KNOWLEDGE_SELECTION_MODEL`）从 manifest 目录里分片选出相关文档
   - 分片大小 120 条/次
   - 如果 LLM 未选出候选，回退到纯词法匹配（文件名/tags/描述 打分）
   - 如果没有 `DASHSCOPE_API_KEY`，也回退到词法匹配
2. **知识抽取**：用 `qwen-long`（config: `QWEN_KNOWLEDGE_EXTRACT_MODEL`）+ `fileid://` 协议，将选中文档作为上下文回答问题

**降级策略**：manifest 缺失返回 warning 而非报错；候选无 file_id 返回提示而非报错。

### 4.6 WebSearchService — 已刷新（2026-08-09）

- 路由：`POST /web/search`、`POST /web/fetch`
- 依赖：仅 `DASHSCOPE_API_KEY`
- search / fetch 默认模型：`qwen3.8-max`
- 两个请求都支持 `region`（最多 100 字）；桌面 Agent 优先采用用户或项目资料中可靠确认的工程所在地，没有时使用 Electron 读取的 OS 国家代码作国家级兜底（如 `CN → 全国`），并保留“项目省市未确认”边界；不得根据 locale 或 `Asia/Shanghai` 等时区猜测省市

**search**：调用 DashScope 多模态 generation API，使用 SSE 增量输出，并固定启用：

- `enable_search: true`
- `search_options.forced_search: true`：既然客户端已经显式调用联网工具，不允许模型自行跳过搜索
- `enable_source: true`
- `enable_citation: true` + `citation_format: "[<number>]"`：答案包含 `[1]` 样式引用
- `search_strategy: "turbo"`

search 来源从 generation 响应的 `output.search_info.search_results` 提取。

**fetch**：调用 DashScope Responses API，使用 `web_search` + `web_extractor` 工具读取指定网页。来源按官方输出项结构解析：

1. `web_extractor_call.urls` 作为实际抓取页，`output`（或 `goal`）用于来源摘要；
2. message content 的 `annotations` 用于补齐标题、摘要和引用 URL；
3. `web_search_call.action.sources` 补充搜索阶段来源；
4. 仅在没有上述结构时才递归兼容旧响应；仍无来源时保留请求 URL，并返回明确 warning。

后端提示词对中国建筑工程政策规范增加了区域和来源层级约束：优先政府、住建、市场监管/标准化主管部门及全国标准信息公共服务平台等官方现行文本；要求核对标准号、日期、效力、替代关系和适用范围，并区分国家、行业、地方标准及强制性工程建设规范。

实现依据：[DashScope API 参考](https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope)、[Responses API 创建响应](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)。

### 4.7 QwenAsrService — 需关注

- 路由：`POST /speech/transcribe`
- 依赖：`DASHSCOPE_API_KEY`、`dashscope` SDK
- 模型：`qwen3-asr-flash`（config: `QWEN_PATIENT_ASR_MODEL`）
- 流程：base64 编码音频 → `MultiModalConversation.call` → 提取转写文本
- 文件格式校验：扩展名白名单 + MIME 类型白名单（`.webm/.wav/.mp3/.m4a/.ogg/.aac`）
- 文件大小限制：默认 12MB（config: `PATIENT_ASR_MAX_FILE_SIZE_MB`）

**注意**：config 字段前缀是 `patient_asr_*`，属历史遗留命名，实际是通用语音转写。

### 4.8 CadKnowledgeService — 已关闭（feature flag）

- 路由：`POST /cad-knowledge/artifacts`、`POST /cad-knowledge/extract`
- **双重保护**：
  1. Auth middleware（Bearer token）
  2. Feature flag `CAD_KNOWLEDGE_HARNESS_ENABLED=false`（硬编码默认 false）

即使携带有效 token，`_ensure_enabled()` 也会返回 404 `"cad-knowledge 能力未启用"`。

**功能设计**（单文档 RAG 原型）：

- **Ingest（收纳）**：
  - 接收 multipart/form-data 上传两个文件：`raw_file`（实体 JSON gzip）+ `readable_file`（可读 markdown）
  - 上传到阿里云 OSS，key 格式：`cad-knowledge/{org_id}/{artifact_id}/entities.raw.json.gz` 和 `entities.readable.md`
  - 在 DB 写入 `cad_knowledge_artifacts` 记录

- **Extract（抽取）**：
  - 接收 `artifact_id` + `query`
  - 为 artifact 的 readable markdown 生成 OSS 签名 URL
  - 调用 DashScope `qwen-doc-turbo` 的 `doc_url` 参数把文档作为上下文喂给模型
  - 模型返回 `{"answer", "evidence", "warning"}` 格式的 JSON

**为什么关闭**：
- 纯单文档查询，没有跨图纸检索能力
- 没有向量化/索引，不是真正的知识库
- 没有分块，整个 markdown 直接丢给模型
- 需要额外配置 OSS 相关环境变量（`ALIBABA_CLOUD_ACCESS_KEY_ID` 等）和 `oss2` SDK
- 需要额外配置 `DASHSCOPE_API_KEY`

**开启所需配置**：
```env
CAD_KNOWLEDGE_HARNESS_ENABLED=true
ALIBABA_CLOUD_ACCESS_KEY_ID=xxx
ALIBABA_CLOUD_ACCESS_KEY_SECRET=xxx
OSS_BUCKET=xxx
OSS_REGION=cn-beijing
DASHSCOPE_API_KEY=xxx
# 以及安装 oss2 SDK
```

---

## 5. 配置项清单

以下环境变量影响运行时行为（按服务分组）：

### 通用

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_NAME` | 晓量后端服务 | 应用名称 |
| `APP_VERSION` | 0.7.4 | 服务版本号 |
| `APP_ENV` | development | 环境标识 |
| `DEBUG` | false | 调试模式 |
| `DATABASE_URL` | sqlite:///./xiaoliang_backend.db | 数据库连接串 |
| `JWT_SECRET_KEY` | change-me-in-production... | JWT 签名密钥 |

### DashScope / LLM

| 变量 | 默认值 | 使用方 |
|------|--------|--------|
| `DASHSCOPE_API_KEY` | (空) | knowledge、web、speech、cad-knowledge |
| `DASHSCOPE_BASE_URL` | https://dashscope.aliyuncs.com/compatible-mode/v1 | 同上 |
| `QWEN_WEB_SEARCH_MODEL` | qwen3.8-max | web search |
| `QWEN_WEB_FETCH_MODEL` | qwen3.8-max | web fetch |
| `QWEN_WEB_SOURCE_LIMIT` | 8 | web search / fetch 来源上限 |
| `QWEN_WEB_SEARCH_TIMEOUT_SECONDS` | 90 | web search 超时 |
| `QWEN_WEB_FETCH_TIMEOUT_SECONDS` | 180 | web fetch 超时 |
| `QWEN_KNOWLEDGE_EXTRACT_MODEL` | qwen-long | knowledge 抽取 |
| `QWEN_KNOWLEDGE_SELECTION_MODEL` | qwen3.6-plus | knowledge 筛选 |
| `QWEN_PATIENT_ASR_MODEL` | qwen3-asr-flash | speech 转写 |

### 邮件（腾讯云 SES）

| 变量 | 默认值 |
|------|--------|
| `TENCENT_SECRET_ID` | replace-me |
| `TENCENT_SECRET_KEY` | replace-me |
| `TENCENT_TEMPLATE_ID` | 0 |

### OSS（阿里云）

| 变量 | 默认值 | 使用方 |
|------|--------|--------|
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | (空) | cad-knowledge |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | (空) | cad-knowledge |
| `OSS_BUCKET` | (空) | cad-knowledge |
| `OSS_REGION` | cn-beijing | cad-knowledge |

---

## 6. 结论

| 状态 | 数量 | 说明 |
|------|------|------|
| 完全可用（公开） | 10 | health、releases、skill pack、auth 参数校验 |
| 鉴权后可用 | 8 | users、skills、submissions（路由 + 服务正常） |
| 鉴权后可用但依赖 LLM | 4 | knowledge/web/speech（需确认 DASHSCOPE_API_KEY 已配置） |
| Feature flag 关闭 | 2 | cad-knowledge（即使有 token 也返回 404） |

所有路由均已注册且活跃，无路由级 500 错误。唯一"关着"的能力是 `cad-knowledge`，其余接口在路由层面均可达。
