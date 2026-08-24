# 晓量 Multiagent CAD 改造规划

状态：Accepted（推荐方案已于 2026-08-09 确认）

基线日期：2026-08-09

目标版本：以可回滚的多阶段迭代替换当前主 Agent 直连 CAD 的架构

## 1. 结论

晓量应采用“通用 Subagent 内核 + 单一 CAD 证据子代理”的目标架构：

- 主 Agent 继续负责理解完整对话、形成自包含委派任务、综合工程知识并回答用户。
- `cad-analyst`（下文也称 cadsubagent）使用独立 Qwen3.8 Max 会话，只负责 CAD 定位、抽取、视觉概览、局部精读和证据整理。
- 主 Agent 的模型可见 CAD 工具收敛为一个 `delegate`；所有直接接触 AutoCAD、DWG、CAD 截图或 CAD 产物的工具只对 cadsubagent 可见。
- MLightCAD 是默认的只读实体索引器；AutoCAD Python COM bridge 是活动文档、handle 权威字段、图框、精准切图和局部精读的事实源。
- 视觉概览固定采用“全图 + 四象限；只对 `needs_zoom` 象限再分四”的两级流程，最多 21 张图、最多两次宏观视觉模型调用。
- cadsubagent 不回答用户，只生成项目内 evidence pack；主 Agent 只收到 evidence path 和安全元数据，随后选择性读取证据与图片并作最终判断。
- 主 Agent、cadsubagent、`cad_query`、视觉概览、压缩等模型链路统一经晓量 gateway 使用 Qwen3.8 Max；模型能力目录是参数和上下文窗口的唯一事实源。

这不是在现有主 Agent 上继续增加 CAD 工具，而是一次明确的权限边界和上下文边界重构。

## 2. 为什么现在要改

当前晓量已经具备较丰富的 CAD 能力，但编排层过度集中：

- `dev/frontend/electron/runtime/agent/sessions/agent-session-manager.ts` 约 59.6 万字节，同时承担主会话、CAD 全图扫描、视觉规划、视觉模型调用、RAG、精读、缓存和 UI 手动任务。
- `dev/frontend/electron/runtime/agent/tools/index.ts` 仍向主 Agent 暴露多种 CAD 原子与复合工具，图片 ToolResult 会进入主会话上下文。
- `readCadDrawing` 与 `indexCadDrawingVisual` 由 UI 按钮和 IPC 显式触发；系统提示还会要求用户点击“读取实体”或“视觉识图”。
- 现有 CAD 产物位于 Electron `userData/cad-drawings`，缺少项目内可移植 manifest、源 DWG SHA-256、producer fingerprint 和 staging 发布事务。
- 当前视觉流程会规划较多窗口并反复识别；pi-engineering 已验证的固定象限方案更简单、可控且容易建立质量门禁。

因此，继续在 `agent-session-manager.ts` 中局部优化无法解决上下文污染、权限面过大、自动化入口分散和产物不可审计的问题。

## 3. 参考基线与取舍

本规划基于以下本地参考代码，而不是仅参考说明文档：

- pi-engineering `9bddd7f1`：独立会话与桌面运行时。
- pi-engineering `1256bf10`：subagent 投影。
- pi-engineering `b2dbecab`：MLightCAD 抽取、`cad_query`、child trace 与 evidence pack。
- pi-engineering `engineering/specs/030-cad-subagent.md`、`060-cad-first-class-tools.md`。
- pi-engineering `engineering/pi-cad/src/delegate.ts`、`tools/cad-first-class.ts`、`tools/visual-index.ts`。
- pi-engineering `engineering/cad-bridge` 的 loopback HTTP、单 STA worker、象限数学和 plot/detail 实现。
- grok-build 的 `SubagentCoordinator`、mailbox、admission、运行状态、父会话/父 turn 归属、取消和用量汇总。

采用的原则：

1. 采用 pi-engineering 的 CAD 能力面、上下文隔离、证据包、MLightCAD + COM 双通道和精读纪律。
2. 采用 grok-build 的通用调度内核、生命周期状态、取消归属和安全能力上限。
3. 不采用 grok-build 的父对话 fork、worktree、CAD 并行和 child resume；采用其 `task_id + watcher + wait/query` 后台完成协议，但 CAD 仍保持全局 FIFO 与 COM 串行。
4. 不延续晓量当前依赖人工点击的预处理前提；索引和视觉概览由 cadsubagent 根据任务与缓存状态自动触发。

