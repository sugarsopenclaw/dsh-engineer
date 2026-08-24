# 通用 Harness 对比：晓量 vs grok-build vs deepseek-harness

日期：2026-08-13。只分析，不改代码。

对照对象：

| 项目 | 定位 | 实现 |
|---|---|---|
| 晓量 | Forge / 工程 Agent 产品 | Pi Coding Agent SDK + `XiaoliangPiAgentHost` / `AgentSessionManager` |
| [grok-build](../../../my-projects/grok-build) | 开源 coding agent harness | Rust，ACP，核心在 `crates/`（`xai-grok-shell` / `xai-grok-agent` / `xai-grok-tools`） |
| [deepseek-harness](../../../my-projects/deepseek-harness) | 开源 coding agent harness | TypeScript monorepo，Cordis 插件树，核心在 `packages/core/` |

三家都覆盖 Agent loop、Instructions、Tools、Session、Context、Orchestration、Hooks、Observability。后两家偏 coding；晓量偏工程。通用层可以比，领域层不必对齐。

相关文档：

- 晓量 Session / Runtime：[agent-session-runtime.md](./agent-session-runtime.md)
- 上下文管道：[../agent-context-pipeline.md](../agent-context-pipeline.md)
- Pi 接入审计：[../pi-coding-sdk-conclude.md](../pi-coding-sdk-conclude.md)

---

## 结论

晓量的短板不在「Agent 跑不跑得动」，而在「跑失控了没人管、跑坏了查不出、想加横切能力得改核心」。

主循环、队列、重试、压缩、Session 树交给 Pi；system prompt、工具注册、CAD/Blender 隔离、审批、计费、SQLite 投影、云归档是自研。已经不弱的是产品编排与生命周期；弱的是 harness 控制面。

---

## 八维评分（0–5）

| 维度 | 晓量 | grok-build | deepseek | 晓量现状一句话 |
|---|---|---|---|---|
| Agent Loop | 3 | 5 | 4 | 停 / 追加 / 下一轮 / settled / 计费对齐完整；无 turn / token 硬预算，无动作平稳性检测 |
| Instructions | 3 | 5 | 4 | 分段 system prompt + 项目 `AGENTS.md` + skills；无用户级全局指令，无 prompt prefix cache |
| Tools / 执行环境 | 3 | 5 | 5 | 业务工具 + coding 七件套 + 子代理隔离；`edit`/`write`/`bash` 无确认、无沙箱 |
| State / Session | 4 | 4 | 4 | JSONL 事实源 + SQLite 投影 + Tree / fork / 云归档，三家里不落下风 |
| Context 管理 | 2 | 5 | 4 | 完全托给 Pi compaction；无 spill / prune / 重复读去重 / 领域摘要 |
| Orchestration | 4 | 5 | 5 | 双角色子代理 + 后台任务 + 并发会话成熟；无 todo / plan / 多模型路由 |
| Hooks / 中间件 | 1 | 4 | 5 | 只留 1 个 inline extension；横切能力硬编码在 Host / IPC |
| Observability | 2 | 4 | 5 | 有计费闭环和子代理轨迹；无统一日志 / trace / 诊断包 / eval |

---

## 晓量短板（按严重度）

### 1. 工具安全模型

`approval-gates.ts` 只覆盖 5 个业务工具：`component_save` / `component_delete` / `cad_algorithm_save` / `project_artifact_create` / `project_algorithm_export`。

阶段 7 接入的 `edit` / `write` / `bash`：**零确认、零敏感路径保护、零 OS 沙箱**，cwd 直接是用户项目根。bash 只靠 MinGit / Git Bash。

对标：

- grok：Seatbelt / bwrap / Landlock + Ask / Auto / YOLO / AlwaysApprove
- deepseek：`read-only` / `workspace-write` / `danger-full-access` + Windows ACL restricted-token

那两家的用户是开发者，还上了沙箱。晓量用户是造价 / 工程人员，更不会 review bash，反而裸奔。这是唯一带真实事故风险的一条。

### 2. Loop 没有失控闸门

全仓搜不到 `maxTurns` / `maxIterations` / token 预算。循环终止只靠「模型不再调工具」。

对标：

- grok：`max_turns` + `token_budget` + 动作平稳性（同一 tool call 8 次 nudge / 16 次硬停，noop 4 次硬停）+ TodoGate
- deepseek：文档自己承认「无内置 turn / 总 token 预算」是已知缺陷

晓量按 credits 计费。一次死循环 = 烧穿余额 + 客诉。

### 3. Context 工程几乎空白

自研只有 UI 上下文环（`context-tracker.ts`）和约 12k 的注入预算（`estimateTokens ≈ ceil(len/4)`）。压缩、overflow retry 全交给 Pi（reserve 16k / keepRecent 20k）。

