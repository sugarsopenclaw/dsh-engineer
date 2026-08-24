# AgentSession / AgentSessionRuntime：概念、接入现状与留白

结论先说：这段能力是 **Pi 一次对话的执行引擎**，不是某个按钮的名字。晓量已经把它包进 `XiaoliangPiAgentHost`，再由 `AgentSessionManager` 接到聊天、停止、计费、退出。但「切换会话前必须 `waitForIdle()`」在晓量里并不等于点侧栏换对话——那是 Pi TUI「一个 Runtime 同时只挂一份 JSONL」的规则；晓量是「每个对话各有一份 Runtime，后台可以继续跑」。

相关文档：

- 能力规划：[../pi-coding-agent-todo.md](../pi-coding-agent-todo.md)
- 接入审计：[../pi-coding-sdk-conclude.md](../pi-coding-sdk-conclude.md)
- IPC 与结算约定：[../electron-ipc.md](../electron-ipc.md)
- 云归档：[../pi-session-cloud-archive.md](../pi-session-cloud-archive.md)
- 通用 harness 对比：[harness-comparison.md](./harness-comparison.md)

---

## 1. 这句话到底在说什么

可以把它想成操作系统里的「进程 + 进程管理器」。

| 概念 | 角色 | 一句话 |
|---|---|---|
| `AgentSession` | 一次对话的执行进程 | 消息、工具、模型请求、队列、重试、压缩、落盘 |
| `AgentSessionRuntime` | 进程管理器 | 创建 / 替换 / 销毁这份 Session；换文件前先把当前回合收干净 |
| `createAgentSession()` | 造一份 Session | 绑好模型、工具、JSONL、ResourceLoader |
| `createAgentSessionRuntime()` | 造一份 Runtime | 记住 factory，之后 `/new`、`/resume`、`/fork`、导入都能重建 |
| `abort()` | 立刻打断当前回合 | 停模型流、取消 retry / compaction，但会等到工具结果写入 JSONL |
| `waitForIdle()` | 等到「真的没事了」 | 没有进行中的 agent run、retry、自动压缩、排队续跑 |
| `agent_end` | 「这一小圈 Agent loop 结束了」 | 可能马上还要 retry / compact / 消化队列，**不算整次工作结束** |
| `agent_settled` | 「这整次工作结束了」 | 上面那些后续都做完，才发这个事件 |

Pi 源码里状态机是这样的（`packages/coding-agent/src/core/agent-session.ts`）：

```ts
private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
  this._isAgentRunActive = true
  try {
    await this.agent.prompt(messages)
    while (await this._handlePostAgentRun()) {
      await this.agent.continue()
    }
  } finally {
    this._systemPromptOverride = undefined
    this._flushPendingBashMessages()
    await this._emitAgentSettled()
  }
}
```

`_handlePostAgentRun()` 为真的情况包括：可重试错误、上下文溢出后 compact-and-retry、还剩排队消息。这些都会先发一次带 `willRetry=true` 的 `agent_end`，**然后继续转**，最后才 `agent_settled`。

所以两句「最有价值姿势」的本意是：

1. **不要在工具还在写盘时拆掉 Session。**  
   `abort()` 本身就会再 `waitForIdle()`。Runtime 换 session 时也是先 `teardownCurrent()` → `session.abort()`，保证中止消息和 tool result 写进**即将被换走的那份 JSONL**，而不是写丢或写到下一份。

2. **不要在第一次 `agent_end` 就关 UI、结账。**  
   那一次可能只是「模型挂了，2 秒后重试」。计费、侧栏绿点、停止按钮复位，都要等 `agent_settled`。

`waitForIdle()` 和 `agent_settled` 几乎是同一时刻：settled 发出后才会把 idle Promise resolve。差别是：事件给 UI / 计费听，Promise 给主进程 `await`。

---

## 2. 晓量里实际怎么分层

不是 UI 直接碰 Pi。真实链路是：

```text
聊天 UI（停止 / 排队 / 侧栏）
    → electron-bridge IPC
        → AgentSessionManager（每个 conversation 一份 SessionRecord）
            → XiaoliangPiAgentHost
                → AgentSessionRuntime
                    → AgentSession  +  JSONL
```

关键实现：

