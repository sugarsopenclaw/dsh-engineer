# 晓量后端服务（FastAPI）

当前后端已经从单文件探活服务扩展为可继续开发的业务后端。它现在承担以下职责：

- 机构与用户鉴权
- 只读 skill 市场版本包发布
- 客户端安装包托管与下载统计
- 桌面项目包、会话消息归档、自制 skill 归档与复杂文档云解析
- 个人提示词模板鉴权、CRUD 与私有 OSS 镜像存储

## 项目归档与云文档解析

桌面端在登录、绑定项目目录、刷新项目索引及对话结束后，以低并发后台任务同步项目；同步失败只记录日志，不阻断项目工作台或 Agent 对话。

- 文件内容不经过 FastAPI 请求体：后端登记清单并签发私有 OSS `PUT` URL，客户端直传后再调用确认接口。
- 归档关系为 `project_archives -> project_archive_files` 与 `project_archive_conversations -> project_archive_messages -> project_archive_message_attachments`。
- 自制 skills 不进市场，但仍按账号归档：`user_skill_archives -> user_skill_archive_entries / user_skill_archive_files`，客户端扫全局 agent workspace 的 `skills/` 后签发私有 OSS `PUT` URL 直传。
- PDF、Word、Excel、PowerPoint 等复杂文档必须先归档，再由 `/project-archive/documents/analyze` 生成短期 OSS `GET` URL 调用 `qwen-doc-turbo`。
- 兜底链按格式排序：PDF 走 `qwen-doc-turbo` → `qwen3.8-max` PDF 理解（同样只吃签名 URL，流式读取以避开 300 秒首包上限）→ `qwen-long`；其余格式仍是 `qwen-doc-turbo` → `qwen-long`。每次尝试都重新签发 `GET` URL，避免重试期间签名过期。
- qwen-long 兜底会把同一 OSS 对象临时上传到百炼 Files API，等待解析完成后调用 `qwen-long`，最终删除百炼临时文件。
- DashScope 返回的 `code` 与 `Retry-After` 会被解析并分类为限流、额度不足、瞬时或永久错误：只有限流和瞬时错误才退避重试，参数错误等直接进下一条兜底。仅当所有兜底通道都确实被限流时，接口才返回 429 `project_document_provider_throttled`；其余失败按真实原因逐条返回 502。
- 文档解析按 `PROJECT_DOCUMENT_MAX_CONCURRENCY` 限制活跃任务，并最多接受 `PROJECT_DOCUMENT_MAX_QUEUE_DEPTH` 个同步等待者；队列满或等待超时会返回明确的本地容量错误。配置加载会校验 `SERVER_THREAD_POOL_SIZE`，为登录、计费等同步接口至少保留 40 个 worker。
- 成功解析按文件 SHA、读取要求、解析策略和模型配置缓存；Markdown、JSON、CSV、代码和普通文本仍由桌面 harness 本地只读。

生产部署前先执行：

```powershell
psql $env:DATABASE_URL -f scripts/migrations/2026-08-09-project-archive-and-document-cloud.sql
psql $env:DATABASE_URL -f scripts/migrations/2026-08-12-pi-session-archive.sql
psql $env:DATABASE_URL -f scripts/migrations/2026-08-13-user-prompt-templates.sql
psql $env:DATABASE_URL -f scripts/migrations/2026-08-17-user-skill-archive.sql
```

并配置 `.env.example` 中的 `PROJECT_ARCHIVE_*`、`PROJECT_DOCUMENT_*`、OSS 和 DashScope 参数。

Electron 桌面端应用内自动更新仍由 GitHub Releases 管理；产品下载页的 Windows 安装包由后端从 `CLIENT_RELEASE_ASSETS_DIR` 指定目录直接返回。

## 目录结构

```text
dev/backend/
├── app/
│   ├── api/
│   │   ├── dependencies.py
│   │   ├── router.py
│   │   └── routes/
│   ├── core/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── errors.py
│   │   └── security.py
│   ├── models/
│   ├── repositories/
│   ├── schemas/
│   └── services/
├── main.py
├── requirements.txt
├── docker-compose.yml
└── .env.example
```

## 快速运行

### 方式一：本地 sqlite 快速启动

```powershell
cd dev/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

默认会在 `AUTO_CREATE_TABLES=true` 时自动建表，并在当前目录生成 `xiaoliang_backend.db`。

仓库里也已直接生成一份本地可用的 `.env`，你可以在此基础上继续补邮件接码、对象存储等配置。

如果要直接初始化 PostgreSQL 数据库与当前所有表，可以运行：

```powershell
python scripts/init_postgres.py
```

发布新客户端后，若要登记 skill 包版本元数据（用于设置页“检查 skill 更新”），运行：

```powershell
python scripts/register_skill_release.py --skill-pack-version 0.5.0 --skill-pack-checksum <sha256> --release-notes "skill 规则更新"
```

### 方式二：本地 PostgreSQL 容器

```powershell
cd dev/backend
docker compose up -d
Copy-Item .env.example .env
```

然后把 `.env` 中的 `DATABASE_URL` 改成：

```text
DATABASE_URL=postgresql+psycopg://xiaoliang:xiaoliang@127.0.0.1:5432/xiaoliang
```

再启动服务：

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 当前接口

### 基础接口

- `GET /health`
	返回：`{"ok": true}`

### Auth 接口

- `POST /auth/register`
	请求体：

```json
{
	"organization_name": "示例机构",
	"email": "owner@example.com",
	"password": "password123",
	"display_name": "负责人"
}
```

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /users/me`

### Skill 接口

- `GET /skills/releases/check`
- `GET /skills/releases/pack`

Skill 市场是后端到客户端的单向发布通道，不接收用户投稿。当前保留 `frustum-box-foundation` 截头体算量 skill。用户自制 skills 仍只在桌面端创建和编辑，同时由客户端后台归档到私有 OSS（`/user-skills/archive/*`），与市场投稿无关。

退役清单、三分类来源与安全边界见 [SKILLS_ARCHITECTURE.md](SKILLS_ARCHITECTURE.md)。

### Client Release 接口

- `GET /client-releases/latest`
- `GET /client-releases/download/{platform}`

把 `release-manifests/latest.json` 中 `artifacts[].file_name` 对应的安装包放到 `CLIENT_RELEASE_ASSETS_DIR` 指定目录即可下载。默认目录是 `./storage/client-releases`。

Auth 接口统一返回：

```json
{
	"success": true,
	"data": {}
}
```

错误时返回：

```json
{
	"success": false,
	"error": "错误消息",
	"message": "错误代码"
}
```

## 当前实现边界

- 已实现：机构、用户、自注册开户、登录、刷新令牌、退出登录、当前用户查询。
- 已实现：skill 包版本检查与只读文件下发（`/skills/releases/check`、`/skills/releases/pack`）。
- 已实现：自制 skill 账号级后台归档（`/user-skills/archive/*`）。
- 已实现：客户端下载页 manifest 读取、本地安装包下载、下载事件统计。
- 尚未实现：真实文件上传流、邮件验证码、Alembic 迁移脚本、独立 reviewer 后台。

## 下一步

1. 接入真实邮件验证码 / 接码服务，补注册验证与找回密码。
2. 把客户端安装包与项目归档存储完善到生产对象存储。
3. 为 skill 市场发布包补签名轮换、回滚与灰度通道。
