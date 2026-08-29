# @shenbian/pi

沈变项目的 project-local Pi package。Pi 从根目录 `.pi/settings.json` 加载它；不要把本包复制进 `pi/` 上游目录。

当前只提供第一条 TUI 二开切片：

- 沈变 Header、终端标题、状态和阶段 Widget；
- `shenbian` 主题；
- `/shenbian-status` 运行基线诊断；
- `/shenbian-ui` 在产品界面与 Pi 原生界面之间切换。

后续 THCAD 工具、审图技能和任务提示词仍放在本包，但必须先遵守仓库根 `AGENTS.md` 的 THCAD 能力面核查要求，并另开规格。

## 边界

- 只 import `@earendil-works/pi-*` 的公开导出；
- Pi 核心包只放 `peerDependencies`，不得在本包安装第二份 runtime；
- 第三方运行时依赖才放 `dependencies`；
- 不在扩展加载阶段启动进程、连接 CAD 或访问网络；
- 长生命周期资源在 `session_start` 按需创建，并在 `session_shutdown` 释放。
