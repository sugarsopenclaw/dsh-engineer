# 晓量桌面端：Electron IPC 说明

本文描述 `electron/preload.ts` 白名单、主进程处理、以及 **React 当前实际调用** 的关系。修改 IPC 时请同步更新 `src/shared/ipc-contract.ts`、`electron/runtime/ipc/ipc-handlers.ts`、`src/services/electron-bridge.ts` 与 `src/types/electron.d.ts`；preload 会从共享 contract 生成白名单。

---

## 一、渲染进程当前「在用」的能力（已接入 `electron-bridge`）

以下由 `src/services/electron-bridge.ts` 封装；除标注“预留”的能力外，均已被 hooks / 组件使用。

| 能力 | 通道 | 调用方 |
|------|------|--------|
| 读取系统主题（亮/暗） | `invoke` `theme:getSystemTheme` | `theme-store` → `syncFromElectron` |
| 系统主题变化推送 | `on` `theme:changed` | `useThemeSync` |
| 查询是否置顶 | `invoke` `window:getAlwaysOnTopStatus` | `useWindowControl` |
| 置顶/取消置顶 | `send` `window:pin` | 标题栏置顶按钮 |
| 最小化 | `send` `window:minimize` | 标题栏 |
| 关闭（隐藏到托盘） | `send` `window:close` | 标题栏 |
| 切换窗口尺寸模式 | `send` `window:toggle-size` | `useWindowControl`（预留，标题栏未绑按钮时可不接） |
| 退出应用 | `send` `app:quit` | `useWindowControl`（预留） |
| 自动更新状态推送 | `on` `update:status` | 应用内更新横幅 |
| 项目预览目录列表 | `invoke` `agent:listProjectPreviewDirectory` | 右侧工作区「文件预览」目录树 |
| 项目文件只读预览 | `invoke` `agent:readProjectFilePreview` | 文本、Markdown、图片、PDF、表格与 DOCX 预览 |
| 子代理运行列表 | `invoke` `agent:listSubagentRuns` | 右侧工作区「子代理」 |
| 子代理轨迹分页回放 | `invoke` `agent:getSubagentTrace` | 子代理轨迹详情 |
| 子代理截图读取 | `invoke` `agent:getSubagentTraceBlob` | 轨迹截图按需预览 |
| 子代理轨迹实时推送 | `on` `subagent:traceEvent` | 子代理轨迹详情（单底层订阅） |
| 发送新的计费任务 | `invoke` `agent:sendPrompt` | `useLocalAgentChat.sendPrompt` |
| 切换会话 Agent/Plan 模式 | `invoke` `agent:setConversationMode` | 运行时内部使用；输入区不提供入口 |
| 读取当前计划文件 | `invoke` `agent:getPlanDocument` | 计划审批 overlay |
| 打开计划审批面 | `invoke` `agent:openPlanApproval` | 运行时恢复/模型提交计划时使用；输入区不提供入口 |
| 查询待处理交互 | `invoke` `agent:getPendingInteraction` | 切会话回灌确认卡、计划审批、构件复核 |
| 响应交互 | `invoke` `agent:resolveInteraction` | A2UI 确认卡与自研 overlay |
| 恢复会话运行快照 | `invoke` `agent:getRunningConversations` | 会话分桶与侧栏运行/排队指示 |
| 手动压缩会话上下文 | `invoke` `agent:compactContext` | composer 上下文环；可附带希望保留的重点，返回 `completed` 或 `stopped` |
| 取消上下文压缩 | `invoke` `agent:abortCompaction` | 会话状态栏的“取消” |
| 取消分支摘要 | `invoke` `agent:abortBranchSummary` | 会话分支面板内的“停止生成摘要” |
| 取消自动重试 | `invoke` `agent:abortRetry` | 会话状态栏的“取消” |
| 运行中排队 | `invoke` `agent:followUp` | 运行中 composer 的“排队”按钮 / Enter，默认下一轮 |
| 队列改为立即引导 | `invoke` `agent:setQueueItemKind` | 排队预览条上的类型徽章；`steer` 会在下次模型调用前插入 |
| 直接插入当前任务 | `invoke` `agent:steer` | 仍保留；composer 不再调用，改类型时由 host 重建为 `session.steer` |
| 撤回未执行队列 | `invoke` `agent:clearQueue` | 排队消息预览条 |
| 停止并安全等待 | `invoke` `agent:stop` | 停止按钮；未执行队列留在 host 的 held 状态，可继续编辑或随下一次发送恢复 |
| Agent 生命周期与队列推送 | `on` `agent:event` | 消息流、队列、retry、compaction、`agent_settled` |
| 查询 Pi 受控资源状态 | `invoke` `agent:getRuntimeResources` | 提示词模板面板与 `/` 模板补全 |
| 切换 Pi 活跃工具 | `invoke` `agent:setActiveTools` | `electron-bridge`（动态工具编排预留） |
| 查询个人提示词模板 | `invoke` `promptTemplate:list` | 提示词模板面板与 `/` 模板补全 |
| 新建个人提示词模板 | `invoke` `promptTemplate:create` | 提示词模板面板 |
| 修改个人提示词模板 | `invoke` `promptTemplate:update` | 提示词模板面板 |
| 删除个人提示词模板 | `invoke` `promptTemplate:delete` | 提示词模板面板 |

