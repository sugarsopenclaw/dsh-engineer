# Agent Harness 目录骨架

当前 `agent/` 目录按能力面拆分，而不是按一次性功能堆文件。

- `prompts/`
  负责稳定系统提示词、动态 reminders、任务提示片段、守卫规则片段。
- `context/`
  负责把 prompts、skills、memory、task state、multimodal 输入装配成送给模型的上下文。
- `tools/`
  负责所有可执行原子能力的注册与分层，包括本地工具、业务工具、CAD 原子能力。
- `mcp/`
  负责外部 MCP server 的配置、连接、认证、能力发现和回接到统一工具总线。
- `skills/`
  负责技能目录、匹配、按需注入、云同步、模型生成技能的落盘。
- `memory/`
  负责当前会话的上下文压缩。
- `sessions/`
  负责 agent 实例生命周期、恢复、停止、中断与 conversation 绑定。
- `pi/`
  负责 Pi session host、受控 inline extensions、动态工具注册，以及显式 skills / prompt templates 的解析和重载。Pi 的默认文件系统自动发现保持关闭；项目 prompt 仅允许 `<project>/.xiaoliang/prompts/*.md`，托管 skill 必须通过 manifest/checksum 校验。
- `subagents/`
  负责隔离子代理定义、按角色独立的 FIFO admission、生命周期/取消、证据或执行报告发布和安全结果投影。当前可运行角色只有只读取证 `cad-analyst`、MLightCAD 读图与制图 `cad-drafter`、Blender 执行 `blender-modeler`。`research-analyst` 已退役，仅保留旧运行记录的类型兼容。
- `web-research/`（在 `runtime/` 下，与 `agent/` 平级）
  负责主 Agent 的本机网页读取内核：SSRF 防护、受控跳转的 HTTP 客户端、HTML→Markdown 剥壳、PDF 文本层抽取、显式 opt-in 的 Electron 隐藏 Chromium，以及长正文 artifact。短正文只在本轮内联；长正文才原子写入项目 `.xiaoliang/web/pages/`。旧 `.xiaoliang/research/` 内容只作为历史归档保留。
- `events/`
  负责模型事件、工具事件、任务事件到 UI/日志事件的序列化与分发。
- `policy/`
  负责权限、审批、安全边界、领域写保护。
- `tasks/`
  负责计划图、后台任务、定时调度和长期工作流。
- `routing/`
  负责模型路由、技能路由、工具路由、构件家族/亚型路由。
- `telemetry/`
  负责日志、trace、token/cost、耗时和可观测性。
- `testing/`
  负责 fake tools、fake MCP、fixture、contract tests。

边界约定：

