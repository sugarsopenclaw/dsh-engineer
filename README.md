# dsh-engineer

面向沈变图纸审查的本地 Agent 工程。当前基座已经从 DeepSeek Harness 切换为 [Pi Coding Agent](https://github.com/earendil-works/pi)：保留官方 CLI/TUI，把品牌界面、业务命令、THCAD 工具和审图编排放在仓库自己的 Pi package 中。

核心原则是：**固定上游，不改上游；优先使用公开扩展面，升级靠可重复门禁。** DeepSeek Harness 相关目录暂留作迁移期兼容，不再承载新功能。

## 架构

| 路径 | 职责 |
| --- | --- |
| `pi/` | Pi 官方源码，git submodule，固定到已验证 release commit，只读 |
| `.pi/` | 项目级 Pi 设置；默认隔离状态写入被忽略的 `.pi/runtime/` |
| `plugins/shenbian-pi/` | 沈变 Pi package：TUI、THCAD 机械/视觉子代理、01–21 工具契约与证据投影 |
| `scripts/*-pi.ps1` | 安装、构建、启动、验证与上游升级门禁 |
| `client-data/` | 客户原始资料，只收不改，不进 git |
| `data/` | Data Layer：登记、管线、派生数据集 |
| `ontology/` | 对象、属性、链接、动作的类型契约 |
| `backend/` | Pi 工具按需调用的 FastAPI 共享 API、知识/数据分发和基础设施适配 |
| `frontend/` | 产品 Web 前端，只通过 `backend/` 的真实 `/api/v1` 契约访问业务数据 |
| `harness/` / `patches/` | DeepSeek Harness 迁移期遗留，不新增业务能力 |
| `specs/` / `docs/` | SDD 规格与调研、开发文档 |
| `other-projects/xiaoliang/` | 晓量冻结参考快照；只参考，不与原仓同步 |
| `dev-test/` / `cloud-dev/` | 本机 PoC 与云开发工作区，不是产品层 |

产品主循环是：

```text
Pi TUI（未来也可接 GUI）
  → plugins/shenbian-pi
  → 本地 THCAD + backend/
  → 证据、问题、审批与交付结果
```

晓量当前是把 Pi SDK 嵌入 Electron GUI；这里第一阶段保留官方 TUI 并做公开扩展。两条路线可以共享 Pi 运行时和沈变业务能力，但不复制晓量的 GUI 壳层。

## 第一次运行

前置条件是 Git、PowerShell 和 Node.js `>= 22.19.0`。脚本会验证版本和上游固定点。

```powershell
git submodule update --init pi

# 仅当根目录还没有 .env 时执行；全仓只认根目录这一份
Copy-Item .env.example .env

# 可选：中国网络下只对当前 PowerShell 使用 npm 镜像
$env:npm_config_registry = "https://registry.npmmirror.com"

.\scripts\bootstrap-pi.ps1
.\scripts\build-thcad-agent-bridge.ps1
.\start-pi.cmd
```

`bootstrap-pi.ps1` 会按 `pi/package-lock.json` 安装依赖、构建官方 workspace、生成模型目录，再运行本项目兼容性验证。第一次打开 TUI 时 Pi 会要求确认项目信任；只对确定可信的本仓库批准。

启动脚本在子进程内加载根 `.env`，只报告加载数量，不打印任何值。它默认把 `PI_CODING_AGENT_DIR` 指向被忽略的 `.pi/runtime/`，并用 `--no-skills` 关闭用户全局 skill 自动发现；若 `plugins/shenbian-pi/skills/` 存在，则只显式加载这个受控目录。这样可避免个人 package、设置、会话或 Agent Skills 让团队运行结果漂移。需要临时使用个人资源时可显式运行：

```powershell
# 使用个人 ~/.pi/agent 中的设置、package 与会话
.\scripts\start-pi.ps1 -UseUserPiHome

# 额外允许 ~/.agents/skills 等用户 skill 自动发现
.\scripts\start-pi.ps1 -UseUserSkills

# 两者都启用
.\scripts\start-pi.ps1 -UseUserPiHome -UseUserSkills
```

个人扩展也拥有本机权限，不属于产品验证基线。确定要供团队使用的社区 package 应先审计源码，再以准确版本或 git ref 登记到项目 `.pi/settings.json`。不要把密钥写进设置或 extension 源码。

## 当前可用的 Pi 二开

- 沈变主题、中文 Header、阶段 widget 和运行状态；
- `/shenbian-status`：查看当前模型、会话、项目与信任状态；
- `/shenbian-ui`：在沈变界面与原生 Pi 界面之间切换；
- `/thcad-doctor`：只读检查独立 .NET Host、活动 THCAD 与当前图；
- `/thcad-reviews`：查看最近 THCAD 运行包，或用 `/thcad-reviews verify <run-id>` 校验；
- `delegate_thcad_mechanical`：主 Agent 将自包含图纸任务交给 fresh 机械子 Agent，child 只使用 THCAD 01–21 和有界 artifact 查询；
- `delegate_thcad_visual_overview`：按 capability 02 图框从 THCAD 生成整图 PNG，交给固定 DeepSeek Vision child 判断是否足以宏观导航；
- `delegate_thcad_bom_close_reading`：按 04 序号段对 BOM 构件做成对局部出图、拓扑组织和机械/变压器语义精读，省略序号时覆盖当前图全部可解析 BOM；
- 项目级模型范围固定为三项 DeepSeek 模型，默认 `deepseek-v4-flash`、`high` thinking；
- Pi package 使用官方公开入口，Pi 核心依赖全部是 `peerDependencies: "*"`，不会带入第二份运行时。

THCAD 链路采用“COM 控制面 + 进程内 .NET 数据/计算面”：PowerShell 只附着 `thcad.exe` 并发送命令，01–21 始终在 CAD 主线程读取当前 Database。父 Agent 还可用 side-DB 项目文字索引检索业务词、打开/切换命中图纸，再进入 BOM 精读。由工具新打开的客户原图强制只读；用户已经可写打开的原图会明确保留为用户现场而不伪报只读，复制和保存仍只允许落 `.pi/runtime/thcad-workspace/`。视觉概览复用 02 图框的 `PNGOUT`；BOM 精读则用 `SetWindowToPlot` 原生窗口 Plot（不移动当前视口）与 11 世界坐标去干扰重绘成对供图。完整 child Session、raw events、视觉输入、父 Session 快照和内容寻址 artifact 只写本机 `.pi/runtime/thcad-reviews/`。

本地 review 命令：

```powershell
.\scripts\thcad-review.ps1 list 10
.\scripts\thcad-review.ps1 verify <run-id>
.\scripts\thcad-review.ps1 export-candidates
```

## 验证

日常静态与 CLI 验证：

```powershell
.\scripts\verify-pi.ps1
.\scripts\test-thcad-pi-integration.ps1
```

查看 DeepSeek 模型而不启动交互会话：

```powershell
.\scripts\start-pi.ps1 --approve --offline --list-models deepseek
```

做一次最小真实模型调用：

```powershell
.\scripts\start-pi.ps1 --approve --provider deepseek --model deepseek-v4-flash `
  --thinking off --no-session --no-tools --print "只回复 PI_OK"
```

涉及 TUI API、按键、焦点或渲染的改动，还要实际运行 `start-pi.cmd`，检查 extension/theme 加载提示、`/shenbian-status`、`/shenbian-ui` 和退出清理。THCAD 链路先在空闲图纸上执行 `/thcad-doctor`，再向主 Agent 提出一个窄任务；纯 `--print` 不能替代 PTY 验证。

## 跟随 Pi 上游

当前验证基线记录在 `scripts/pi-baseline.psd1`，上游固定在 `v0.84.4`。升级不跟踪浮动分支，也不自动提交：

```powershell
# 先确认根仓与 pi/ 中没有需要保留的临时修改，并阅读目标版本 release notes
git status --short
git -C pi status --short

# 只接受 release tag 或完整 40 位 commit
.\scripts\update-pi.ps1 -Ref vX.Y.Z

# 审阅 gitlink、基线和必要的 package 兼容性改动
git diff --submodule=log -- .gitmodules pi scripts/pi-baseline.psd1 plugins/shenbian-pi .pi
```

升级脚本执行以下门禁：拒绝脏 `pi/` → 获取并 detached checkout 目标 → 更新基线 → 安装锁定依赖 → 官方全量构建 → 沈变 package 类型检查 → CLI/TUI 配置验证。之后仍需人工跑一次真实 PTY 和最小 DeepSeek 请求，确认无误再提交。

若升级失败，先修 `plugins/shenbian-pi/` 的公开 API 兼容性，或把干净的 `pi/` 切回脚本报告的旧 commit；不要在 `pi/` 里临时改源码。脚本不会替你 commit，因此失败不会自动进入历史。

## 二开层级

按以下顺序选择实现面，前一层够用就不进入后一层：

1. Pi extension、command、tool、event、theme；
2. 官方 TUI 组件、Header/Footer/Widget 和 tool renderer；
3. 未来 GUI 使用 Pi SDK 或 RPC 嵌入运行时；
4. 只有公开 seam 确实缺失且业务不能等待时，才写 ADR 并维护最小、短期 fork。

进入第 4 层前必须说明：缺失的通用 seam、对上游提议、长期 rebase 成本、退出条件和替代方案。即使确需 fork，沈变业务代码仍留在外置 package，补丁只打开最小通用接缝。

Pi extension、skill 与 Agent 拥有本机系统权限，Pi 本身不是权限沙箱。产品启动默认隔离用户全局 Pi Home 和 skill 发现，只加载项目明确登记的可信资源；THCAD 写操作必须另设工作副本、预览、审批和复验边界。

详见 [`specs/009-pi-coding-agent-foundation/spec.md`](specs/009-pi-coding-agent-foundation/spec.md) 与 [`docs/dev/2026-08-29-Pi-Coding-Agent-上游友好二开方案.md`](docs/dev/2026-08-29-Pi-Coding-Agent-上游友好二开方案.md)。官方参考：[Pi 文档](https://pi.dev/docs/latest)、[Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)、[TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md)。

## 后端与 Web 前端

Pi 基座不改变已有数据、Ontology、FastAPI 和 Web 前端边界。

```powershell
# 业务需求图谱一键启动（FastAPI + Vite 前端）；也可双击 start-graph.cmd
# 已运行的后端会被复用；Ctrl+C 退出前端时只会收掉由它拉起的后端。
.\scripts\start-graph.ps1

# 只起 FastAPI；也可双击 start-backend.cmd
.\scripts\start-backend.ps1

# Web 前端
cd frontend
pnpm install
pnpm dev
pnpm lint
pnpm test --run
pnpm build
```

后端也可从 `backend/` 用 `uv sync`、`uv run shenbian-api` 启动。拓扑与语义只写本机 SQLite；Redis 与 OSS 适配继续保留。前端不得直连 SQLite、Redis、OSS 或 `client-data/`；FastAPI 也不代替本地 Pi Agent 与 THCAD 操作主循环。

## Harness 遗留路径

`harness/`、`patches/`、`start-dev.cmd`、`start-harness-via-backend.ps1` 和规格 003 暂时保留，用于复现与迁移现有 DeepSeek Harness 网关切片。新功能不要继续落到这条路径；待依赖清点完毕后再用独立规格移除，避免把迁移和 Pi 基座引入混成一次不可审阅的大改。
