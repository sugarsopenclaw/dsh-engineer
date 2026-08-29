# @shenbian/pi

沈变项目的 project-local Pi package。Pi 从根目录 `.pi/settings.json` 加载它；不要把本包复制进 `pi/` 上游目录。

当前提供两条彼此解耦的切片：

- 沈变 Header、终端标题、状态和阶段 Widget；
- `shenbian` 主题；
- `/shenbian-status` 运行基线诊断；
- `/shenbian-ui` 在产品界面与 Pi 原生界面之间切换。
- `delegate_thcad_mechanical`：主 Agent 唯一可见的 THCAD 委派入口；
- fresh `thcad-mechanical` 子 Agent：只见 `thcad_session`、`thcad_analysis`、`thcad_project_graph`，可使用 .NET 01–20；
- `/thcad-doctor`：只读检查 AgentBridge DLL、活动 THCAD 和当前图。

子 Agent 的 COM 只负责唤醒 THCAD 命令，实体与拓扑读取由独立的进程内 .NET Host 执行。架构、构建和 TUI 测试见 `docs/dev/2026-08-29-Pi-THCAD-DotNet-机械子代理接入.md`。

## 边界

- 只 import `@earendil-works/pi-*` 的公开导出；
- Pi 核心包只放 `peerDependencies`，不得在本包安装第二份 runtime；
- 第三方运行时依赖才放 `dependencies`；
- 不在扩展加载阶段启动进程、连接 CAD 或访问网络；Bridge 与 fresh child 只在工具/命令被调用时按需运行；
- 当前工具只读 DWG；定位动作仅改变选择集与视图。任何图纸写操作必须另开规格和审批边界。
