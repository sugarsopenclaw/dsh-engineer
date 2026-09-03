# AGENTS.md

本仓库以 Pi Coding Agent 为 Agent 与 TUI 基座，按上游公开扩展方式二次开发：**不改上游源码，沈变能力都放在独立 Pi package**。

`pi/AGENTS.md` 与 `harness/AGENTS.md` 都是上游仓库的贡献说明，不适用于本仓库。改本项目能力时只看本文件。DeepSeek Harness 代码暂留作迁移期兼容，不再承载新功能。

## 目录

| 路径 | 写什么 |
| --- | --- |
| `client-data/` | 客户原文 drop（只收不改，不进 git） |
| `data/` | Data Layer：登记、管线、派生数据集 |
| `ontology/` | 对象 / 属性 / 链接 / 动作的类型定义 |
| `backend/` | Pi extension 按需调用的共享 API：提供 CRUD、知识/数据分发和基础设施适配；只读根 `.env` |
| `frontend/` | 产品 Web 前端：只通过 `backend/` 的 `/api/v1` 契约读取或操作业务数据，不直连数据库、不读取客户原文 |
| `.pi/` | 项目级 Pi 设置；`runtime/` 是默认隔离状态目录并忽略，不放密钥或可提交运行缓存 |
| `plugins/` | 我们的 Pi package；当前入口是 `plugins/shenbian-pi/` |
| `pi/` | Pi Coding Agent 上游 submodule，只读，固定到已验证 release commit |
| `harness/` / `patches/` | DeepSeek Harness 迁移期遗留，只维护已有兼容，不新增业务能力 |
| `specs/` | SDD：先规格后实现 |
| `docs/` | 本仓库文档（调研、开发笔记等）；规格仍写 `specs/` |
| `other-projects/` | 对本工程有帮助的参考项目，只参考。晓量冻结快照进本仓 `other-projects/xiaoliang/`（钉 `94720be`），不要 `git pull` 原仓、不要当 submodule；`grok-build` 等其余克隆仍只留本机 |
| `dev-test/` | 本机实验 / PoC（如 AutoCAD 抽取器）。不是产品层，不进 `plugins/` / `data/pipelines/` |
| `cloud-dev/` | 云开发工作区（Cloud Agent / 远程环境）。不是产品层，不进 `plugins/` / `data/pipelines/` |
| `.env` / `.env.example` | 全仓库环境变量，只认根目录这一份；两份键集合必须一致；`.env` 不进 git |

分层边界见 `specs/001-platform-layers/`。产品主循环是 `Pi TUI / 未来 GUI → 沈变 Pi package → 本地 THCAD + backend/`。不要在 `client-data/` 写派生文件（含 CAD `.bak`、抽取 JSON）；不要把数据集或对象实例放进 `plugins/`。`dev-test/` 和 `cloud-dev/` 的编译产物和抽取输出不进 git。

## 开发心法

- 这是复杂且持续演进的工程。优先保持能力开放、链路可组合、失败可观察，不因臆测风险预先加入无事实依据的阈值、缩减、降级或能力封锁。
- 约束必须来自真实接口契约、已复现故障或明确安全边界。能由实际执行结果验证的事情交给真实执行链路验证；发现人为限制阻碍真实样本时，删除根因，不再叠加绕行限制。

## THCAD 开发前先查能力面

开发 THCAD 的抽取、识图、审图、绘图或自动化能力前，先读 [`docs/dev/2026-08-27-THCAD-V24-能力面总索引.md`](docs/dev/2026-08-27-THCAD-V24-能力面总索引.md)，再按问题进入对应文档：

- [`docs/dev/2026-08-24-THCAD全量实体数据能拿到什么.md`](docs/dev/2026-08-24-THCAD全量实体数据能拿到什么.md)：现有整图抽取的实际覆盖、样图证据和明确拿不到的业务参数；
- [`docs/thcad-extract-fields/00-completeness.md`](docs/thcad-extract-fields/00-completeness.md)：当前抽取 JSON 的键级完整性及逐字段目录；
- [`docs/dev/2026-08-27-THCAD-V24-DotNet公开能力盘点.md`](docs/dev/2026-08-27-THCAD-V24-DotNet公开能力盘点.md)：进程内 .NET 类型、属性、计算方法以及创建、修改等公开入口；
- [`docs/dev/2026-08-27-THCAD-V24-COM-Automation能力盘点.md`](docs/dev/2026-08-27-THCAD-V24-COM-Automation能力盘点.md)：32/64 位 COM 对象模型、ProgID、天河业务组件和运行时激活结果；
- [`docs/dev/2026-08-27-THCAD-V24-LISP与命令能力盘点.md`](docs/dev/2026-08-27-THCAD-V24-LISP与命令能力盘点.md)：LISP 函数、菜单宏、当前会话命令符号和已加载模块；
- [`docs/dev/2026-08-27-THCAD-V24-原生BRX-ARX与PE导出能力盘点.md`](docs/dev/2026-08-27-THCAD-V24-原生BRX-ARX与PE导出能力盘点.md)：原生模块、PE 导出线索及当前是否具备可编译公开 SDK。

把上述人类盘点转换为 Agent 可遍历的原子能力数据时，遵守 [`specs/005-cad-capability-catalog/`](specs/005-cad-capability-catalog/) 和 [`data/pipelines/cad_capabilities/`](data/pipelines/cad_capabilities/)：原始 JSONL 必须由反射/类型库/源码/运行时扫描器确定性生成，Agent 只写独立 enrichment，不得从 Markdown 手抄成员或改写原子。分阶段 Goal 提示词见 [`docs/dev/2026-08-27-CAD原子能力目录-Goal分段提示词.md`](docs/dev/2026-08-27-CAD原子能力目录-Goal分段提示词.md)。首批 JSONL 未经人工确认前不要建立 capability 数据库实例表。

