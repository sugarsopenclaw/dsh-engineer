结论先说：基于代码审计和回归测试，没有发现 CAD Subagent、Blender Subagent 或原有项目业务能力因 Pi 改造而受损。Pi 替换的是通用 Agent 运行时与会话机制，不是晓量的 CAD、项目、计费、权限和云归档业务实现。

## 1. 原有业务能力影响

| 能力 | 结论 | 代码事实 |
|---|---|---|
| CAD Subagent | 未发现回归 | `delegate_cad` 仍由原 Subagent Runtime 构造，当前图、项目根目录、证据包、查询额度等逻辑未变 |
| Blender Subagent | 未发现回归 | `delegate_blender` 仍是隔离子代理；原 Blender MCP 工具集未被 Pi 内置工具替换 |
| 主 Agent 业务工具 | 未发现回归 | 项目文件、构件、Office 产物、Web、用户 skills、CAD skills、两个 delegate 仍由同一入口创建，再整体交给 Pi Host：[tools/index.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/agent/tools/index.ts:60)、[agent-session-manager.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/agent/sessions/agent-session-manager.ts:14242) |
| CAD 安全边界 | 保留 | 主 Agent 仍不能获得直连 CAD/Blender 执行工具，只能委派和读取已发布证据 |
| 审批确认 | 保留 | Pi 的每次工具调用仍经过原 `guardToolExecution` 和 A2UI 确认链：[agent-session-manager.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/agent/sessions/agent-session-manager.ts:14820) |
| 登录、Gateway、计费 | 保留 | 动态凭证、`X-Xiaoliang-Agent-Run-Id`、主/子代理 usage 聚合和 run 结算仍由晓量负责 |
| 子代理轨迹 | 增强，没有削弱 | 原 JSONL、截图、OSS 归档继续存在，并新增父 Pi Session/Entry 关联：[subagent-trace-sync-service.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/agent/subagents/subagent-trace-sync-service.ts:206) |
| 反馈、搜索、Feishu | 保留 | 继续读取 SQLite 活动路径投影；反馈增加 Pi 身份，Feishu 已适配异步消息投影 |

CAD/Blender 子代理相关代码在这次改造中主要只是 SDK 包名升级、TypeBox 升级和兼容流式入口调整；没有重写其工具、证据或执行流程。

有两个需要诚实保留的验证边界：

- 本次跑通了自动化 CAD Bridge，但没有连接真实 AutoCAD/Blender 做完整人工任务。
- 没有实际调用生产 Gateway、OSS、飞书做线上冒烟，因此这些外部环境仍建议发布前各跑一次。

## 2. 被 Pi 等价替换的部分

| 原实现 | 现在 | 仍由晓量负责的部分 |
|---|---|---|
| 主 Agent 直接使用底层 `Agent` | `AgentSessionRuntime + AgentSession` | system prompt、业务工具、Gateway、凭证、审批、计费 |
| `conversations.agent_state` 保存完整消息数组 | Pi JSONL 成为事实源 | SQLite `messages` 继续作为 UI、搜索、反馈、归档投影 |
| 自研 context compactor | Pi 手动/自动 compaction、overflow compact-and-retry | 用量计费、状态 UI、云同步 |
| 分散的失败重试行为 | Pi 统一 retry、指数退避、取消和状态事件 | 错误文案、计费和 Renderer 展示 |
| 旧 Agent 停止/结束判断 | Pi `abort / waitForIdle / agent_settled` | 停止按钮、任务结算和清理 |
| 内置/市场 CAD skills 与文档 skills 的提示词目录注入 | Pi 受控 ResourceLoader + `xiaoliang_read_skill` | skill 发布、校验、签名目录、用户 skills 和业务工具 |
| 旧 Agent Event 直接驱动 UI | Pi Session Event 转为现有 `AgentUiEvent` | 现有聊天 UI 基本没有被 Pi TUI 替换 |

最重要的存储结论：

- Pi 只负责本地 JSONL 格式和 Tree 语义。
- OSS 上传、数据库表和归档流程不是 Pi 提供的，仍是晓量自研。
- 云端数据库保存活动路径结构化消息；完整原始 JSONL 同时按版本上传 OSS，并在数据库保存 Session、父子关系、当前 leaf、entry 数量和哈希：[project-archive-sync-service.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/project-sync/project-archive-sync-service.ts:660)、[pi-session-cloud-archive.md](E:/062026/xiaoliang/dev/frontend/docs/pi-session-cloud-archive.md:1)。
- 项目文件、消息附件、子代理轨迹的原 OSS 归档没有被替换。

当前数据边界也要明确：

- 只有绑定项目的会话会进入项目云归档；无项目会话目前只保存在本地 JSONL。
- `training_consent` 当前固定为 `false`，数据已留存，但不等于训练授权。
- 云端目前只有上传/确认，没有完整 JSONL 的下载和跨设备恢复入口。
- UI 的 JSONL/HTML 导出是“当前活动分支”；OSS 归档读取的是完整原始 JSONL。
- 旧系统压缩时已经删除的更早历史无法凭空恢复；迁移时会明确记录这一点。

## 3. Pi 新能力的实际使用情况

