# 009 — Pi Coding Agent 基线与上游友好二开

## 背景

本项目不再把 DeepSeek Harness 作为产品主 Agent。沈变图纸审查改用 Pi Coding Agent：先保留官方 CLI/TUI、会话树、压缩、工具循环和社区扩展体系，再通过本仓库自己的 Pi package 接入 THCAD、FastAPI 与沈变业务。

晓量已经验证了把 Pi SDK 嵌入 Electron 的可行性，但它为了桌面 GUI 主动排除了 Pi TUI。本规格的第一阶段目标不同：先从官方源码运行完整 Pi Coding Agent，并在不修改上游源码的前提下完成一条可见的 TUI 二开切片。

## 架构决策

1. `pi/` 是 `earendil-works/pi` 的只读 git submodule，只钉经过验证的 release tag/commit。
2. `plugins/shenbian-pi/` 是本项目自有的 project-local Pi package，承载 extensions、skills、prompts 和 themes。
3. 根目录 `.pi/settings.json` 只负责声明项目资源；业务实现不放进 `.pi/`，避免配置与代码耦合。
4. TUI 二开优先使用公开 API：`setHeader`、`setFooter`、`setWidget`、`setStatus`、`ui.custom`、自定义 tool renderer、commands、themes。
5. 插件只 import Pi 的公开包入口，不 import `pi/packages/**/src` 内部文件；Pi 核心包只声明为 peer dependency，不在插件中再安装一份。
6. DeepSeek Harness 已从仓库移除；新增 Agent / TUI / THCAD 能力只落在 `plugins/shenbian-pi/`。

## 需求

- **R1** 新 clone 能通过一条 PowerShell bootstrap 命令初始化并构建固定版本的 Pi 上游。
- **R2** 能从仓库根目录启动官方 Pi TUI，并让 Pi 读取根目录环境变量但不复制或打印密钥。
- **R3** 启动后的 TUI 能看见沈变品牌 Header、运行状态和项目提示，并提供诊断命令证明本地 package 已加载。
- **R4** project-local Pi package 能由官方 package/resource loader 加载，支持 `/reload`，不需要修改 `pi/`。
- **R5** 验证脚本能检查 submodule 版本、工作区纯净度、上游构建产物、package manifest 和 CLI smoke test。
- **R6** 升级脚本只接受明确 tag/commit；升级后必须重新构建和验证，成功后才允许提交 submodule 指针。
- **R7** 后续 THCAD 能力仍遵守现有能力面索引、公开入口证据、Data Layer 和本地 CAD 主循环边界。

## 非目标

- 不在本规格中接入真实 THCAD 工具或实现沈变审图规则。
- 不把晓量 Electron GUI 复制到本仓库。
- 不在本规格中改动 backend、frontend 与已有数据成果。
- 不建立长期修改 Pi 内核的 fork。
- 不替用户安装不受信任的第三方 Pi package。

## 验收

1. `pi/` 精确落在记录的上游 release commit，且 `git -C pi status --short` 为空。
2. `scripts/bootstrap-pi.ps1` 在 Node.js `>=22.19.0` 环境完成依赖安装和离线构建。
3. `scripts/start-pi.ps1` 从仓库根启动官方 CLI/TUI；首次运行遵循 Pi project trust 流程。
4. TUI 显示“沈变图纸审查”自定义 Header，并能执行 `/shenbian-status`。
5. `scripts/verify-pi.ps1` 检查通过，官方 CLI `--version` 与所钉 package 版本一致。
6. 文档明确说明常规二开、上游升级和“公开 seam 不够用”时的处理顺序。

