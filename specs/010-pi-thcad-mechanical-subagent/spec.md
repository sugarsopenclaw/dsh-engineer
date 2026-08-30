# 010 · Pi THCAD 机械子代理

状态：Implemented

## 目标

在不修改 `pi/` 上游、不把 THCAD 程序集加载进 Node.js、也不把 CAD 权限直接暴露给主 Agent 的前提下，将现有 01–20 .NET 分析能力接入 Pi TUI。

## 用户路径

```text
用户 → Pi 主 Agent → delegate_thcad_mechanical
     → 隔离的 thcad-mechanical 子 Agent
     → thcad_session / thcad_analysis / thcad_project_graph
     → 本地作业协议 → THCAD 进程内 .NET Host
     → 01–20 结构化证据 → evidence.md → 主 Agent
```

## 必须满足

- `pi/` 保持上游零修改，接入只使用公开 extension、tool 和非交互 CLI seam。
- 主 Agent 不直接获得原子 CAD 工具，只能委派一项自包含机械取证任务。
- 子 Agent 使用 fresh、唯一 `--session-dir` / `--session-id` Pi 进程，不继承父 transcript；原生 child Session 仅为本地 review 留档，工具严格限定为三个 THCAD 工具。
- COM 只附着 `BricscadApp.AcadApplication`，验证宿主为 `thcad.exe`，只负责加载插件与发送命令；实体读取和 01–20 分析必须在 THCAD 内的 .NET 命令执行。
- .NET Host 使用独立程序集名，避免与已经加载的实验抽取 DLL 冲突；01–20 源码用 MSBuild linked files 复用，不复制实现。
- 默认操作只读。唯一界面动作是按明确请求设置选择集和缩放，必须报告找到/缺失句柄及窗口变化；不得保存、关闭或修改 DWG。
- 工具结果必须有界，只返回项目相对 artifact ref、确定性摘要、JSON 路径、句柄和限制；不得把整图 JSON、base64、秘密或 child transcript塞回主上下文。
- 20 同时支持当前图的 observation 与对已抽取图集合离线构建项目图。
- THCAD 未运行、正忙、插件加载失败、活动图变化、作业超时和 artifact 缺失均返回稳定错误，不自动启动、关闭或重启 CAD。

## 非目标

- 不迁移晓量 Electron UI、登录、网关、品牌样式、MLightCAD 或 Python COM 业务读取。
- 不在本切片开放画线、改尺寸、删标注、保存图纸等写操作。
- 不把七张样图结论硬编码成企业标准，也不把几何候选升级为设计结论。

## 验收

- Pi package 类型检查通过，Pi 上游仍 clean。
- 07–20 Core 回归和 THCAD Agent Bridge Release 构建通过。
- 无 CAD fixture 测试覆盖 01–20 catalog、JSON 有界查询、路径约束和 evidence 投影。
- 对运行中的 THCAD 可完成只读 `status`；真机 `refresh_analysis` 由用户在空闲图纸会话中按 TUI 测试说明执行。