项目文件预览只接受项目根目录内的规范相对路径，拒绝符号链接。文本按 256 KB 分段且单次预览累计最多 4 MB；图片、PDF 与 Office 文件使用固定上限的快照读取，并在读后复核文件大小与修改时间。DOCX 在无同源权限、禁止联网的 sandbox iframe 中渲染，渲染结果消毒后才进入可见文档。

---

## 二、主进程已接好、但前端尚未通过 bridge 调用的能力

这些通道已在 **preload 白名单** 和 **ipcHandlers** 中注册，可在业务里直接使用：

```ts
window.electronAPI.invoke('theme:setTheme', 'light' | 'dark' | 'system')
```

或按 `src/types/electron.d.ts` 中 `ElectronAPI` 的签名调用截图相关 `invoke`。

| 能力 | 说明 |
|------|------|
| `theme:setTheme` | 设置 `nativeTheme.themeSource`，适合后续「设置」页切换浅色/深色/跟随系统 |
| `screenshot:*` | 屏幕源枚举、窗口源、按源截图、桌面截图、多屏截图、状态查询 — 与后续「截图辅助算量」等产品功能对接时再封装到 `electron-bridge` 或独立 hook 即可 |

---

## 三、已从产品中移除的能力

| 原能力 | 说明 |
|--------|------|
| 剪贴板读写 / 监听 / `clipboard:changed` | 与后续产品方向无关，已删除主进程 `clipboardManager`、preload 通道、以及前端相关封装 |

---

## 四、同步移除的冗余

- **`window:maximize`**：此前无任何 UI 或 bridge 调用，已从 preload 与 ipcHandlers 移除；`windowManager.toggleMaximizeWindow` 已删除。

---

## 五、开发流程备忘

1. 在 `src/shared/ipc-contract.ts` 声明通道。
2. 在 `electron/runtime/ipc/ipc-handlers.ts` 实现并在 `dispose()` 中移除 handler。
3. 更新 `src/types/electron.d.ts` 中 `ElectronAPI`。
4. 在 `src/services/electron-bridge.ts` 增加封装。
5. 若涉及推送，更新 `src/shared/local-agent.ts` 的 `AgentUiEvent`。

非 Electron 环境：`isElectronApp()` 为 false 时，bridge 内方法已做降级，避免在纯 `vite` 预览时报错。

---

发版、版本号与安装包产物说明见同级目录上一级的 [`RELEASING.md`](../RELEASING.md)。

## 六、Pi 队列与结算事件约定

