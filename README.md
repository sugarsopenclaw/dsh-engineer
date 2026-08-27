# dsh-engineer

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的二次开发仓库。

官方推荐方式：**不改上游源码，二次开发做成独立插件**。本仓库按这个原则拆开：

| 路径 | 职责 |
| --- | --- |
| `harness/` | 上游源码，git submodule，只跟踪、不改 |
| `plugins/` | 我们的插件包（`dsh.bundle`） |
| `patches/` | 本地 `--patch` 叠加层，开发时挂载插件 |
| `client-data/` | 客户原始资料（Source），不进 git |
| `data/` | Data Layer：管线、登记、派生数据集 |
| `ontology/` | Ontology：对象 / 链接 / 动作的类型定义 |
| `backend/` | FastAPI 共享 API 与模型网关，供 Harness 工具按需调用 |
| `frontend/` | 产品 Web 前端，只通过后端真实 API 使用业务数据 |
| `specs/` | SDD 规格 |
| `docs/` | 本仓库文档（调研、开发笔记）；规格仍写 `specs/` |
| `other-projects/` | 参考项目。晓量冻结快照在本仓 `other-projects/xiaoliang/`（钉 `94720be`），不跟原仓同步；其余克隆仍只留本机 |
| `dev-test/` | 本机实验 / PoC，不是产品层 |
| `cloud-dev/` | 云开发工作区（Cloud Agent / 远程环境），不是产品层 |
| `.env` / `.env.example` | 全仓库环境变量，只认根目录这一份 |

产品主循环是 `DSH Web → Harness Agent/沈变插件 → 本地 THCAD`。Agent 在需要共享知识、规则、模型能力或业务 CRUD 时调用 `backend/`；客户原文和已有 CAD 抽取数据继续作为插件与算法开发资料使用。不要在 `client-data/` 里加工文件。基础分层见 [`specs/001-platform-layers/spec.md`](specs/001-platform-layers/spec.md)，当前纵向切片见 [`specs/003-harness-deepseek-gateway/`](specs/003-harness-deepseek-gateway/)，DSH 可扩展范围与项目边界见 [`docs/dev/2026-08-26-DSH官方扩展面与沈变插件化边界.md`](docs/dev/2026-08-26-DSH官方扩展面与沈变插件化边界.md)。

上游目前不接受外部 PR；插件应作为独立包开发，发布时给 GitHub 仓库打上 `dsh-plugin` topic。

## 日常

```powershell
# 第一次，或别人刚 clone 本仓库之后
git submodule update --init --recursive
Copy-Item .env.example .env   # 只认仓库根这一份；之后改键必须与 .env.example 同时改，不要提交 .env

cd harness
pnpm install
pnpm run build
```

从 `harness/` 启动的 `dsh` 不会自动读仓库根 `.env`。给 dsh 的键请写入当前 shell，或 `$DSH_HOME/.credentials.yaml`。我们自己的前端 / 后端 / 管线一律读根目录 `.env`。

当前项目通过 FastAPI 转发 Harness 的 DeepSeek 对话请求：

```powershell
# 只启动 FastAPI（先自动执行 Alembic migration）；也可双击根目录 start-backend.cmd
.\scripts\start-backend.ps1

# 一键启动 FastAPI + DSH Web；也可以直接双击根目录 start-dev.cmd
.\scripts\start-dev.ps1
```

`start-backend` 只启动后端，不启动 Harness、THCAD、Redis、OSS 或前端；它使用根 `.env`，执行数据库迁移后在前台运行 FastAPI。`start-dev` 会等待 FastAPI 健康后再启动 DSH Web。若 8000 端口上已有健康的本项目后端，它会直接复用；否则会自行启动，并在 DSH 退出时一并关闭。

业务需求图谱前端的完整开发交接提示词见 [`docs/frontend/2026-08-27-业务需求图谱前端开发提示词.md`](docs/frontend/2026-08-27-业务需求图谱前端开发提示词.md)。

前端本体在 `frontend/`（Vite + React + TS + pnpm，独立于 harness 的 workspace）：

```powershell
# 先启动后端（见上），再启动前端开发服务器
cd frontend
pnpm install
pnpm dev        # http://localhost:5173，/api 代理到 http://127.0.0.1:8000
pnpm lint; pnpm test --run; pnpm build
```

原来的分步启动方式仍然可用：

```powershell
# 终端 1
cd backend
uv sync
uv run shenbian-api

# 终端 2：脚本只给该 DSH 子进程设置 DEEPSEEK_BASE_URL，不改 harness 源码
.\scripts\start-harness-via-backend.ps1
```

FastAPI 默认使用仓库根 `.env` 的 `DEEPSEEK_API_KEY` 调用 DeepSeek，并替换 DSH 请求携带的 Bearer。`DEEPSEEK_UPSTREAM_API_KEY` 可作为部署级覆盖；完整认证规则见 [`backend/README.md`](backend/README.md)。

开发中用 `--patch` 挂本地插件（路径按官方要求用绝对路径）：

```powershell
cd harness
pnpm dsh web --patch ..\patches\<your-overlay>.yml
```

不要在 `harness/` 里改文件、不要在 submodule 里 commit。需要改能力就写插件。

## 同步上游

`harness/` 跟踪 `master`。开发者预览阶段上游变动很快，建议按 commit 钉死，确认插件还能跑再升级：

```powershell
git submodule update --remote harness
cd harness
pnpm install
pnpm run build
cd ..
git add harness
git commit -m "chore: bump upstream deepseek-harness"
```

若 submodule 被误改：

```powershell
git -C harness status
git -C harness restore .
git submodule update --init harness
```