- `tools` 是“会真的动系统和数据的原子能力”。
- `skills` 是“可复用的知识、步骤、约束和领域策略”。
- `mcp` 是“外部能力协议层”，不是业务逻辑本身。
- AutoCAD COM API 只允许沉到 cadsubagent 私有工具与 bridge application 层；主 Agent registry 不得导入或构造这些能力。
- Blender MCP 只允许进入 `blender-modeler` 私有工具表；主 Agent 只能看到 `delegate_blender`，不能直接执行 Blender MCP 或 Python。
- `subagents` 不复用父会话 messages、memory 或 transformContext；child transcript 和工具正文也不能回流父模型。
- `cad-analyst` 的工具能力取“随包定义 allowlist ∩ 运行时 ceiling”，并固定为只读 CAD 取证能力；项目文件不能覆盖该定义。
- `cad-drafter` 走内置 MLightCAD 引擎解析图纸，不取 AutoCAD lease、不使用 `agentRole: 'cad-analyst'` 的 bridge identity，因此与 `cad-analyst` 真正并行；它的并发上限对应 MLight session pool 而非 COM 串行限制。
- `cad-drafter` 当前是只读文件通道：`cad_draft` / `cad_export` 的实现仍在 `draft-tools.ts`，但没有挂进 `buildCadDrafterTools`，运行时工具 ceiling 里也没有它们，所以这个角色不具备写图能力。若将来重新接线，隔离仍由三层保证：改写只在不入池的私有窗口里做，池中的读会话不会被污染；所有图元必须落在 `XL-` 前缀图层上（工具层硬编码，不是提示词约定）；产物只能写进 `xiaoliang-outputs/cad/`，禁止覆盖已存在文件、限定扩展名、拒绝符号链接逃逸，并按 child 记账到 `.provenance.jsonl`。
- `cad-drafter` 的能力边界来自底层解析器（LibreDWG wasm）：线框表格、平面/立面扫图、文字与编号定位可靠；OLE/Excel 嵌入表只能渲成空白块、嵌套块内部几何取不到坐标、handle 字段非权威。这些盲区在工具结果里带 warning，并写进定义与父提示词的分工约定。
- 两个 CAD 角色共用同一条 staging → promote → manifest → evidence 证据链。实体索引由 `cad-subagent/entity-index.ts` 统一发布，producer 指纹描述的是解析出这些字节的引擎而非发起调用的角色，因此 MLight 索引在两者之间互为缓存命中，不会相互判定 `stale_pipeline`。drafter 的图片落在与 COM plot 同一 `previews/` 根下的 `mlight/` 子目录，证据图片白名单无需按引擎特判。
- `blender-modeler` 同样使用固定定义与运行时 ceiling，只能检查、修改和截图核验当前 Blender 场景，不读取 CAD、项目文件或父会话。
- `subagent-runtime` 在统一会话入口注册 `delegate_blender`；项目 CAD 上下文可用且安全开关允许时再注册 `delegate_cad` 与 `delegate_cad_drafter`。两条 CAD 通道默认都开（`XIAOLIANG_CAD_DRAFTER=off` 可单独关掉文件通道），按证据类型分工、可同时进行，文件通道不再要求"本会话已有进行中的 analyst"。由主模型按意图自动选择，用户不需要切换能力模式。
- CAD 默认 flag 为 `on`；`canary` 可按项目灰度，`off` 只暂停 CAD 自动化，不影响 Blender 子代理，也不会向父工具表恢复 legacy CAD 工具。父 Agent 只允许读取当前会话已完成 CAD child 发布的 canonical evidence 和其中显式引用图片。
- 主 Agent 只有两项通用联网工具：`web_search` 与 `web_fetch`。`web_search` 后端优先走博查 SERP，博查不可用时降级 Qwen；它按 provider 原顺序返回 `sources` 中的结构化 title / url / snippet / site / published_at，并显式带回 provider、fallback_reason 与 status，不把检索模型综述传给主 Agent。`web_fetch` 优先用上述本机读取内核取得单页正文，本机网络、HTTP、超时、空正文、动态渲染或 PDF 文字层等失败时才调用后端 Qwen `/web/fetch` 兜底。`XIAOLIANG_MAIN_WEB_FETCH=off` 可关闭正文工具，搜索仍可用；不再有 `web_research` 工具、路由或功能开关。
- `web_search` 的 snippet 只用于选源，任何域名（包括 `gov.cn`）都不会被自动判为可信或现行有效。工程标准、政策和造价依据必须再用 `web_fetch` 正文核对编号/条号、发布与实施日期、现行效力、适用范围和实际发布机关 URL；只有 snippet、转载或征求意见稿时标为待核，并建议人工复核。
- `research-analyst` 的 definition、私有工具组、运行时注册、功能开关和 `delegate_research` 已删除；注册表与委派服务都 fail closed，CAD evidence writer 也拒绝该旧类型，无法再启动任务或写出新 research evidence。`research-analyst` 字符串仍留在协议/UI/安全投影中，只为显示已有运行记录；`.xiaoliang/research/` 与用户数据目录中的旧 trace/evidence/page 不删除。
- 历史 `.xiaoliang/research/pages/` 继续封存：父级 `read/grep/find/ls` 拒绝或过滤原始页面，`.xiaoliang/research/` 也保持写保护；已发布的旧 evidence pack 仍可读取。这是历史数据兼容，不代表 research 子代理仍可运行。
- `web_fetch` 成功抽取在进程内缓存 15 分钟/64 条（缓存正文，与本次 `max_chars` 展示上限无关），网络阶段由全局 4、同 host 2 的闸门保护，TIMEOUT/5xx 只重试一次。它尊重显式 `http` URL，但拒绝 URL 凭据、私网/元数据目标与 HTTPS→HTTP 降级跳转；私网拦截不会把目标发送给后端，降级拦截只把原始 https URL 交后端 Qwen 兜底，绝不发送降级后的 http 地址。静态抓取默认使用经过 DNS 校验和连接 pin 的 DIRECT；系统/PAC 代理会在代理端重新解析域名，因此默认不使用，只有运维明确接受该边界并设置 `XIAOLIANG_WEB_SYSTEM_PROXY=on` 后才启用。DIRECT 遇到 Fake-IP/DNS/普通网络失败会改走 Qwen，真正解析到私网的目标不会转发。静态 HTML 为空或判断为应用骨架时默认直接降级 Qwen，因为 Chromium 子资源连接无法沿用本机 HTTP 客户端的 DNS pin；只有运维显式设置 `XIAOLIANG_WEB_RENDER=on` 才启用 `render-window.ts`。渲染窗与静态抓取共用 `XIAOLIANG_WEB_SYSTEM_PROXY` 闸门：未开启时 `session.setProxy({ mode: 'direct' })` 强制直连，不再使用 Chromium 的系统/PAC 解析。启用后每次创建随机非持久 partition 的隐藏 `BrowserWindow`，启用 sandbox/contextIsolation，禁 preload、nodeIntegration、webview、弹窗、下载、权限与图片，主框架仅允许原 host 的 http/https 导航；渲染窗自身全局并发为 1，默认 45 秒超时。`render=true` 仍受该开关约束，关闭时改走 Qwen 兜底。
- 本机或 Qwen 取得的短正文只随工具结果内联，不写知识库；正文超过 `max_chars` 时才把完整内容写入项目 `.xiaoliang/web/pages/*.md`，返回有界预览、路径与 SHA-256。写入失败或正文超过 artifact 上限时仍保留有界预览，并返回 `storage_warning`。Pi 通用 `read` 可直接续读；Pi 文件工具关闭时只注册一个限制到该目录的只读 `read`，按 offset/limit 分页、单次正文最多 6 万字，超长单行按 next_offset/next_char_offset 续读，不会暴露项目其他文件。