- 创建：`XiaoliangPiAgentHost.create()` 里调用 `createAgentSessionServices()` → `createAgentSession()` → `createAgentSessionRuntime()`。
- `noTools: 'builtin'` 保留（注册路径完全由晓量控制）：七个 coding tools（`read`/`grep`/`find`/`ls`/`edit`/`write`/`bash`）由 `createAgentTools()` 用 SDK 工具工厂按项目根目录显式创建后，与 CAD / 富文档 / Web / delegate 工具一起挂载。项目未绑定时不注册。
- `bash` 的运行时解析（`pi/pi-bash-runtime.ts`）：晓量托管 MinGit（`userData/managed-runtimes/git-bash/current`，经 `createBashTool` 的 `shellPath` + `spawnHook` PATH 注入）优先，其次系统 Git Bash（SDK 探测），都没有则单独降级不注册。设置页「环境检测与准备」可一键下载 MinGit（后端 OSS `/runtime-assets/git-bash` signed URL 为主，npmmirror / 华为云镜像兜底，SHA-256 校验 + 冒烟验证后原子切换）；fingerprint 覆盖 bash 来源与路径，准备完成后下一次对话自动重建会话热生效，无需重启。
- Blender MCP 依赖预热（`mcp/blender-mcp-runtime.ts`）：server 由 `uvx blender-mcp` 启动，uv.exe 随安装包预置，但首跑还需下载 managed Python（默认走 GitHub 的 python-build-standalone，国内基本超时）与 PyPI 依赖。设置页「环境检测与准备」提供一键预热——用与真实启动同构的 `uv tool run --from blender-mcp python -c "import blender_mcp"` 填满 uv 缓存后自然退出（实测国内镜像约 20-60 秒，预热后启动 1-2 秒），成功写 `userData/managed-runtimes/blender-mcp/prepared.json` 标记（记录包规格，设置 args 换包后标记失配回到未预热态）。镜像 env（npmmirror 的 python-build-standalone + 阿里云 PyPI + `UV_LINK_MODE=copy`）由 `getUvMirrorEnv()` 统一提供，预热进程与 `blender-mcp-service.ts` 的 `buildEnv()` 都注入（未预热直接连接时也走镜像兜底），用户已显式配置的 `UV_*` 变量不覆盖。宿主侧 Blender addon 仍需用户在 Blender 内手动安装启动，不在预热范围。
- **每个对话一份 Host / Runtime**，活在 `AgentSessionManager.sessions` 这个 Map 里。点另一个对话，**不会**调用 `runtime.switchSession()`。

这是和 Pi TUI 最大的产品差异：

| | Pi TUI | 晓量桌面 |
|---|---|---|
| Runtime 数量 | 1 个 | 每个对话 1 个 |
| 「换会话」 | 拆掉当前 Session，打开另一份 JSONL | 只换 Renderer 在看哪一个；旧的继续在主进程跑 |
| 必须 `waitForIdle` 的时刻 | 任何 `/resume`、`/new`、关窗口 | **替换 / 销毁这份 Runtime 时**，不是点侧栏时 |

所以原文那句「切换会话前必须 `waitForIdle()`」，在晓量里要改写成：

> 销毁、重置、导入覆盖、配置指纹变化导致重建、删对话、退应用之前必须等 idle。思考档位在现有 Pi host 上热切换，不拆 Runtime。
> **点侧栏换对话不必等**，否则后台并发任务这个产品能力就没了。

---

## 3. 对应到当前哪些 UI / UX

### 3.1 已经接上、用户每天会碰到的