- `agent:steer` 与 `agent:followUp` 只在 Pi session 仍处于 active run 时接受，不创建新的 `client_run_id`。运行中 composer 只走 `followUp`；`agent:setQueueItemKind` 在同一条排队消息上切换 `steer` / `followUp`。
- steering 消息会在当前 assistant turn / tool calls 结束后、下一次模型调用前进入上下文；follow-up 消息会等当前 agent 工作完全结束后再开始。切到 `steer` 时与直接 `agent:steer` 一样会让出阻塞等待。
- 两类队列均固定使用 Pi 默认的 `one-at-a-time`：每次只取一条，避免多条用户意图被合并。底层的 `all` 表示一次取出当类队列的全部消息，本产品不向用户开放切换。
- `queue_update` 向 Renderer 发送 steer/followUp 数量及全部可编辑队列项；每项包含稳定 id、类型、全文、图片载荷和最多 160 字符的展示预览。全文与图片是当前原位编辑/缩略图契约的一部分，若载荷继续增大，应先改为按 id 获取详情，而不是静默截断可编辑内容。
- `agent_end` 是一次底层 Agent loop 结束，`willRetry=true` 时运行仍未结束；Renderer 不在这里关闭运行态。
- `agent_settled` 才表示 Pi 的 retry、continuation 与排队消息全部结束，主进程随后完成计费和 SQLite 投影。
- `transcript_message` 表示一条已落入 SQLite 展示投影的行需要在当前回合内即时插入。它同时承载真实 user 行与 host-owned notice，不按底层 session role 猜测 UI 语义；Renderer 会先封存仍在 overlay 中的上一段 assistant，再插入该行，最终仍由整表刷新对账。该事件不结算 prompt，也不触发未读/托盘完成通知。
- `messages_updated` 是通用内容刷新；只有携带 `promptSettled=true` 时才可作为 prompt 已持久化的完成信号。Tree、导入、fork 与手动压缩刷新不触发托盘完成通知或侧栏未读。
- `agent:stop` 会把未执行队列从 Pi 活队列移到 host 的 held 阴影队列，再 abort 并等待 tool result、中止消息、事件投影、计费收尾与本地持久化。Renderer 保留队列条目，可原位编辑/删除；下一次发送开始时 host 把 held 项按原 id、类型、文字和图片重建回 Pi 队列。因配置指纹而替换 host 或热重载资源时也必须迁移这些 held 项。
- `retry_update` 投影 Pi 的主模型及摘要重试状态；`waiting` 携带 `attempt`、`maxAttempts`、`delayMs` 与 `scheduledAt`，Renderer 据此显示倒计时。停止任务会取消正在等待的 retry。
- `compaction_update` 投影 `manual`、`threshold`、`overflow` 三类压缩的开始、完成、失败或取消状态；overflow 成功时 `willRetry=true`，表示 Pi 会恢复被中断的请求。
- retry 使用统一的高层 Pi 策略（最多 3 次，2 秒起始的指数退避）。provider 隐藏重试关闭，避免同一错误形成嵌套重试。
- 自动上下文压缩与自动重试在每次 Pi runtime 创建或重建时都强制开启，不提供会话级关闭入口。
- 手动压缩创建独立 run；阈值压缩和 overflow 恢复沿用当前 prompt run。摘要请求及其重试统一标记 `xiaoliang_call_purpose=compaction`，usage 同步计入当前 run。压缩本身也按 token 扣 credits，与普通请求同价。
- Pi compaction 只追加 JSONL checkpoint 并重建活动上下文，不删除 session Tree 中的原始消息；旧的 `messages[]` 替换式 compactor 已移除。
- 应用 `before-quit` 会等待所有 active prompt settlement 和 runtime dispose，再允许 Electron 真正退出。

## 七、自动更新状态载荷

`update:status` 由主进程 `autoUpdateManager` 在更新生命周期内发出，载荷结构为：

```ts
type UpdateStatusPayload = {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string | null
  percent?: number | null
  message?: string | null
}
```

约定：

- `checking`：开始检查更新
- `available`：已发现新版本
- `downloading`：后台下载中，`percent` 可能存在
- `downloaded`：更新包已下载完成
- `error`：检查或下载失败
- `idle`：当前无需展示更新横幅

## 八、Pi 受控资源约定

- 仅当 `pi_runtime_v2` 与 `pi_extensions` 同时启用时开放上述资源通道。
- Pi resource loader 的 skill 路径只允许随包目录和经 manifest/checksum 校验的托管目录；项目级 prompt template 只从 `<project>/.xiaoliang/prompts/*.md` 读取。
- Pi 的默认 extension、skill、prompt、theme 和 context 自动发现始终关闭；主进程只传入应用构造的 inline extension factory 与显式校验后的资源路径。
- 安装新的托管 skill 包后，主进程会重载当前空闲 Pi 会话；运行中的会话保留本轮快照，下一次取用会话时再刷新。
- 每次取用已有会话时还会比较受控资源 revision；检测到资源版本变化会在空闲时自动重载，因此无需手动“重新加载技能与模板”。
- `agent:setActiveTools` 只接受当前会话已注册的工具名，未知工具会被拒绝；资源与工具状态由 `PiRuntimeResourceStatus` 返回。
- 个人提示词模板不进入 Pi 资源发现路径：数据库是权限与列表查询的事实来源，完整内容同时写入账号隔离的私有 OSS 对象；面板打开、应用重新聚焦和 CRUD 成功后会自动同步。