## 4. 规划文档

- [01-target-architecture.md](./01-target-architecture.md)：现状对比、架构决策、组件边界、上下文与能力隔离。
- [02-cadsubagent-contracts.md](./02-cadsubagent-contracts.md)：委派协议、CAD 一等工具、MLightCAD、Python COM、精准切图、精读和 evidence pack 契约。
- [03-migration-roadmap.md](./03-migration-roadmap.md)：按迭代拆分的代码迁移、文件落点、兼容和回滚方案。
- [04-evaluation-and-release-gates.md](./04-evaluation-and-release-gates.md)：自动化测试、真机验收、质量/速度指标和发布门禁。

上述文档共同构成实现基线。若实现与文档冲突，应先更新决策记录和契约，再改代码。

### 4.1 当前实现进度

截至 2026-08-09，P1 核心闭环已完成，P2 已形成可由 cadsubagent 独占调用的旁路实现，P3-A 的 MLightCAD 快速实体索引与 P3-B/P4 的确定性视觉索引均已接入该旁路：

| 波次 | 已完成 | 状态 |
| --- | --- | --- |
| 第一波 | 契约、随包 definition、工具 ceiling、FIFO coordinator、父 prompt 取消、host-owned evidence writer、SafeResultProjector、默认关闭的 feature flag | 已通过隔离/生命周期测试并提交 |
| 第二波 | fresh Pi child runner、私有 run store 与 24h retention、同一 `client_run_id` usage 聚合、固定 `delegate({task})`、off/canary/on composition root、fake child 纵向闭环 | 隔离内核完成；生产主会话尚未注入 `delegate` |
| 第三波（P2-A/P2-B） | loopback HTTP、随机 token/descriptor、单实例锁、单 STA queue、deadline/busy retry、TS client/launcher、完整只读 COM extract/frame/plot/detail 与 view lease | 旁路 bridge 完成；AutoCAD 2024 真机验收仍由发布门禁执行 |
| 第四波（P2-C） | project-root bridge lease、child-run 身份绑定、严格 11 工具 registry、安全文件读取、7 个真实 CAD 工具、COM 实体 manifest/hash 缓存、流式 `cad_query`、一分四再分 capture | 已接入 fresh child 默认 composition；仍未替换现有生产 CAD 链路 |
| 第五波（P3-A） | pin MLightCAD/独立 Three.js 运行时、隐藏 sandbox renderer、一次性 loopback source capability、完整实体 serializer、通用 staging 校验/原子 promotion、MLight 默认/COM fallback、`drawing_path` 自动索引 | renderer/electron 静态构建通过；真图质量与速度测试交由用户侧验收，生产链路仍未切换 |
| 第六波（P3-B/P4） | shared entities/visual manifest、full+q1..q4 精准 plot、Qwen3.8-Max 严格 JSON 宏观识别、`needs_zoom` 自动二级四分、5–21 图门禁、视觉 warm cache、辅助 usage 合并 | electron 静态构建通过；真机与视觉质量测试交由用户侧验收，生产链路仍未切换 |
| 第七波（P5/P6-A） | production `delegate` canary composition、父 prompt 取消、同 run usage、主上下文/工具能力隔离、canonical evidence + 显式图片白名单、构件自动 preflight、subagent UI event | knowledge mode 生产接线完成；该波次当时默认 off，设计模式和旧 UI/IPC 尚未完成 |
| 第八波（P5/P6-B） | `cad_query` 全量流式聚合 + 相关性装箱 + Qwen3.8-Max low 语义查询、辅助 usage 归集、受信 CAD 自动化状态 IPC、启用项目隐藏旧手动预处理 UI/轮询、child phase 自动状态 | knowledge mode 的用户心智已切到“提问即按需取证”；off/未命中 canary 仍保留旧 UI 作回滚 |
| 第九波（P7-A/P7-B/P6-C） | design 隔离接线、evidence 驱动 Design CAD Index、run/artifact SQLite 对账、重启恢复、开发者诊断和 entities/visual 精确失效重建 | knowledge/design 均经 cadsubagent；开发者可安全观察和触发下一任务重建，旧文件不会被静默删除 |
| 第十波（P6-D） | 后端逐模型调用表/迁移、流式与非流式终态结算、用途/child/model/token/cache/reasoning/image 安全统计、用户隔离查询、开发者诊断展示 | 每个 CAD run 可从后端审计主 Agent、child 和辅助模型调用；不持久化 prompt/response/reasoning/本地路径 |
| 第十一波（P6-E） | `/agent/v1/models` 权威目录、Qwen3.8-Max alias 强校验、图像/context/output/purpose limits 下发、桌面缓存验签、所有托管调用动态消费 | 清除托管链路分散窗口/输出常量；目录不可用或配置漂移时 fail closed |
| 第十二波（P7-C） | 默认启用隔离架构、删除主工具 legacy CAD composition、设计直连入口和 renderer 手动预处理代码；旧 IPC/manager 入口 fail closed；安装包资源自动核验 | `off` 只暂停自动化，不再恢复主 Agent CAD 权限；knowledge/design 的唯一 CAD 执行面均为 cadsubagent |