| 用户动作 | UI 在哪 | 底下用的 Session / Runtime 能力 | 如果没用对会怎样 |
|---|---|---|---|
| 发一条新消息 | 输入框发送键 | `session.prompt()`，同时向后端 `startRun` | 一次用户发送 = 一个 `client_run_id` |
| **停止** | 输入框右侧暂停键 | `agent:stop` → 未执行项转 held queue + `abortCompaction/Retry/BranchSummary` + `session.abort()` + `waitForIdle()` + 等 `promptSettlement` | 工具结果还没写入 JSONL 就拆掉，投影 / 归档会缺一块。未执行项仍显示在队列中，可编辑/删除并在下次发送时恢复。**默认只停主会话**，已派出的后台子代理继续跑；「全部停止」才走 `cancelByParent` |
| **排队** | 运行中的「排队」/ Enter | `session.followUp()`：整次工作结束后再开一轮 | 仍算当前 run，不是新发送。默认下一轮 |
| **立即引导** | 队列条目类型徽章 | `setQueuedItemKind` → rebuild 为 `session.steer()`：当前 assistant + 工具跑完，下一次模型调用前插入 | 同一 `client_run_id`，不加新计费单。`subagent_task_status` 的阻塞等待会因此立刻让出 |
| 排队预览 / 编辑 / 撤回 | 输入框上方浅蓝条 | `queue_update` + `updateQueuedItem()` / `setQueuedItemKind()` / `clearQueue()` | 发送全部可编辑项和 160 字展示预览；停止后的 held 项仍保留原 id、全文和图片 |
| 侧栏「这个对话还在跑」 | 左侧会话列表圆点 / 未读 | 听 `agent_start` / `agent_settled`，**不听第一次 `agent_end`** | 重试期间绿点不会提前灭 |
| 当前对话状态文案 | 「模型调用暂未成功，正在准备重试…」「正在完成本轮任务…」 | `agent_end.willRetry` vs `agent_settled` | 第一次 `agent_end` 只改文案，不关运行态 |
| 重试倒计时 + 取消 | 会话状态条 | `auto_retry_*` → `retry_update`；取消走 `abortRetry()` | 停止任务也会取消等待中的 retry |
| 手动压缩 / 自动压缩 / overflow | 输入框旁上下文环；状态条「取消」 | `session.compact()` / 自动 compaction；`abortCompaction()` | overflow 成功时 `willRetry=true`，会接着把刚才那次请求跑完 |
| 换 Tree 路径 / 分叉 / 克隆 / 书签 | 「主线 / 分支」→ Tree 弹窗 | `navigateTree`；fork / clone **没用** `runtime.fork()`，是自己用 `SessionManager` 建新 JSONL + 新 SQLite 对话 | 运行中禁止切 Tree / 分叉 |
| Session 信息、导出 JSONL / HTML、导入 | 历史对话弹窗 | `getSessionStats` 投影、`exportToJsonl/Html`、导入后 `runtime.switchSession()` | 导入前若还在跑会拒绝 |
| 关窗口 | 标题栏关闭 | **只藏到托盘**，Runtime 继续跑 | 不 `waitForIdle`，这是故意的 |
| 退出应用 | 托盘退出 / `before-quit` | `prepareToQuit()` → `AgentSessionManager.dispose()`：对每个活跃会话 abort + 等所有 `activePromptSettlements` + `runtime.dispose()` | 否则退出时 tool result 写一半、计费 `finishRun` 没发出去 |
| 删对话 / 删项目 / 重置会话 | 历史列表、项目、清空 | `releaseSessionRuntime()` → `piHost.dispose()` → 内部 `abortAndDrain()` | 不等等于删文件时 JSONL 还在写 |
| 改思考档位 | 输入区「极速 / 深度」 | 更新共享 `thinkingModeRef`、安全 fingerprint，并在现有 Pi session 上 `setThinkingLevel()` | 不拆 Runtime，held queue 与热加载资源保持不变；后续主请求和子代理读取新档位 |

计费绑定方式，比「监听 `agent_settled`」更严一点：

1. `sendPrompt` 开头 `startRun(client_run_id)`。
2. 每次 assistant `message_end` 把 usage 记进当前 run（含 compaction）。
3. `await piHost.prompt(...)`——`prompt()` **只有在 `_emitAgentSettled` 之后才返回**。第一次带 `willRetry` 的 `agent_end` 过不去。
4. `finally` 里 `finishRun`。若 CAD 子代理还没结束，会再等到子代理 settle 才 `finishRun`。

所以：**UI 收尾看 `agent_settled`；账单关闭看 `prompt()` 返回 + 子代理结束。** 两者都比第一次 `agent_end` 晚。

对应代码：