没有：

- 工具结果剪枝
- 大输出落盘（spill）
- 同文件重复读取去重
- prompt prefix cache（全仓 0 处 `cache_control`）
- 领域摘要器（压缩时保住构件表 / 证据链结构）

对标：

- deepseek：spill → prune → compact 三级降压；摘要请求回放热前缀复用 KV cache
- grok：two-pass compaction + preflight overflow + compact-and-retry

图纸解析 / 构件表 / DWG 提取的输出比 coding agent 更大、更结构化。现在全量进上下文，一次通用压缩就会把证据摘成散文。

### 4. Observability 是零

`electron/runtime/agent/telemetry/` 只有 `.gitkeep`。日志是散落的 `console.warn` / `console.error`。

有的是**计费**闭环（`startRun` / `finishRun` → credits），不是可观测性。能回答「这次花了多少钱」，回答不了「为什么这次任务失败」。桌面端线上问题只能靠用户截图。

对标：deepseek 有 telemetry seam + OTel + snapshot record/replay；grok 有 tracing span + TTFT / tok-s + JSONL replay。

### 5. 扩展点没被抽象成协议

`XIAOLIANG_PI_RESOURCE_POLICY` 关掉 Pi 的 extension / skills / promptTemplates / contextFiles 自动发现，只留 1 个 inline `createRuntimeExtension()`。审批、计费、header 注入全硬编码在这个 extension + IPC 里。

每加一个横切能力都要改 `agent-session-manager.ts`。

对标：deepseek 是 Cordis typed waterfall；grok 有 14 种 hook 事件，Stop hook 还能强制续跑。

闭源商业桌面产品不该开第三方插件市场，但**内部 hook 总线**是纯收益。

### 6. 次一级缺口

| 缺口 | 现状 |
|---|---|
| 空骨架目录 | `memory/`、`telemetry/`、`tasks/planner`、`tasks/scheduler`、`mcp/{transport,registry,auth,capabilities}` 全是 `.gitkeep` |
| 用户级全局指令 | 无对标 `~/.grok/`、`$DSH_HOME/AGENTS.md` 的产品入口 |
| todo / plan | `tasks/planner/` 空 |
| 多模型路由 | `routing/` 空；思考档位只有 `low` / `xhigh` |
| 通用 MCP | 只有 Blender 特例，总线未落地 |
| 跨会话记忆 | `memory/` 空；旧文档里的 `[memory 边界]` 已不在 `builder.ts` |
| 工具分档 / 热插 | `setActiveTools` IPC 已有，无 UI；`registerTools` 无 IPC |
| 登出 idle | 退出应用会等；登出只清 token，不等 `agent_settled` |
| 空闲 Runtime 回收 | 每个对话一份 Host，开多了常驻 |
| 文档漂移 | `agent-context-pipeline.md` 的工具清单、memory 段、provider 数量与代码不符；`pi-coding-sdk-conclude.md` §4「coding tools 未接入」已过时 |

---

## 别误判：晓量已经不弱的地方

这些不要当成短板去「补齐成 coding harness」。

1. **Session 树 + 双写投影**：Pi JSONL 是消息 / 工具 / Tree 事实源；SQLite 是 UI / 搜索 / 活动路径投影；`conversation_pi_session_bindings` 做映射。fork / clone / 导入导出 / 云归档上传都有。deepseek 反而没有 rewind、没有跨会话 memory。
2. **子代理隔离比通用 harness 更严**：`enforceParentSubagentBoundary` 禁止主 Agent 挂 `cad_*` 执行工具 / `blender_mcp_*`。主模型只 `delegate_*`，child 独立工具表与 transcript。grok 的 orchestrator toolset 是同思路，但不是默认。
3. **计费与 loop 生命周期对齐干净**：`finishRun` 等 `prompt()` 返回（即 `agent_settled` 之后），CAD 子代理未完再推迟。比听第一次 `agent_end` 严谨。
4. **运行时自举**：MinGit / uv / blender-mcp 一键预热 + 国内镜像兜底 + SHA-256 + 原子切换。两个开源项目都假设机器已就绪。
5. **后台并发会话**：每个 conversation 一份 Runtime，点侧栏换对话不 `waitForIdle`。明确没套用 Pi TUI 的单 Runtime 假设。

---

## 对标项目各自最值得借鉴的点

### grok-build

- Interjection 作为一等公民：运行中插话在安全点 drain，打断 wait 工具，不粗暴 cancel 整轮
- 分层 compaction 引擎 + overflow compact-and-retry + 摘要对齐 KV cache
- 工具并行 + 同路径写锁 + ExitPlan 尾批
- 子代理是完整会话（可 resume / background / worktree 隔离）
- Hooks + Stop gate + TodoGate：可靠性从 prompt 升级到 runtime policy