当前默认值为 `XIAOLIANG_CAD_SUBAGENT=on`。knowledge/design mode 在组合阶段不构造任何旧 CAD/RAG/probe/selection/原子工具，只保留 `delegate`、受控 evidence 消费和 evidence 驱动的派生设计工具；renderer 不再轮询 selection/旧 artifact，也不显示“连接 CAD/读取实体/视觉识图”按钮。child 根据问题自动调用 MLightCAD、确定性象限视觉和 Python COM 精读。

`off` 和未命中 `canary` 的项目现在进入安全停用态：没有 CAD 工具，不读取 CAD artifact，也不会回退到主 Agent 直连 AutoCAD 或要求用户手工预处理。旧 session 方法与 IPC 名称暂留一个兼容窗口，但入口均稳定返回 `legacy_cad_manual_disabled`；两个发布版本后再物理删除，并仅在用户确认后清理旧 userData artifact。

开发侧迁移代码已完成。发布前仍需应用后端 `scripts/migrations/2026-08-09-agent-usage-calls.sql`，由用户执行真实 DWG/AutoCAD 2024、业务质量、交互和安装包验收；发布后按两个版本观察窗口完成兼容代码与旧缓存清理。

## 5. 已确定的默认决策

| 编号 | 决策 | 原因 |
| --- | --- | --- |
| D-01 | 内部实现通用 `SubagentCoordinator`，首个且首期唯一生产角色为 `cad-analyst` | 保留未来扩展性，同时控制本次范围 |
| D-02 | 主 Agent 首期只看到固定目标的 `delegate({task})`，不允许模型任意指定 agent type | 复用 pi 已验证的窄接口，减少错派和权限升级 |
| D-03 | cadsubagent 不继承父 transcript、父系统提示、父工具结果或自动注入层 | 真正实现上下文隔离；追问由主 Agent 先消解指代 |
| D-04 | 同一时刻最多运行一个 CAD child；额外任务 FIFO 排队 | AutoCAD COM 必须串行，视觉产物也需要确定性发布 |
| D-05 | CAD 产物迁至项目内 `.xiaoliang/cad/`，manifest 是事实源，SQLite 只存引用 | 符合晓量现有 `.xiaoliang/` 项目约定并支持审计、迁移和缓存校验 |
| D-06 | MLightCAD 默认抽取，失败时自动降级 COM；指定 handle 的最终字段始终回 COM | 快速建索引与权威证据职责分离 |
| D-07 | 视觉索引只作导航，精确尺寸/数量/标高只来自实体、measurement 或明确计算 | 防止视觉猜测变成工程结论 |
| D-08 | `delegate_cad` / `delegate_blender` 默认后台执行并立即返回 `task_id`；父 Agent 通过 `subagent_task_status` 查询或阻塞等待，未被等待消费的终态由 watcher 注入父会话；`XIAOLIANG_SUBAGENT_BACKGROUND=off` 可回退到前台等待 | 允许父会话与独立任务并行，同时保留窄接口、安全投影、可观测终态和逐步回滚能力 |
| D-09 | 旧 userData CAD 产物不直接升级为 valid；仅用于 shadow 对比，首次使用生成新 manifest | 旧缓存缺少源哈希和生成器指纹，不能冒充可信证据 |
| D-10 | 所有模型调用统一通过 gateway 解析为 Qwen3.8 Max，并归集到同一用户 run/child run | 满足统一底座、配额和可观测性要求 |
| D-11 | 桌面端最多并发运行 3 个父会话；同一会话仍只允许一个 prompt，超过上限时就地提示等待 | 在保留会话隔离的同时为模型与本地资源设置清晰上限 |
| D-12 | CAD child 在所有项目之间共享一个全局 FIFO；每个 child 结束后释放项目 CAD lease，下一个 child 再获取其项目 lease | AutoCAD COM 必须串行，并保证连续跨项目任务不会沿用错误项目上下文 |
| D-13 | 委派后父 Agent 默认收束当前回合，不再默认阻塞等待；`subagent_task_status` 的阻塞等待可被用户新消息（steer）和 run 中止提前让出；停止只停主会话，后台 child 继续运行，另有显式「全部停止」；空闲叫醒前留宽限期，用户抢先发送则降级为 followUp 注入。`XIAOLIANG_SUBAGENT_INTERACTIVE=off` 可回退 | 后台委派的价值只有在主会话不被占用时才能被用户感知；等待让出与停止拆分让「派出去之后还能接着聊」成为默认体验 |