- Host 封装：`electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts`
- 停止 / 结算 / 取用会话：`electron/runtime/agent/sessions/agent-session-manager.ts`
- 事件投影：`electron/runtime/agent/events/serialize-agent-event.ts`
- Renderer 运行态：`src/hooks/conversation-runtime-buckets.ts`、`src/hooks/use-local-agent-chat.ts`
- 侧栏圆点：`src/components/layout/workspace-sidebar.tsx`
- 停止 / 排队 / 队列改立即引导：`src/components/chat/chat-input-dock.tsx`
- Plan 模式状态机：`electron/runtime/agent/modes/plan-mode.ts`
- 计划审批 / 构件复核 overlay：`src/components/runtime/plan-approval-overlay.tsx`、`component-review-overlay.tsx`

### 3.3 Plan 模式与回合后构件复核

用户不能从输入区主动进入 Plan 模式。Plan active 期间 `beforeToolCall` 只允许写当前对话的 `plan.md`，`exit_plan_mode` 被拦截后挂出持久型 `plan_approval`。批准后同一回合继续执行；打回保持 plan active；放弃退出且不开工。

桌面非 plan 会话在回合结算前跑 `maybeStartComponentReview()`：本轮已有 draft 则直接清单，否则只要本轮读过 CAD 证据包（`delegate_cad`/`cad_evidence_image` + `read`）就交给轻量抽取落 draft，已确认或用户声明不保存则跳过。不做构件词表判断——词表列不全电梯基坑、楼梯这类构件，改由抽取模型返回空清单来兜底。

抽取调用走托管网关，必须绑定仍然存活的 run，因此它跑在 `finally` 内 `finishUsageRun()` 之前，凭证用 `buildManagedGatewayCredential(token, clientRunId)` 显式拼（此时 `activeClientRunIds` 已清），并带 30s 超时防止卡住结算。`component_review` 与 `plan_approval` 不占工具确认名额，也不被回合 `cancelConversation()` 清掉；重启从 SQLite 回灌。确认入库由运行时代调 `confirmComponents`，不经模型。

### 3.2 已经接上、但是「换对话」故意没用 `waitForIdle`

点侧栏、历史列表换对话：`selectConversation()` 只换当前显示的 `conversationId`，重新 `loadMessages`。旧对话的 Host 留在 `sessions` Map 里继续跑。

这就是「后台多任务」：侧栏用 `agent_settled` 把圆点从 running 改成 completed，并给非当前对话打未读。  
如果这里也 `waitForIdle`，点另一个对话就会卡到 CAD 子代理跑完，产品语义反了。

原文那句在晓量里真正对应的是 **「替换这份 JSONL / 拆掉这份 Runtime」**，不是「换一个聊天窗口」。

---

## 4. 已经接入、但产品还没用起来的能力

按「离用户有多远」分层。

### 4.1 IPC / Bridge 都有，Renderer 没有入口

| 能力 | 现状 | 以后可能的产品形态 |
|---|---|---|
| `listConversationSessions()` | 列出全部 Pi JSONL 绑定、模型、消息数、token、迁移状态 | 全局 Session 浏览器、迁移失败排查、客服诊断 |
| `setConversationActiveTools()` / `session.setActiveToolsByName()` | 只允许打开**已经注册**的工具名 | 「这个对话只要只读项目工具，不要 Web / 不要 delegate」；Coding 工具分档（只读 / 可写 / bash） |
| `host.registerTools()` / `replaceTools()` | 只有 Host API，**没有 IPC** | 运行中按任务类型热插工具（例如进入图纸模式才挂 CAD 证据工具） |
| `host.listSessions()` | Pi 自己的 `SessionManager.list`，和晓量 conversation 列表不是一回事 | 几乎用不上；晓量已经用 SQLite 对话列表 |

`getRuntimeResources()` 只被提示词模板面板和 `/` 补全用来读 **promptTemplates**。同一份状态里的 **extensions / skills / tools / diagnostics** 没有设置页、没有诊断面板。

### 4.2 Host 包了，但产品路径绕开或锁死

