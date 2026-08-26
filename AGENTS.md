# AGENTS.md

本仓库是 DeepSeek Harness 的下游二次开发，按官方推荐方式：**不改上游源码，能力都做成独立插件**。

`harness/AGENTS.md` 是上游给官方仓库贡献者看的，不适用于本仓库。改能力时只看本文件。

## 目录

| 路径 | 写什么 |
| --- | --- |
| `client-data/` | 客户原文 drop（只收不改，不进 git） |
| `data/` | Data Layer：登记、管线、派生数据集 |
| `ontology/` | 对象 / 属性 / 链接 / 动作的类型定义 |
| `backend/` | Harness 的共享 API 与模型网关：按需提供 CRUD、知识/数据分发和基础设施适配；只读根 `.env` |
| `plugins/` | 我们的插件（`dsh.bundle`） |
| `patches/` | 本地 `--patch` 叠加层 |
| `harness/` | 上游 submodule，只读 |
| `specs/` | SDD：先规格后实现 |
| `docs/` | 本仓库文档（调研、开发笔记等）；规格仍写 `specs/` |
| `other-projects/` | 对本工程有帮助的参考项目，只参考。晓量冻结快照进本仓 `other-projects/xiaoliang/`（钉 `94720be`），不要 `git pull` 原仓、不要当 submodule；`pi` / `grok-build` 等仍只留本机 |
| `dev-test/` | 本机实验 / PoC（如 AutoCAD 抽取器）。不是产品层，不进 `plugins/` / `data/pipelines/` |
| `cloud-dev/` | 云开发工作区（Cloud Agent / 远程环境）。不是产品层，不进 `plugins/` / `data/pipelines/` |
| `.env` / `.env.example` | 全仓库环境变量，只认根目录这一份；两份键集合必须一致；`.env` 不进 git |

分层边界见 `specs/001-platform-layers/`。不要在 `client-data/` 写派生文件（含 CAD `.bak`、抽取 JSON）；不要把数据集或对象实例放进 `plugins/`。`dev-test/` 和 `cloud-dev/` 的编译产物和抽取输出不进 git。

## 硬性约定

- 不要修改、提交 `harness/` 里的任何文件。需要改行为就在 `plugins/` 写插件，用 `patches/` 挂进去。
- 不要给 `deepseek-ai/deepseek-harness` 提 PR。上游目前不收外部 PR。
- 开发时从 `harness/` 跑源码：`pnpm dsh web --patch <绝对路径的 overlay>`。插件 `name` 也要用绝对路径。
- 升级上游用 submodule 钉 commit，先构建并确认插件仍可用，再提交 `harness` 指针。
- 环境变量只认仓库根的 `.env` 和 `.env.example`。不要在 `plugins/`、`data/`、`harness/`、未来的前端/后端目录再放一份。Agent 直接读写 `.env`，不要因为怕泄露而回避或改口只动 example；密钥由维护者轮换。增删或改键名时两份必须同时改，键集合保持一致（`.env` 填真值，`.env.example` 留空或假值）。不要提交 `.env`。前端只暴露 `VITE_*`；密钥不加这个前缀。加载器（Vite `envDir`、dotenv、Compose `env_file`）指向仓库根，不要复制文件。
- DSH 只读调用目录和 `$DSH_HOME` 的 `.env`，不往上找。当前从 `harness/` 启动时读不到仓库根 `.env`。若让 dsh 加载根 `.env`，文件里不能有 `DSH_*`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL`、`BROWSER`、代理类键，否则拒启。生产用同一套键名，值由主机注入。
- FastAPI 代码只放 `backend/`，使用 uv 和 `src/` 布局。领域模型不得依赖 FastAPI/SQLAlchemy/Redis/OSS SDK；`ontology/` 仍只放类型契约，客户数据导入仍只走 `data/pipelines/`。
- 产品主循环在本地 DeepSeek Harness Agent：插件组织任务并调用 THCAD 与 FastAPI。FastAPI 不代替 Agent，也不把“上传并对象化整张 DWG”设为本地 CAD 操作的前置条件。

## 跟上游一起长

上游是开发者预览，**没有插件 ABI / 磁盘格式承诺**（rc 之间会话存储都可能不兼容）。社区已经踩过：内核一升，再装一份 `@deepseek-ai/dsh-tools`、或按 row id 覆盖官方配置的插件会挂——轻则工具调度 Symbol 对不上整轮炸，重则一个 bundle 失败拖死整个 profile。

我们靠这几条把兼容税压住，跟官方 seam 一起长，不跟内核抢实现：

- 只走公开 seam：`ctx.*` 服务、文档里的事件、`defineTool` / `register`。禁止 import `@deepseek-ai/dsh-*` 内部文件；这些包一律 peer，版本对齐当前 `harness/`，插件里不得再装一份。
- `patches/` 只追加我们自己的 loader 行。不要按 row id 覆盖官方配置——DSH patch 是整块替换，不是深合并。
- 插件 `apply` 失败会让整个 profile 起不来。加载期不要抛；不要依赖 session / SQLite 的磁盘布局。
- 升 `harness/` 只动 submodule 指针：先 build，再把 `plugins/` 挂上去跑通。坏了修插件，不要改 `harness/` 源码迁就。

日常命令见 `README.md`。