### 5.1 后台完成注入协议

- `delegate_cad` / `delegate_blender` 在后台开关开启时只返回安全校验后的 `taskId`、当前状态与 `queuePosition`，不把 child transcript 暴露给父 Agent。
- 委派后父 Agent 默认简要告知用户已登记的任务并结束当前回合，把主会话交还给用户；只有用户明确要求同步等待、或任务预计极短时才阻塞等待。CAD → Blender 链路因此跨回合执行：取证终态经完成注入回到父会话后，再委派建模。
- `subagent_task_status({ taskIds?, timeoutMs? })` 的 `timeoutMs=0` 是非阻塞快照；`timeoutMs>0` 最长等待 10 分钟，并在任一目标任务到达终态或超时时返回。显式 `taskIds` 最多 32 个；省略时返回全部活动任务和有界的最近完成尾巴。waiter 必须先注册再检查终态，避免任务早于监听挂载完成的竞态。
- 阻塞等待还可被两种事件提前让出：父会话收到用户 steer 消息，或当前 run 被中止。让出不消费终态、不标记已投递，任务继续在后台运行，完成注入照常发生。followUp（下一轮）不触发让出。
- 父 Agent 通过阻塞等待取得终态后，该终态标记为已投递，watcher 不再重复通知。未被等待消费时：父 Pi agent loop 仍在运行（包括其 retry/自动压缩）则通过 host-owned custom follow-up 注入安全摘要；空闲时创建 `subagent_completion` wake run，并以 custom message 启动，经标准 `sendPrompt`、配额与用量结算路径继续处理。两条路径都不进入用户可编辑的 steer/followUp composer 队列。
- 空闲叫醒前留一段宽限期，发射前复查父会话状态：用户在此期间抢先发送则降级为 `followUp` 注入到用户那一轮，不再另开 wake run。
- child usage 始终记入启动 child 的原 `client_run_id`；空闲 wake 的主模型调用使用新的 `client_run_id` 独立结算。委派后默认收束回合使这条晚结算路径从边缘情况变为主路径。
- 应用重启时，run store 将遗留的 running child 记为 `HOST_RESTARTED`；父会话下次打开时只提示一次，不尝试恢复 child。
- 停止父会话默认只中止主会话回合，已派出的 child 继续运行并在完成后正常注入；用户可通过显式「全部停止」连同 child 一起取消。重置、删除父会话与退出应用仍无条件 `cancelByParent`。后台 watcher 不得在父会话被删除后创建 wake。
- 「委派后收束回合」目前只靠提示词约束，不改 pi 行为。若实测发现模型仍倾向于自行阻塞等待，备选是让 delegate 工具返回 `AgentToolResult.terminate: true` 硬收束当前工具批次。

## 6. 推荐实施顺序