### 已完整接入 UI

- 运行中追加指令 `steer`
- 本轮结束后继续 `followUp`
- 排队数量、预览、撤回队列
- 停止并等待真正结束
- Session 信息、模型、消息数、Token 统计
- JSONL 导入/导出、HTML 导出
- retry 倒计时、次数和失败状态
- 手动 compaction、自动 compaction、overflow 恢复
- 完整 Tree 查看和活动路径标记
- Tree 路径切换
- `fork-before`“消息前分叉”
- `clone-at`“克隆到此处”，包括关联工具结果
- labels/bookmarks
- 可选 branch summary
- 会话列表父子关系与子分支数量

主要入口在 [agent-chat-panel.tsx](E:/062026/xiaoliang/dev/frontend/src/components/runtime/agent-chat-panel.tsx:527) 和 [conversation-tree-dialog.tsx](E:/062026/xiaoliang/dev/frontend/src/components/chat/conversation-tree-dialog.tsx:338)。

### 已在运行时使用，但没有专门 UI

- Session new/open/resume、异常退出恢复
- Session name、model/thinking 持久化
- 受控内置/托管 skills 自动加载
- 项目 `.xiaoliang/prompts/*.md` Prompt Templates；输入 `/模板名` 可以展开，但没有模板列表或自动完成
- skill 更新后自动 resource reload
- 隐藏的 Xiaoliang inline extension adapter
- 完整 JSONL OSS 归档

### API 已实现，但 Renderer 没有产品入口

- 全局 `listConversationSessions`
- Pi resource 状态与诊断查看
- 手动 resource reload
- `setActiveTools`
- 动态 `registerTools / replaceTools`

这些目前只有 IPC/Bridge 或测试覆盖，没有设置面板，也没有把 active tools 选择持久化为用户偏好。

### 明确没有接入，且属于有意排除

- 任意 `~/.pi` 或项目 `.pi` 自动发现
- 任意本地 TypeScript extension
- Pi Packages 安装和自动更新
- Pi TUI、主题、终端快捷键
- Pi provider credential、`/login`、`/logout`
- CLI session picker、Gist share、CLI/RPC 产品界面

另外发现一处 UI 文案落后：Tree 弹窗仍写着“云端当前仅同步活动路径”。准确说法应是“结构化消息只同步活动路径，但完整 JSONL 已归档 OSS；暂不支持跨设备恢复”。现文案在 [conversation-tree-dialog.tsx](E:/062026/xiaoliang/dev/frontend/src/components/chat/conversation-tree-dialog.tsx:461)。

## 4. 最后的阶段 7 尾项

> 2026-08 更新：本节结论已过时。阶段 7 已完成——`pi_coding_tools` 默认开启，`createAgentTools()` 用 SDK 工具工厂按项目根目录注册七个工具，`project_list`/`project_search` 删除、`project_read` 收窄为 `doc_parse`。`bash` 的运行时来源为：晓量托管 MinGit（设置页「环境检测与准备」一键下载，后端 OSS 为主、npmmirror/华为云镜像兜底，热生效免重启）优先，系统 Git Bash 其次，都没有时单独降级；rg/fd 随安装包预置。以下为当时的审计快照。

七个 Coding Tools 目前确实完全没有进入产品运行时：

```text
read / grep / find / ls / edit / write / bash
```

证据很直接：

- Pi Session 仍设置 `noTools: 'builtin'`：[xiaoliang-pi-agent-host.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts:832)。
- 全仓库没有调用 `createAllTools/createCodingTools/createReadOnlyTools`。
- `pi_coding_tools` 只有定义，默认 `false`，AgentSessionManager 也没有读取它：[feature-flags.ts](E:/062026/xiaoliang/dev/frontend/electron/runtime/agent/pi/feature-flags.ts:22)。

剩余工作是：

1. 项目会话按项目根目录创建七个工具。
2. 合并到现有业务工具，并接入 `pi_coding_tools`。
3. 保证 open/resume、Tree、fork/clone、resource reload 后工具集合一致。
4. 验证 diff、流式输出、超时、中止和 JSONL/UI 投影。
5. 完成 CAD/项目回归后默认开启。
6. 路径限制、敏感文件保护、write/bash 确认属于可选产品护栏，不是 Pi 工具接入的技术前置。

详细规划已在 [pi-coding-agent-stage7-plan.md](E:/062026/xiaoliang/dev/frontend/docs/pi-coding-agent-stage7-plan.md:1)。

## 验证结果

- 业务、Pi、UI、审批、反馈、归档、认证：114/114 个 Node 测试通过。
- CAD HTTP Bridge：9/9 个 Node 测试、13/13 个 Python 测试通过。
- 后端：88/88 个测试通过，另有 5 个子测试通过。
- Electron 43.2.0 下 `better-sqlite3`、`keytar` 成功加载。
- Renderer + Electron 生产构建通过。
- 工作树保持干净，本次调研没有修改代码。

综合判断：阶段 0–6 的迁移可以认为基本完成，原业务能力没有发现技术替换导致的回归；真正未完成的是阶段 7 Coding Tools，以及资源管理 UI、云端恢复和一处 Tree 云同步文案这几个小尾巴。