不要把“当前 JSON 没有某个键”解释成“THCAD 没有这个能力”；字段库存回答“抽取器已经保存什么”，其他能力面回答“还可以主动调用什么”。采用入口前区分“元数据中存在、当前运行时可达、业务语义已经样图验证”三层。盘点与复现实验脚本放在 [`dev-test/visualstudionetframework/probes/`](dev-test/visualstudionetframework/probes/)；发现新入口或验证新的前置条件后，同步更新对应能力文档和总索引。现有盘点基于本机 THCAD V24 安装，不把七张样图或单一安装版本硬编码成所有图纸、所有版本的普遍事实。

## 硬性约定

- 不要修改或提交 `pi/`、`harness/` 里的任何文件。新的 Agent、TUI 与 THCAD 编排能力只写在 `plugins/shenbian-pi/`，数据和对象实例仍不进插件。
- Pi 扩展只使用文档公开入口、事件和 UI API。禁止 import `pi/packages/**/src` 或其他内部文件；Pi 核心包只声明为 `peerDependencies: "*"`，插件不得再安装或打包一份运行时。
- 从仓库根运行 `scripts/bootstrap-pi.ps1`、`scripts/start-pi.ps1`、`scripts/verify-pi.ps1`。不要绕过项目 `.pi/settings.json` 另造一套启动配置。
- Pi 上游只用 release tag 或完整 commit 固定。升级必须走 `scripts/update-pi.ps1 -Ref <tag-or-commit>`，通过官方全量构建、插件类型检查、CLI/TUI 和模型 smoke 后，才提交 `pi` gitlink 与兼容性改动。
- `.pi/settings.json` 只登记可信的一方或已审计、已固定版本 package。`.pi/git/`、`.pi/npm/`、`.pi/runtime/` 等运行缓存不进 git；未知第三方 extension/package 不得自动批准。产品启动默认隔离用户全局 Pi Home，并关闭用户全局 skill 发现；个人调试只有显式传 `-UseUserPiHome`、`-UseUserSkills` 才分别合并这些资源。
- 环境变量只认仓库根的 `.env` 和 `.env.example`。不要在 `plugins/`、`data/`、`harness/`、未来的前端/后端目录再放一份。Agent 直接读写 `.env`，不要因为怕泄露而回避或改口只动 example；密钥由维护者轮换。增删或改键名时两份必须同时改，键集合保持一致（`.env` 填真值，`.env.example` 留空或假值）。不要提交 `.env`。前端只暴露 `VITE_*`；密钥不加这个前缀。加载器（Vite `envDir`、dotenv、Compose `env_file`）指向仓库根，不要复制文件。
- Pi 启动脚本把根 `.env` 注入当前子进程且不打印值。生产仍用同一套键名，由主机注入；不要把密钥写进 `.pi/settings.json`、主题或 extension 源码。
- FastAPI 代码只放 `backend/`，使用 uv 和 `src/` 布局。领域模型不得依赖 FastAPI/SQLAlchemy/Redis/OSS SDK；`ontology/` 仍只放类型契约，客户数据导入仍只走 `data/pipelines/`。
- 产品前端代码只放根目录 `frontend/`。生产运行时不得用 mock、fixture 或随机数据替代真实 API；测试替身只能存在于测试代码中。前端不直连 PostgreSQL/Redis/OSS，不读取 `client-data/`，也不把客户正文持久化到浏览器存储。
- 产品主循环在本地 Pi Agent：沈变 package 组织任务并调用 THCAD 与 FastAPI。FastAPI 不代替 Agent，也不把“上传并对象化整张 DWG”设为本地 CAD 操作的前置条件。
- Pi extension 与 Agent 具有本机系统权限。仅在可信项目中运行一方 package；THCAD 写操作必须另设工作副本、预览、审批和复验边界，不能因 TUI 基座可运行就默认开放。

## 跟上游一起长

把 Pi 核心内部、会话磁盘布局和未文档化实现都视为不稳定面。我们靠以下约束降低升级成本：

- 优先级固定为：公开 extension/theme/package seam → 官方 TUI 组件与 tool renderer → SDK/RPC 独立宿主 → 最小短期 fork。前一层能完成就不进入后一层。
- extension 顶层只做注册，不在加载期启动 THCAD、网络或长生命周期进程；资源在 `session_start` 建立，在 `session_shutdown` 释放，失败时给出可恢复提示。
- 自定义 TUI 使用 `setHeader`、`setFooter`、`setWidget`、`setStatus` 和公开组件，不复制官方 TUI 源码。未来 GUI 通过 SDK/RPC 嵌入，同样复用沈变业务 package，而不是把 GUI 逻辑塞进 Pi core。
- 每次升级只移动 `pi` submodule 指针并同步 `scripts/pi-baseline.psd1`。审阅 release notes 后执行 build、verify、真实 PTY TUI 和最小模型调用；不通过就修外置 package 或回退 gitlink。
- 若公开 seam 确实缺失，先写 ADR 说明业务必要性、兼容成本与退出条件，并优先向上游提出通用 seam。只有无法等待时才维护最小、可重放、短生命周期补丁，产品代码仍不得进入 `pi/`。
- `harness/` 与 `patches/` 仅供既有迁移任务复现；不要再往这条旧路径增加能力。

日常命令见 `README.md`。