| 能力 | 现状 | 说明 |
|---|---|---|
| `runtime.fork()` | **从未调用** | 分叉 / 克隆走的是 `createConversationPiBranch()`：新 JSONL + 新 SQLite 对话。Pi TUI 的 fork 是「当前 Runtime 原地换成新文件」 |
| `runtime.newSession()` | 只在未走 JSONL 的 `reset()` 兜底路径 | 正式清空走 `switchSession(新文件)` |
| `setSteeringMode` / `setFollowUpMode` | 创建时写死 `one-at-a-time` | Pi 还有 `all`（一次吃掉整队）。文档写明不开放，避免多条意图被拼成一条 |
| `setAutoRetryEnabled` / `setAutoCompactionEnabled` | 每次创建强制 `true` | 没有「关闭自动重试 / 自动压缩」开关 |
| `session.setModel()` / `cycleModel()` / `scopedModels` | 模型由托管 Gateway 固定 | 会话级换模型 UI 已废弃；思考档位只切 `low` / `xhigh` |
| `getSessionStats()` | Host 有；UI 用的是 Manager 自己的 `summarizePiSession` | 能力重复，诊断页可以直接用 Host 这份（含 cost、contextUsage） |
| `getContextUsage()` | 未用 | 上下文环走晓量自己的 `context-tracker` |
| `waitForIdle()` 单独暴露 | 只在 Host 内部；Renderer 调不到 | 前端只能 `stop`（会 abort）或干等事件，不能「不打断、只等到写完」 |
| `getSteeringMessages()` / `pendingMessageCount` | Host 暴露只读观测点（`steeringQueueLength`、`waitForSteeringMessage()`） | 后台子任务的阻塞等待用它判断「用户插话了没有」，插话即让出 |

### 4.3 Session 上有、晓量尚未完全包

`sendCustomMessage()` 已由 Host 收窄包装成 `followUpSystemMessage()` / `promptSystemMessage()`，当前只给子代理完成回报使用；custom entry 不进入用户 composer 队列，用户队列重建时也会被 Host 保留。其余下列能力仍未转发或未产品化：

| API | Pi 原意 | 以后什么场景才值得接 |
|---|---|---|
| `sendUserMessage()` | 扩展在运行中再塞一条用户消息 | 只有明确代表用户本人发言的外部回写才应使用；系统回报继续走 custom message |
| `executeBash()` / `abortBash()` / `recordBashResult()` | TUI 的 `!command` | 模型侧 `bash` 工具已随阶段 7 接入；这里指用户手敲命令的终端面板，晓量仍没有 |
| `getUserMessagesForForking()` | TUI 选一条用户消息做 fork | Tree 弹窗已经自己列节点 |
| `cycleThinkingLevel()` | Ctrl 循环档位 | 我们只有两档，用下拉即可 |
| `session_before_switch` 取消 | 扩展可以挡住换 session | 未保存图纸 / 未确认计费时拦截「清空会话」「导入覆盖」 |
| Extension slash command（运行中立即执行） | `/compact` 这类不排队 | 现在 `/模板名` 只做提示词展开；真正的斜杠命令没有产品入口 |
| `deliverAs: "nextTurn"` | 塞进「下一轮用户消息旁边」的 aside | 系统提醒「你刚才改了项目目录」但不打断当前任务 |

### 4.4 有意关掉、不是忘了接

- ~~七个 coding tools~~ 已于阶段 7 接入：flag `pi_coding_tools` 默认 `true`（`XIAOLIANG_PI_CODING_TOOLS=off` 可回退），绑定项目的主会话注册全部七个工具，`cwd` 为项目根目录。同时 `project_list`/`project_search` 已删除、`project_read` 收窄为富文档解析工具 `doc_parse`。详见 [../pi-coding-agent-stage7-plan.md](../pi-coding-agent-stage7-plan.md)。
- `~/.pi`、项目 `.pi` 自动发现，任意本地 TS extension，Pi Packages。
- Pi TUI、主题、`/login`、provider 凭证。
- Provider 层隐藏重试（避免和外层 3 次指数退避叠成双循环）。

---

## 5. 以后哪些场景会真正用到「现在闲着的」能力

按「值不值得做」排序。

### 马上会碰到（阶段 7 / 工具治理）

1. **`setActiveTools` + 工具分档 UI**  
   Coding 工具一旦打开，必须按会话类型裁剪：CAD 主对话不要 bash；资料问答只要 read / grep / ls。API 已经在等这个面板。

2. **`registerTools` / `replaceTools`**  
   现在工具集合在 `getOrCreateSession` 时一次性建好，fingerprint 变了就整份 Runtime 拆掉重建。热插工具可以避免「改一个工具开关就 `waitForIdle` 再重建」。