1. 建立 golden CAD 任务集、功能开关和现状基线。
2. 建立通用 Subagent 内核、固定 `delegate` 和 fake cadsubagent，先证明上下文隔离。
3. 端口化 pi-engineering 的 Python COM bridge，并在当前 CAD runtime 旁路运行。
4. 接入 MLightCAD、项目内 manifest 和自动实体索引。
5. 接入全图/四象限/二级象限视觉概览。
6. 接入 `cad_query`、COM 权威 handle 读取、`cad_detail` 和 evidence pack 精读闭环。
7. 先在知识问答模式 shadow/canary，再迁设计模式的 CAD 读取依赖。
8. 移除主 Agent 的直接 CAD 工具、手动前置按钮和巨型会话管理器内的 CAD 实现。

每一步都必须有独立 feature flag、测试门禁和回退到旧链路的能力；详细拆分见迁移路线图。

## 7. 已确认的产品决策

### Q-01：本轮 CAD 范围严格只读

已确认：本轮 `cad-analyst` 严格只读，覆盖全部“识图/抽取/查询/切图/精读”能力；AutoCAD 编辑、发送命令、保存和关闭不开放。以后需要自动改图时新增独立 `cad-editor`，使用更强审批和事务策略。

### Q-02：自动索引采用按需触发

已确认：cadsubagent 第一次需要实体或视觉证据时检查 manifest，缺失/过期才自动生成；项目打开阶段只做轻量文件和状态发现。后续可另行评估空闲预热常用 DWG。

### Q-03：宏观视觉索引关闭 thinking

已确认：主 Agent/cadsubagent 使用 `low` 或用户选择的 `xhigh`，`cad_query` 使用 `low`；固定 schema 的宏观视觉索引使用 `enable_thinking=false + vl_high_resolution_images=true`。所有链路仍然使用 Qwen3.8 Max。

## 8. 完成定义

只有同时满足以下条件，才算完成本轮架构迁移：

- 用户无需点击“读取实体”“视觉识图”，Agent 能按任务自动完成缺失产物生成。
- 主 Agent 的工具表中不存在任何直连 AutoCAD、DWG 解析或 CAD 截图工具。
- 父会话持久化中不出现 child transcript、全量实体 JSONL、base64 图片或 bridge token。
- 同一未修改 DWG 的实体和视觉产物可命中缓存；源文件、生成参数或产物改变时能准确标记 stale/corrupt。
- 图纸概览最多 21 张图；目标精读由 `cad_detail` 基于 handle/bbox 自动定界。
- 关键工程结论有可追溯的实体或局部图像证据，读不到时明确报告限制。
- Qwen3.8 Max 模型调用、child 用量、辅助视觉调用和错误均可按一次用户 run 归集。
- 知识问答和设计模式均不再绕过 cadsubagent 访问 CAD runtime。

## 9. 关键参考代码定位

| 主题 | 参考位置 |
| --- | --- |
| pi CAD 子代理定义 | `my-projects/pi-engineering/engineering/agents/cad-analyst.md` |
| pi 委派、隔离和 SafeDetails | `my-projects/pi-engineering/engineering/pi-cad/src/delegate.ts`、`src/subagent/*` |
| pi CAD 一等工具 | `my-projects/pi-engineering/engineering/pi-cad/src/tools/cad-first-class.ts`、`cad-query.ts`、`visual-index.ts` |
| pi MLightCAD | `my-projects/pi-engineering/engineering/desktop/src/main/cad/mlight-extraction-service.ts`、`src/renderer/previews/mlight-cad-extraction.ts` |
| pi Python COM API | `my-projects/pi-engineering/engineering/cad-bridge/src/cad_bridge/api/app.py`、`application/worker.py`、`infrastructure/autocad/*` |
| pi 象限/detail 数学 | `my-projects/pi-engineering/engineering/cad-bridge/src/cad_bridge/domain/geometry.py` |
| grok 通用 coordinator | `my-projects/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/` |
| grok child composition | `my-projects/grok-build/crates/codegen/xai-grok-shell/src/agent/mvp_agent/subagent_coordinator.rs` |
| grok agent 解析 | `my-projects/grok-build/crates/codegen/xai-grok-subagent-resolution/src/` |
| 晓量主会话/CAD 混合点 | `dev/frontend/electron/runtime/agent/sessions/agent-session-manager.ts` |
| 晓量当前 CAD 工具面 | `dev/frontend/electron/runtime/agent/tools/index.ts`、`agent/tools/domain/cad/` |
| 晓量当前 worker/store/UI | `dev/frontend/electron/runtime/cad/`、`dev/frontend/src/components/chat/cad-connection-indicator.tsx` |
