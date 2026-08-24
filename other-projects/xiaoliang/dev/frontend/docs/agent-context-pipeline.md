# Agent 上下文是如何进入模型的

> 2026-08-19 与「主 Agent 通用检索补回」同步更新。原则：**每条规则只有一个权威位置；system prompt 保持字节稳定；每轮层只报状态**。

本文描述 **desktop 本地 runtime** 里，主 Agent 一次请求的上下文组成：**system prompt**、**tools**、**每轮注入层**、**对话历史**；以及 subagent 的独立管线。

---

## 1. 两条互不相通的管线

| 管线 | system | tools | 每轮注入 | 历史 |
|------|--------|-------|----------|------|
| 主 Agent | `buildSystemPrompt()` + `before_agent_start` 追加 `[受控 Pi skills]` | 38 个左右可见工具（`createAgentTools` → `filterVisibleTools`） | `transformContext` 把 context layers 合成一条伪 user 消息追加到队尾 | 会话消息 + Pi 压缩 |
| Subagent | definition 正文 + `[trusted_child_environment]` | definition 里 ceiling 内的工具 | 无（`contextInheritance: none`，硬约束） | 仅本次委派 |

Child 看不到父 transcript、父 system、workspace 与项目 AGENTS.md；宿主只回传 evidence refs 与安全元数据。

---

## 2. 主 Agent system prompt 段落（`prompts/system/builder.ts`）

按顺序拼接，全部由 `toolNames` / 模式派生，**不含时间等易变字段**，同一会话内字节稳定、可命中网关前缀缓存：

1. **`[角色]`** — 身份、CAD 隔离一句话、委派回合纪律一句话、证据分级（证据分级的唯一权威）。
2. **`[计划模式]`**（仅 plan 模式）— plan.md 工作方式。
3. **`[任务路由]`** — **委派政策唯一权威**：何时 delegate_cad / drafter / blender、活动图优先与不猜图、CAD→Blender 串行、interactive/blocking 等待纪律。
4. **`[输出风格]`** — 回答组织、产品语言、事实保真。
5. **`[工具边界]`** — 工具机制唯一权威：交互确认、CAD 隔离与证据消费（evidence.md 读法）、文件/富文档/产物/构件库、联网 region 规则全文、构件算法门槛。
6. **`[skills 边界]`** — pi_extensions 开启时只有政策三行；关闭时输出完整目录。
7. **`[通用 skills]`**（仅 pi_extensions 关闭时）— 只列写产物与自制 skill，不再列富文档阅读 skill。
8. **`[用户 skills]`** — 两行政策 + 已启用用户 skill 列表。

`before_agent_start` 时 Pi host 在 system 末尾追加 **`[受控 Pi skills]`**：一行政策 + `- name：description` 紧凑目录（skill 集不变则字节稳定）。

PDF、Word、PowerPoint、Excel 的阅读由 `[工具边界]` 直接路由到 `doc_parse`。`project-file-reading-playbook`、`pdf-reading`、`docx-reading`、`spreadsheet-reading` 已静态下架，避免普通资料问答先触发一次强制 skill 全文读取；写产物的 4 个 writing skills 与 `create-skills` 仍按任务匹配读取。这里采用随版本固定的目录裁剪，不做逐轮动态 skill 过滤，因此不会把易变判断放进缓存前缀。

联网只由主 Agent 的 `web_search` 和 `web_fetch` 分工处理。`web_search` 返回后端的结构化 `sources`（title / url / snippet / site / published_at）及 provider、fallback_reason、status，保持 provider 命中顺序，不把检索模型综述放进模型上下文；后端优先博查 SERP，配置为空或通道不可用时降级 Qwen。`web_fetch` 优先使用本机确定性 HTML/text/PDF 读取，本机网络、HTTP、超时、正文抽取失败或动态应用骨架再尝试后端 Qwen。本机静态通道默认只走可 DNS pin 的 DIRECT，系统/PAC 代理与隐藏 Chromium 都因代理端/子资源解析无法保持这一边界而默认关闭，仅允许运维显式 opt-in。短正文只内联，长正文才写项目 `.xiaoliang/web/pages/*.md` 并返回路径与 hash，写入失败也保留有界预览和 `storage_warning`。Pi 通用文件工具不可用时，运行时只补一个限制到该 artifact 目录的只读 `read`。

搜索 snippet 只用于选源，域名本身（包括 `gov.cn`）不构成自动信任或现行有效证明。工程标准、政策、标准表格、造价和审图依据必须用 `web_fetch` 正文核对编号/条号、发布与实施日期、现行效力、适用范围和实际发布机关 URL；只有 snippet、转载或征求意见稿时标为待核，并建议人工复核。`research-analyst` 与 `delegate_research` 保持退役，旧 `.xiaoliang/research/` 仅作只读历史归档，不能把其中 raw pages 当成新证据。

原 `[运行时提醒]` 已移出 system prompt（见下一节）。

---