3. **资源诊断面板**  
   `getRuntimeResources()` 里的 skills / tools / diagnostics 已经算好了。skill 加载失败、签名校验失败，现在只能看日志。

### 生命周期还没堵严的洞

4. **登出 / 切账号前 `waitForIdle`**  
   退出应用会等；登出只清 token，**不等**正在跑的 prompt。结果是：账单 `finishRun` 可能用过期 token 失败，或 Gateway 中途 401。这是原文「关窗口前必须 idle」在晓量里还没做完的那一段（关窗口进托盘是故意不等，登出应该等或先 stop）。

5. **给 Renderer 一个「只等、不停」的 `waitForIdle`**  
   适用：导出当前对话、云归档立刻上传、切项目根目录、关「深度思考」但不要掐断这一轮。现在要么 stop，要么干等 `agent_settled` 事件。

6. **空闲 Runtime 回收**  
   每个对话一份 Host，开多了常驻。以后可以：`agent_settled` 后过 N 分钟 `dispose()`；再发消息时 `createAgentSessionRuntime` 从同一 JSONL resume。这正是 Runtime factory 被存下来的原因。

### 产品形态升级时

7. **`runtime.fork()` vs 现在的「新对话分叉」**  
   现在分叉 = 侧栏多一条对话。若以后要「同一聊天窗原地换分支、输入框带回原文」（更像 Cursor / Pi TUI），才需要 `runtime.fork()`，因为它会在同一个 Host 里 teardown + 换文件。

8. **`sendCustomMessage`**  
   后台子代理完成已落成 custom entry：父对话 running 时走 host-owned custom follow-up，空闲 wake 也以 custom message 启动；输入框上方的 shadow queue 只保留用户 steer/followUp。后续飞书、审批回写可以复用同一系统消息边界。

9. **队列模式 `all`**  
   只在「用户明确说：下面 5 条改动一次性执行」这类批处理里才有意义。默认保持 `one-at-a-time` 是对的。

10. **`agent_settled` 扩展 hook**  
    Pi 会先 `extensionRunner.emit({ type: "agent_settled" })` 再对外广播。以后可以把「上传 JSONL、刷项目索引、通知飞书」挂在这里，而不是在 Manager 里东一块西一块。

11. **跨设备恢复**  
    Runtime 的 `switchSession(sessionFile)` + `importFromJsonl` 已经能打开一份 JSONL。缺的是云端下载完整 JSONL 的产品入口，不是 Session API。

### 不建议接的

- `cycleModel` / Pi `/login`：和托管 Gateway、账号体系冲突。
- 任意目录 extension、Pi Packages：信任边界问题，规划文档里已排除。
- 在侧栏换对话时调用 `waitForIdle`：会毁掉后台并发。

---

## 6. 对照表（原文 → 晓量现实）

| 原文说的 | 晓量里是什么 | 用起来了吗 |
|---|---|---|
| `createAgentSession` / `createAgentSessionRuntime` | `XiaoliangPiAgentHost.create()` | 是，每个对话首次 `sendPrompt` / 取用会话时 |
| `abort()` | 停止键、`dispose`、导入 / 重置前 | 是；停止会清 Pi 活队列但保留 host held queue，销毁 / 导入 / 重置才彻底释放 |
| `waitForIdle()` | Host 内部；退出、销毁、停止链路 | 是，但 **换对话 / 关窗口进托盘 / 登出** 不调 |
| `agent_settled` | 关运行态、侧栏圆点、未读、冲刷流式 Markdown | 是 |
| 计费绑 settled 不绑第一次 `agent_end` | `await prompt()` 返回后 `finishRun`，子代理再推迟 | 是，且比单纯听事件更严 |
| 换会话前 idle | 只在 **替换 JSONL / 拆 Runtime** 时 | 部分是；侧栏换对话故意不是 |

一句话收束：

**`AgentSession` 是「这一轮对话怎么跑完」；`AgentSessionRuntime` 是「这份跑完的东西如何被安全换掉」。**  
晓量把前者用满了（停、追加、重试、压缩、计费、退出、子代理 custom 回报）；后者只在导入、重置、销毁、退出时用。还空着的，主要是工具开关、诊断、登出等待，以及以后做 Coding Agent / 原地分叉时才会需要的 `setActiveTools`、`registerTools`、`runtime.fork`。
