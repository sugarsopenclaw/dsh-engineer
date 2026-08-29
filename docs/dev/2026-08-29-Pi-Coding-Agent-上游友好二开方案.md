# Pi Coding Agent 上游友好二开方案

日期：2026-08-29

## 结论

本项目采用“官方 Pi 源码固定点 + 仓库自有 Pi package”的 no-fork-first 架构：

```text
pi/（只读 submodule）
  ← .pi/settings.json 加载
plugins/shenbian-pi/（沈变 TUI、命令、工具与编排）
  → 本地 THCAD / backend / data / ontology
```

当前公开扩展面已经足以二开官方 TUI，不需要复制 TUI 源码或维护 Pi core fork。只有公开 seam 确实无法承载业务，而且通用上游改进无法及时落地时，才进入“ADR + 最小短期 fork”例外流程。

## 已确认的上游基线

- 官方仓库当前是 [earendil-works/pi](https://github.com/earendil-works/pi)，旧仓地址会重定向到这里；
- 本仓固定 `v0.84.4`，commit `b79e4cc834970cca69daebffab7df1da7d1e52c4`；
- `@earendil-works/pi-coding-agent` 版本为 `0.84.4`，要求 Node.js `>= 22.19.0`；
- 仓库许可为 MIT；
- 官方 workspace 已在 Windows 本机完成锁定依赖安装与全量构建。

固定点写在 `scripts/pi-baseline.psd1`，不是靠 README 文本约定。`scripts/verify-pi.ps1` 会同时验证 submodule commit、release tag、包版本、干净工作树、项目 package、主题、模型设置和 CLI 版本。

## 官方扩展面审计

依据官方 [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) 与 [TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md) 文档，当前可公开使用的能力包括：

- 注册命令、工具、事件处理器和 provider；
- 设置 Header、Footer、Widget、Status 与终端标题；
- 使用官方 TUI 组件和主题系统；
- 为工具调用提供自定义渲染；
- 通过 project-local Pi package 一次登记 extensions、themes、skills、prompts 等资产；
- 未来 GUI 可使用 SDK 或 RPC 嵌入 Pi 运行时。

官方 package 约定要求 Pi 核心包用 `peerDependencies: "*"`。这条很重要：宿主提供唯一运行时实例，沈变 package 不安装、打包第二份 Pi core，避免类型、事件或单例身份不一致。

## 与晓量方案的关系

晓量冻结快照使用 `@earendil-works/pi-coding-agent` `0.84.1`，见 `other-projects/xiaoliang/dev/frontend/package.json`。其总结明确写明“现有聊天 UI 基本没有被 Pi TUI 替换”，并将 Pi TUI、主题和终端快捷键列为不在该 GUI 集成范围内，见 `other-projects/xiaoliang/dev/frontend/docs/pi-coding-sdk-conclude.md`。

因此两边不是二选一：

- 晓量验证了“Pi SDK 作为 Electron 内嵌 Agent runtime”的路线；
- 本项目先验证“官方 Pi TUI + project-local package”的路线；
- 后续若做沈变 GUI，可复用 SDK/RPC 思路和业务 package，但不需要现在就复制晓量 GUI 或放弃 TUI 的低成本迭代面。

## 仓库落点

### 上游层

`pi/` 是正常 git submodule，URL 指向官方 HTTPS 仓库。它保持 detached、干净、只读；生成的 `node_modules`、`dist` 和模型目录由上游忽略，不形成产品改动。

### 产品适配层

`plugins/shenbian-pi/` 是 project-local Pi package：

- `extensions/shenbian-tui.ts`：中文 Header、状态、阶段 widget 与 `/shenbian-status`、`/shenbian-ui`；
- `themes/shenbian.json`：沈变主题；
- `package.json`：Pi package manifest 与 peer dependencies；
- `tsconfig.json`：只对官方构建后的 public declaration 做类型检查，不映射到内部源码。

`.pi/settings.json` 在项目范围加载该 package，并把默认 provider/model、thinking level 与 enabled models 固定在团队可复现的配置中。密钥仍只在根 `.env`。

Pi 会按设计合并用户全局 package，并独立发现 `~/.agents/skills/` 等 Agent Skills。产品启动脚本因此默认把 `PI_CODING_AGENT_DIR` 指向被忽略的 `.pi/runtime/`，同时传 `--no-skills` 并仅在存在时显式加载 `plugins/shenbian-pi/skills/`。开发者只有显式传 `-UseUserPiHome`、`-UseUserSkills` 才分别恢复个人 Pi Home 与用户 skill 发现。需要进入团队基线的社区 package 仍通过官方 package 机制接入，但必须先审计，并在项目设置中固定版本或 git ref。

### 业务层

后续 THCAD 能力仍遵守现有平台边界：Agent 与工具编排在 Pi package；实时 CAD 入口在独立 Bridge；共享规则、知识和 CRUD 在 FastAPI；数据集与对象契约分别留在 `data/`、`ontology/`。不要把 DWG、抽取结果或对象实例塞进 package。

## 为什么不直接 fork

长期 fork 会让每次上游发布都变成源码级三方合并，最容易被 TUI 内部重构、会话格式和未公开类型拖住。当前需求——品牌化 TUI、业务状态、命令、工具、渲染和未来 GUI 嵌入——都已有公开 seam，fork 没有获得相称收益。

采用以下四级升级阶梯：

1. extension、command、tool、event、theme；
2. 官方 TUI 组件、Header/Footer/Widget、tool renderer；
3. SDK/RPC 独立 GUI 宿主；
4. ADR 约束下的最小短期 core fork。

只有前三层均无法满足经过确认的业务需求，且等待上游会造成明确业务损失，才允许进入第 4 层。即使进入第 4 层，沈变业务代码仍留在外置 package，fork 只打开最小通用 seam，并预先定义删除补丁的退出条件。

## 上游升级流程

1. 阅读目标 release notes，选择准确 tag 或完整 commit；
2. 确认 `pi/` 干净，执行 `scripts/update-pi.ps1 -Ref <ref>`；
3. 脚本 detached checkout 目标并更新 `scripts/pi-baseline.psd1`；
4. 按目标 lockfile 安装依赖、刷新模型目录并构建全部官方 workspace；
5. 类型检查沈变 package，验证 manifest、主题、项目设置和 CLI；
6. 人工启动真实 PTY，验证扩展加载、主题、两个命令与退出清理；
7. 发起一次最小 DeepSeek 请求；
8. 审阅 `git diff --submodule=log`，只提交 gitlink、基线与必要的外置兼容性修改。

脚本不自动 commit。若失败，先修外置 package 或回到旧 commit；不允许在 `pi/` 内打“先跑起来再说”的隐性补丁。

## 生命周期与安全约束

- extension 顶层只注册命令、工具、事件和 UI 工厂；不在加载期拉起 THCAD、网络连接或长生命周期进程；
- 会话资源在 `session_start` 建立，在 `session_shutdown` 清理；错误必须可见、可恢复，不能拖垮整个 TUI；
- Pi extension 与 Agent 具有本机系统权限，项目 trust 不是细粒度权限沙箱；只加载一方或经过审计的 package；
- 产品启动默认使用项目隔离 Pi Home，并关闭用户全局 skill 发现；个人资源只能显式 opt in，不能作为 CI 或验收依赖；
- 根 `.env` 由启动脚本注入子进程，日志不输出值；
- THCAD 写操作不随基座默认开放，必须另做工作副本、预览、审批、几何复验和导出边界。

## 本次实测记录

- `npm ci --ignore-scripts`：通过；
- 官方 `npm run build`：全部 workspace 通过，生成 1290 个可用模型记录，其中 DeepSeek 3 个；
- `scripts/verify-pi.ps1`：通过；
- 真实 PTY：沈变 extension/theme 加载、Header/widget/status、`/shenbian-status`、`/shenbian-ui`、`/reload` 热重载和退出均通过；
- 非交互模型枚举：三项 DeepSeek 模型可见；
- 隔离启动：只加载项目登记的 `shenbian-tui.ts` 与 `shenbian` 主题，用户全局 extensions 与 skills 均未混入；
- `deepseek-v4-flash` 最小真实请求：返回 `PI_OK`，退出码 0；
- `git -C pi status --short`：空，确认没有改动上游源码。

## 下一步

另开规格实现只读 THCAD Bridge。首条验收链路建议是：读取当前图纸上下文 → 有界查询少量实体或图框信息 → Pi tool 返回结构化证据 → TUI 专用 renderer 展示 → 会话记录可追溯。先建立可靠的“读与证据”，再设计任何写图动作。