## 3. 每轮 `transformContext` 注入什么（`agent-session-manager.ts`）

`collectContextProviderLayers` + `assembleContextLayers`（预算 `max(4k, 12k)` token，`ceil(len/4)` 估算），非空时合成**一条 `role: 'user'` 消息追加到 messages 队尾**，开头是固定的 `CONTEXT_SNAPSHOT_PREFACE` 来源说明行。

队尾而非队首是缓存要求：这一层带 `当前时间`，放在队首会让其后的整段历史每轮错开前缀，网关只能缓存 system + tools（实测 `main` 命中量恒定在 1.4 万 token 左右、与对话长度无关）。挪到队尾后 system、tools 与全部历史构成稳定前缀。详见 [docs/agent-context/02](../../../docs/agent-context/02-per-turn-context-layers.md)。

| 层 | 内容 | 原则 |
|----|------|------|
| `[agent_workspace]` | workspace 路径状态 + 5 个核心文件全文 + 最近项目 | 只报状态与文件内容，不重复 system 规则 |
| `[project_context]` | 项目目录路径状态、索引统计、项目 AGENTS.md 全文 | 富文档/文件工具用法归 `[工具边界]`，此处不再携带 |
| `[cad_session]` | 来源说明 + AutoCAD 状态 + 当前活动图 + 项目相对路径 | 只报状态；委派指令归 `[任务路由]` |
| `[runtime_reminder]` | 当前时间、模型、会话名、本轮图片数、联网 region 国家级兜底、备选取证提示 | 易变字段全部集中在此层，换取 system 稳定 |
| `[cad_evidence_preflight]` 等 | 构件工作流命中时按需出现 | 条件层 |
| `[plan_reminder_*]` | plan 模式提醒 | 条件层 |

---

## 4. Subagent 管线（`fresh-pi-subagent-runner.ts`）

- system = definition 正文（`subagents/definitions/*.md`）+ `[trusted_child_environment]`。
- 首条 user = `BEGIN DELEGATED TASK` 包装的自包含任务；CAD 委派会追加 `[host_cad_session]`（仅状态字段：source / autocad_state / active_document_name / project_relative_path / updated_at；图纸选择优先级由 definition 第 3 条唯一权威）。
- definition 里操作规程只保留工具描述覆盖不到的策略与领域知识；四章 evidence 模板（目标定位 / 图片证据 / 实体与文件摘录 / 限制与未采用材料）在 analyst 与 drafter 各自保留一份（child 是独立进程，.md 需自包含）。

---

## 5. 规则归属速查

| 规则 | 唯一权威位置 |
|------|--------------|
| 何时委派 CAD / 活动图优先 / 不猜图 | `[任务路由]` |
| 委派后等待纪律（interactive/blocking） | `[任务路由]`（`[角色]` 一句话摘要） |
| evidence.md 消费方式 | `[工具边界]`【证据消费】 |
| CAD→Blender 串行与并行边界 | `[任务路由]` |
| 证据分级（实体权威 / 图片只看形态） | `[角色]` |
| 联网 region 规则全文 | `[工具边界]`【联网区域】（web 工具描述只留一句指引） |
| 主 Agent 搜索、原文打开与工程高风险人工复核边界 | `[工具边界]`【联网边界】【网页正文】 |
| 旧 research 原文与 evidence pack 的归档保护 | `pi-coding/index.ts` + `agent/README.md` |
| 动态网页渲染机制与安全限制 | `web-research/render-window.ts` + `agent/README.md` |
| 富文档路由（直接 `doc_parse`，不先读 skill） | `[工具边界]`【富文档】 |
| 产物与自制 skill slug 列表 | `project_document_skill_read` 参数 enum |
| child 图纸选择优先级 | definition 第 3 条 |

---

## 6. 相关源码索引

| 文件 | 职责 |
|------|------|
| `electron/runtime/agent/prompts/system/builder.ts` | 系统提示拼装 |
| `electron/runtime/agent/prompts/system/sections/*.ts` | 各段正文 |
| `electron/runtime/agent/prompts/reminders/runtime-reminder-builder.ts` | `[runtime_reminder]` 层正文 |
| `electron/runtime/agent/sessions/agent-session-manager.ts` | `transformContext`、system prompt 更新 |
| `electron/runtime/agent/context/context-assembler.ts` | 分层、预算裁剪、`renderContextLayers` |
| `electron/runtime/agent/context/providers/*.ts` | workspace / project / cad_session 三个状态层 |
| `electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts` | `[受控 Pi skills]` 追加 |
| `electron/runtime/agent/subagents/fresh-pi-subagent-runner.ts` | child system / delegated prompt 组装 |
| `electron/runtime/web-research/index.ts` | 静态读取、通用 web 页面落盘与渲染降级 |
| `electron/runtime/web-research/render-window.ts` | 隐藏 Chromium 渲染与导航限制 |

*若你修改 prompt 段落或新增 provider，请同步更新本文与 `docs/llm-context/optimization-report.md`。*