弱项：作为可嵌入库抽取成本高；跨会话记忆仍 experimental；Windows 沙箱非一等公民。

### deepseek-harness

- 事件溯源：`SessionEvent` 是唯一真相，`deriveMessages` / UI / resume / fork 都从同一流投影
- Inbox × (`next-step` / `next-turn`) × wakeup：steer / followup / inject 是同一状态机
- Capability seam：shell / fs / sandbox / llm / persistence 可整组替换
- spill → prune → compact 的上下文降压阶梯
- Cordis waterfall 作为一等 middleware；catalog / invariant / snapshot 做成 CI 门禁

弱项：token 计量是启发式（4 字符 ≈ 1 token）；无跨会话 memory；无消息级 rewind；内建评测薄弱。

### Pi SDK（晓量已用、但产品没用满）

详见 [agent-session-runtime.md](./agent-session-runtime.md) §4。高价值但闲着的：

- `setActiveToolsByName` / `registerTools`：按会话裁剪工具，不必整 Runtime 重建
- `session_before_compact`：可注入领域摘要，替代纯通用 summarize
- `appendEntry` / `deliverAs: "nextTurn"`：审批回写和不触发当前 loop 的系统 aside；子代理结果已通过收窄的 `sendCustomMessage` 包装落地
- `getSessionStats` / `getContextUsage` / `diagnostics`：产品常重复造 tracker
- `waitForIdle` 单独暴露给 Renderer：导出 / 归档 / 切目录时「只等、不停」

---

## 建议优先级

只列「从通用 harness 角度看该补什么」。领域能力（CAD / 造价 / 图纸）不在本表。

### P0：止血

1. **coding 写操作审批 + 敏感路径黑名单**  
   `edit` / `write` / `bash` 走现有 `getToolConfirmationRequest()` / A2UI；禁写 `.env`、密钥、安装目录。先不要上 Seatbelt / bwrap，成本高、Windows 一等公民难做。
2. **turn / token / 成本硬预算 + 动作平稳性检测**  
   单次 run 最大迭代、最大 credits、同一 tool call 重复硬停。直接挂在 `AgentSession` 外层或 `beforeToolCall`。按 credits 计费，这条和安全同等优先。

### P1：决定 Agent 上限

3. **工具结果 spill / prune + 领域摘要**  
   大工具输出先落盘，模型只见 locator；压缩时用 Pi 的 `session_before_compact` 保住构件表 / 证据链，不要把一切打到通用 summarizer。
4. **统一 trace id + 诊断包导出**  
   一次用户发送一条 `client_run_id` 贯穿主会话、子代理、计费、日志。设置页「导出诊断包」（JSONL + 子代理轨迹 + usage）。先不要上 OTel / Sentry。

### P2：决定演进速度

5. **内部 hook 总线**  
   把现在 inline extension 里的 `transformContext` / `beforeToolCall` / `agent_settled` 收成小型 typed Decision。计费、审批、归档、飞书回写挂上去。不开第三方插件。
6. **prompt 前缀缓存**  
   稳定 system / tools 前缀与变动的 workspace / git / CAD session 分离。Gateway 侧能吃 `cache_control` 再接线。
7. **`setActiveTools` 工具分档 UI**  
   API 已有。CAD 主对话不要 bash；资料问答只要 read / grep / ls。避免「改一个开关就拆 Runtime」。

### 不建议做

- 第三方插件市场 / 任意目录 `.pi` extension（信任边界，规划里已排除）
- 通用 MCP 总线（除非出现第二个 MCP 需求；现在只有 Blender）
- 跨会话向量 memory（先把项目索引和 Agent Workspace 做透）
- 把晓量改成 grok / deepseek 那种「可嵌入纯库」（产品形态不同）
- 在侧栏换对话时 `waitForIdle`（会毁掉后台并发）

---

## 实现落点（便于回头核对）

| 层 | 路径 |
|---|---|
| Host | `electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts` |
| 会话管理 | `electron/runtime/agent/sessions/agent-session-manager.ts` |
| 工具注册 | `electron/runtime/agent/tools/index.ts` · `createAgentTools()` |
| 审批 | `electron/runtime/agent/policy/approval-gates.ts` |
| System prompt | `electron/runtime/agent/prompts/system/builder.ts` |
| 上下文注入 | `electron/runtime/agent/context/context-assembler.ts` |
| 子代理 | `electron/runtime/agent/subagents/`、`tasks/background/subagent-task-service.ts` |
| 空骨架 | `memory/`、`telemetry/`、`tasks/planner/`、`mcp/{transport,registry,auth}` |
