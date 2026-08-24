# 迁移路线图

状态：Accepted（2026-08-09 已完成统一入口与 Blender 平级子代理收口）

原则：每个阶段都能独立验收和回滚；新链路达到门禁前不删除旧链路

## 1. 迁移策略

采用 strangler 方式逐步替换：

1. 先在现有主 Agent 外建立通用 Subagent 内核。
2. 在旧 stdio CAD worker 旁边建立新的 Python HTTP/STA bridge。
3. 先让 cadsubagent 使用新的一等工具和项目内产物，但不改变默认用户路径。
4. 用真实任务完成实体、视觉、精读、证据包闭环。
5. 主入口切换到 `delegate_cad`，并把 Blender 作为 `delegate_blender` 平级 child 接入。
6. 最后删除主 Agent 的 CAD/Blender 直连工具、手动前置流程、旧模式切换与设计工作台代码。

不能在第一步就重写 `agent-session-manager.ts`。先建立可运行边界和契约测试，再把旧逻辑一块一块迁出，能显著降低一次性回归风险。

## 2. 建议目标目录

```text
dev/frontend/electron/runtime/
├── agent/
│   ├── sessions/
│   │   └── agent-session-manager.ts       # 迁移后只负责主会话
│   ├── subagents/
│   │   ├── contracts.ts
│   │   ├── agent-definition-registry.ts
│   │   ├── subagent-coordinator.ts
│   │   ├── subagent-runner.ts
│   │   ├── subagent-run-store.ts
│   │   ├── usage-aggregator.ts
│   │   ├── safe-result-projector.ts
│   │   ├── evidence-pack-writer.ts
│   │   ├── subagent-runtime.ts
│   │   └── definitions/
│   │       ├── cad-analyst.md
│   │       └── blender-modeler.md
│   └── tools/domain/delegate/index.ts
├── cad/
│   ├── application/
│   │   ├── cad-application-facade.ts
│   │   └── tools/
│   │       ├── cad-app.ts
│   │       ├── cad-artifacts.ts
│   │       ├── cad-extract.ts
│   │       ├── cad-query.ts
│   │       ├── cad-capture.ts
│   │       ├── cad-detail.ts
│   │       └── cad-doctor.ts
│   ├── artifacts/
│   │   ├── cad-artifact-repository.ts
│   │   ├── manifest.ts
│   │   ├── validator.ts
│   │   └── staging-publisher.ts
│   ├── extraction/mlight/
│   │   ├── mlight-extraction-service.ts
│   │   ├── mlight-extraction-client.ts
│   │   └── mlight-extraction-types.ts
│   ├── visual/
│   │   ├── quadrant.ts
│   │   ├── visual-index-service.ts
│   │   └── visual-schema.ts
│   └── bridge/
│       ├── client.ts
│       ├── launcher.ts
│       ├── descriptor.ts
│       └── python/cad_bridge/...
└── project-files/
    └── cad-evidence-reader.ts              # 只读白名单 evidence/图片

dev/frontend/src/
├── shared/subagent.ts
└── components/chat/
    ├── subagent-run-indicator.tsx
    └── cad-connection-indicator.tsx
```

MLight extraction renderer 建议独立于主 UI：

```text
dev/frontend/src/mlight-extraction/
├── index.html
├── main.ts
└── serialize-entity.ts
```

`vite.config.ts` 增加 multi-page entry 和 MLight worker asset 复制；`build-electron.mjs` 保持 Electron main/preload 构建职责。

## 3. 现有文件迁移映射

| 现有位置 | 当前职责 | 迁移目标 | 删除时机 |
| --- | --- | --- | --- |
| `agent/sessions/agent-session-manager.ts` | 主会话 + CAD 抽取/视觉/RAG/精读/手动 API | 调用 `SubagentCoordinator`；CAD 私有方法迁到 CAD application/tools | P7 完成后清理 |
| `agent/tools/index.ts` | 主 Agent 暴露多种 CAD/Blender 工具 | 统一入口只注入 `delegate_cad` / `delegate_blender` | P7 完成 |
| `agent/policy/tool-visibility.ts` | 用名称隐藏部分 CAD 工具 | 改为 composition-time capability；主 registry 根本不构造 CAD tools | P6 后简化 |
| `agent/prompts/system/sections/core-role.ts` | 主 Agent 包含具体精读工具纪律 | 保留证据分级，改为委派/evidence 消费 | P6 |
| `agent/prompts/system/sections/tooling.ts` | 枚举大量 CAD 工具和驾驶策略 | 主 Agent 只描述 `delegate`；详细规则移入 child definition | P6 |
| `agent/context/providers/cad-drawing-knowledge-provider.ts` | 将实体/视觉/RAG 摘要注入父上下文 | 最多注入轻量 drawing/artifact 状态；正文按需读 evidence | P6 |
| `cad/storage/cad-drawing-store.ts` | userData 文件 + SQLite 状态 | 项目内 artifact repository/manifest；旧 store 只读兼容 | P7+两个版本后删除 |
| `cad/drivers/autocad-com/worker-host.ts` | stdio JSON worker | HTTP bridge launcher/client；旧 host 为 rollback adapter | P2–P7 |
| `cad/service/cad-runtime-service-impl.ts` | 大型 TypeScript CAD facade | 拆成 bridge facade、artifact、capture 和 legacy adapter | P2–P7 |
| `agent/tools/domain/cad/**` | 主 Agent 可调用原子/复合 CAD 工具 | 重写为 child-only 一等工具；复用纯函数和 DTO | P3–P6 |
| `design/**`、`agent/tools/domain/design/**` | 旧画布、索引、场景、3D、快照与导出 | 整套删除；三维执行只保留隔离 Blender child | P7 |
| `cad-connection-indicator.tsx` | 连接、读取实体、视觉识图手动按钮 | 状态、队列、自动运行、诊断/开发者重建 | P6 |
| `agent-chat-panel.tsx` | 直接触发 read/index IPC | 监听 subagent/artifact event | P6 |
| `src/shared/local-agent.ts` | 混合大量本地 Agent/CAD IPC 类型 | 抽出 `shared/subagent.ts` 和新的 artifact status 类型 | P1/P3 |
| `ipc/ipc-handlers.ts` | 手动 CAD IPC | 增加 run/status/cancel/event；旧 handler 延迟废弃 | P1/P6 |
| `frontend/package.json` | 当前无 MLight 依赖，打包旧 Python worker | pin MLight 包，打包新 bridge/renderer/worker assets | P2/P3 |
| backend gateway/usage | 主 run 计费与 Qwen alias | child/aux usage 归集、call purpose、模型目录统一 | P1/P4 |

## 4. P0：冻结契约与建立基线

### 目标

在改运行时之前，记录现状质量、速度和真实 Qwen3.8 Max 能力，避免迁移后只凭主观感觉判断。

### 工作

- 读取 [README.md](./README.md) 中已确认的 Q-01/Q-02/Q-03，并将其作为实现约束。
- 记录当前未提交改动，尤其是 Qwen3.8 Max gateway、模型 alias、smoke 和 usage 相关文件；实现时不覆盖这些并行修改。
- 从 pi-engineering 已验证样例和晓量真实项目中整理匿名 golden DWG 集，覆盖平面、立面、剖面、节点、表格、密集标注、多个图框和同名图纸。
- 为每张图记录源 SHA、AutoCAD 版本、当前 COM 抽取耗时、当前视觉耗时/图片数、代表问题和人工核验答案。
- 调用 `/v1/models` 和现有 smoke，确认 Qwen3.8 Max 的 image input、context window、max output、thinking 参数、高分辨率图片和工具调用。
- 定义 feature flags 和默认关闭策略。

### 交付物

- golden manifest、测试问题和人工证据标注。
- 现状 p50/p95、图片数、模型调用次数、定位/精确值基线。
- Qwen capability contract 测试。
- 三项产品决策落入 README。

### 退出条件

- 不依赖开发者记忆即可重复跑出现状结果。
- 模型目录与前端硬编码差异已列清并有修正方案。
- 后续阶段的质量门禁可自动计算。

## 5. P1：通用 Subagent 内核与隔离证明

### 目标

不接真实 CAD，先证明主/子会话、生命周期、取消、用量和安全投影正确。

### 工作

- 新增 `SubagentRequest/RunState/SafeDetails` 类型。
- 实现单一 coordinator actor/mailbox，所有 spawn/query/cancel/state transition 只能经它发生。
- admission 支持按 agent type 限制；`cad-analyst.maxConcurrent=1`、FIFO queue、depth=0。
- parent session + parent prompt 归属；取消当前 prompt 时只取消本 turn 产生的 child，不误伤更早任务。
- 新建 fresh Pi Agent runner；禁止加载父 snapshot/transformContext/providers。
- 加载随包发布的 `cad-analyst.md`，能力使用 allowlist 与 runtime ceiling 交集。
- 实现 fake CAD tools 和 host-owned evidence writer。
- 实现 SafeResultProjector、secret/base64/绝对路径检测和内部 trace retention。
- 让 child/aux 模型调用继承当前 `client_run_id`，backend 记录 `child_run_id/call_purpose` 并汇总 usage。
- UI 先增加通用 run 状态事件，不改变当前 CAD 按钮。

### 测试

- child 初始 messages 为空，不含父 transcript 中的 canary secret。
- 父 session JSONL 不含 child transcript、tool output、base64 或内部 trace path。
- task 指代未消解时 fake child 明确失败；主 prompt 测试能形成自包含 task。
- queued/running/completed/failed/cancelled 状态转换唯一且可重放。
- 同时两个 CAD delegate 时一个 running、一个 queued；取消 queued 不影响 running。
- child 无 delegate/write/shell；配置不能向上扩权。
- usage 等于 main + child + aux，且仍属于同一 client run。

### 退出条件

- fake child 纵向跑通：主 Agent → delegate → fresh child → evidence → 安全结果 → 主 Agent 读取。
- 通过隔离和取消测试后才允许接入真实 CAD。

### 当前进度（2026-08-09）

- 已完成通用 request/lifecycle/SafeDetails、`cad-analyst.maxConcurrent=1` FIFO、depth=0、parent session + prompt 取消归属。
- 已完成随包 definition 与 runtime ceiling 精确匹配，child 固定空 messages、无 `transformContext`、顺序工具执行。
- 已完成 host-owned evidence writer、canonical evidence 完成门禁、私有摘要 trace、24h retention 和安全结果投影。
- 已完成同一 `client_run_id` 的 main/child/aux usage 聚合域模型，以及 off/canary/on 的 `delegate` composition root。
- fake Pi child 已纵向跑通并验证 parent canary、工具正文、base64、绝对路径不回流。
- 未完成：现有主 Agent 的实际 composition、通用 UI run event、backend per-call usage 明细，以及真实 child CAD 工具。因此 P1 仍标记为“核心闭环通过、生产退出条件未满足”。

## 6. P2：新 Python COM bridge 旁路上线

### 目标

端口化 pi-engineering 的 loopback HTTP + 单 STA bridge，保持旧 stdio worker 可回退。

### 工作

- 将 `engineering/cad-bridge` 的 domain/application/infrastructure 分层实现移植到晓量命名空间，保留测试和 attribution。
- 实现 descriptor、随机 token、loopback 端口、全局单实例锁、project-root 绑定和协议握手。
- 实现 `/healthz`、`/v1/status`、`/v1/execute` 与稳定错误 envelope。
- 实现 `StaWorker(queue=32)`、queue/response deadline、busy 3×500ms retry。
- 端口 `app/doc/extract/capture` operation，优先复用 pi 的 geometry、frame、plot、serializer 纯逻辑。
- 新增 TypeScript bridge launcher/client 和 `CadApplicationFacade`。
- 当前 `CadRuntimeService` 先通过 adapter 可选择 http 或 stdio，避免上层一次性改完。
- 更新 Python requirements、打包脚本和 electron-builder `extraResources`；使用现有 packaged uv/Python 策略验证开发态和安装包。

### 当前进度（2026-08-09）

- P2-A 已移植到晓量命名空间：loopback HTTP、随机 bearer token、原子 descriptor、全局单实例锁、project-root 绑定和 protocol v1 握手。
- 已实现单一 STA worker（queue=32）、queue/response deadline、排队过期跳过 COM、response timeout 不跨线程杀 COM，以及 busy 3×500ms retry。
- 已实现 `/healthz`、`/v1/status`、`/v1/capabilities`、`/v1/execute`、稳定错误清洗、1 MiB 请求门禁与严格 operation allowlist。
- 已实现 TypeScript client、健康 descriptor 复用、失效 descriptor 替换、受管 launcher、`CadApplicationFacade` 与 `XIAOLIANG_CAD_BRIDGE=stdio|http`（默认 stdio）。
- 第一批真实端口为 `app.status/app.start/doc.list/doc.open/doc.switch/extract.read`；路径只接受项目内 DWG，handle read 只返回 JSON DTO，不返回 COM proxy。
- 已加入 Python/TS 无 AutoCAD和 fake COM 测试、PyInstaller 构建脚本及 electron-builder 资源规则。
- P2-B 已端口 `extract.run`、完整 entity serializer、frame detection、full/两层 quadrant plot 与 handle/window detail；图片执行 4096²、ink-ratio、PDF→PNG fallback 门禁。
- P2-B 已实现 plot view lease：操作结束恢复活动文档、layout、`TILEMODE`、`BACKGROUNDPLOT`、view 与 `DBMOD`；固定 facade 可顺序生成 full + q1..q4 + 指定一级象限的第二层四图，严格限制 5–21 张。
- P2-C 已实现 `ProjectScopedCadHttpRuntime`：bridge 复用/切项目受串行状态机约束，每个 child 获取绑定 `projectRoot + childRunId + cad-analyst` 的 lease，child 结束后统一释放；调用方不能覆盖 bridge identity。
- P2-C 已实现 child-only 的严格 11 工具 registry：`read/grep/find/ls` 只读受控项目文件，`cad_app/cad_artifacts/cad_extract/cad_query/cad_capture/cad_detail/cad_doctor` 只经受限 facade/项目 artifact 层访问 CAD。
- P2-C 已实现 full + q1..q4 的视觉概览以及按所选一级象限生成第二层四图；图片只落项目内相对路径，由多模态 child 经受控 `read` 查看，不向父上下文回流 base64。
- P2-C 同时落下 P3 的一部分基础：COM 完整实体索引写入 source/producer/file SHA-256 manifest，`cad_query` 先以流式确定性聚合和有界相关样本工作。它还不是 MLight 默认抽取和最终通用 artifact transaction。
- P2 尚未完成：现有生产 `CadRuntimeService`/主 Agent 的 canary adapter、冻结 exe/安装包 smoke 和 AutoCAD 2024 真机纵向验收仍是退出门禁。

### 测试

- 无 AutoCAD：鉴权、协议、descriptor 复用/失效、队列、deadline、路径逃逸、错误清洗。
- fake COM：所有引用只在 STA thread、busy retry、queue full、取消不跨线程杀 COM。
- geometry：象限最多两层、detail 4:1、非法 bbox/handle。
- 真机 AutoCAD 2024：status/start/list/open/switch/extract/read/detect/plot/detail。
- 操作前后活动文档、视图、layout、BACKGROUNDPLOT 和 DBMOD 保持不变量。
- 关闭晓量后 AutoCAD 保持打开；bridge 异常退出不关闭 AutoCAD。

### 退出条件

- 新 bridge 在真实 AutoCAD 完成纵向冒烟。
- 在 feature flag 下可切回旧 stdio worker，且不丢当前用户文档。

## 7. P3：项目内 Artifact 与 MLightCAD 自动实体抽取

### 目标

把“手动读取实体”替换为 cadsubagent 的自动、可缓存、项目内快索引。

### 工作

- 新增 `.xiaoliang/cad` artifact repository、drawing-key、manifest validator 和 staging publisher。
- 新增 SQLite artifact set 引用；manifest 为事实源，可重建 DB 行。
- pin MLightCAD 包；配置 Vite multi-page extraction renderer 和 worker assets。
- 实现隐藏 sandboxed BrowserWindow、随机 capability token、本地源文件服务和串行 extraction queue。
- 端口 pi 的 MLight entity serializer、Markdown 摘要和原子写入规则。
- 实现 `cad_artifacts` 与 `cad_extract run/read`；默认 MLight，失败一次降级 COM。
- 实现完整索引 superset 复用、source SHA/producer fingerprint/status 检查。
- 旧 userData `cad-drawings` 只登记为 `untracked_legacy`；不删除、不静默升级为 valid。
- cadsubagent prompt 自动检查并生成实体 artifact；不再要求 selection 或 UI 按钮。

### 当前进度（2026-08-09，P3-A）

- 已按 pi-engineering 的已验证版本锁定 `@mlightcad/cad-simple-viewer@1.5.9`、`@mlightcad/data-model@1.12.3`、`lodash-es@4.17.21` 和 Three.js 0.172；旧设计画布删除后，额外 Three.js alias 与双版本 Vite 隔离也已移除。
- 已增加独立 `mlight-runtime.html`、LibreDWG/MText worker 资产和沙箱 preload。每次抽取创建隐藏 BrowserWindow，使用 `contextIsolation + sandbox + nodeIntegration=false`，完成后销毁窗口，不跨图纸保留 renderer 上下文。
- 已实现仅绑定 `127.0.0.1` 的随机一次性 source capability、DWG/DXF 签名与 256 MiB 门禁、串行 extraction queue、超时/取消，以及 pi 风格的实体 JSONL/可读 Markdown serializer。
- 已实现双 producer manifest 与通用 staging promotion：校验源图 SHA-256、producer fingerprint、JSONL 对象/行数/单行与总大小、Markdown 头和文件 hash；发布失败回滚上一份 valid entities。
- `cad_extract action=run` 新增 `drawing_path`，cadsubagent 可直接索引项目 DWG/DXF，无需用户打开 AutoCAD 或选择实体；默认 MLightCAD，失败一次后自动启动/定位 AutoCAD 并以同一 staging 契约走完整 COM fallback。`action=read` 继续由 COM 提供 handle 权威字段。
- cad-analyst definition 已明确自动实体索引和自动视觉概览纪律。renderer/electron 静态构建已通过；按用户决定，本波不执行测试用例，fixture、AutoCAD 2024 与真实 DWG 质量/速度验收仍保留在门禁中。
- P3-A 仍未完成 SQLite artifact 引用、旧 userData `untracked_legacy` 登记和真实图门禁；visual manifest/Qwen 宏观识别已在紧随其后的 P3-B/P4 波次完成开发。

### 测试

- MLight 对 fixture DWG/DXF 的类型、文本、dimension measurement、block attributes、bbox、handle 与 COM 抽样对比。
- 同一 DWG 第二次命中缓存，不启动 renderer/COM。
- 改 DWG → `stale_source`；改 serializer 参数 → `stale_pipeline`；改产物 → `corrupt`。
- MLight 崩溃/超时/不支持 → 一次 COM fallback；旧 valid set 保留。
- 项目外路径、符号链接逃逸、伪扩展、超大文件拒绝。
- 项目内同名 DWG 通过 relative path hash 得到不同 drawing-key。

### 退出条件

- 用户只提问，不点击按钮，也能自动获得实体索引并回答纯实体查询。
- warm cache 不调用 AutoCAD 或模型。
- MLight 快速路径达到 P0 定义的速度/一致性门禁。

## 8. P4：确定性视觉概览

### 目标

用 Python COM API 实现全图一分四、按需再分四的自动视觉索引，替换当前大规模窗口规划。

### 工作

- 实现/端口 `capture.detect_frames`、`capture.plot` 和纯函数 quadrant。
- `cad_capture visual_index=true` 自动检查 visual artifact cache。
- 生成 full + q1..q4，调用 Qwen3.8 Max 严格 JSON 宏观识别。
- 只对 `needs_zoom` 一级象限生成 qx/q1..q4；最多 21 图、最多两次模型调用。
- 实现高分辨率、20MB/4096² 门禁、OSS 归档和 usage 归集。
- 写入 `visual-index.json`、`visual-knowledge.md`、captures 与 producer fingerprint。
- 在 child 工具结果中只返回摘要/路径；图片由 artifact reader 按需读取。
- 当前 8–80 window 视觉 pipeline 保留在 `legacy` flag，不再发展新逻辑。

### 当前进度（2026-08-09，P3-B/P4）

- 已将 drawing manifest 扩展为可选 `entities` + `visual` artifact sets；任一 set 重建时仅在 drawing identity 与 source SHA-256 完全一致的前提下保留另一 set，避免实体/视觉发布互相覆盖。
- `cad_capture action=visual_overview` 已内建 visual cache：valid 时直接返回；missing/stale/corrupt 时以 run staging 生成 full + q1..q4，并只为 Qwen 返回 `needs_zoom=true` 的一级象限生成四张二级图。
- 宏观识别固定经托管 vision alias 路由到 Qwen3.8-Max，使用 `enable_thinking=false`、`vl_high_resolution_images=true`、`response_format=json_object`；最多两次模型调用，不进行第三层递归。
- 已发布 `visual-index.json`、`visual-knowledge.md` 与 5–21 张 captures；producer fingerprint 纳入模型、prompt、frame、像素上限、高分辨率和最大深度。
- staging/promotion 会校验目录无链接、文件清单、PNG 签名/IHDR/20MB/4096²、区域树与 `needs_zoom` 一致性、canonical image path、Markdown 头、source/file hash；失败回滚旧 visual set。
- visual gateway usage 会并入 child terminal usage，并在 active parent usage run 存在时以 `call_purpose=visual_index` 独立归集。cad-analyst 已改为自动读取 visual knowledge，不再手工决定 `visual_zoom`。
- Electron 静态构建已通过；按用户决定不执行测试用例，AutoCAD 2024、真实 DWG、视觉质量与 warm-cache 验收由用户侧执行。

### 测试

- quadrant bbox 与图片路径一一对应；q1 左上、q2 右上、q3 左下、q4 右下。
- 0/1/4 个 needs_zoom 时图片数分别为 5/9/21，永不超过 21。
- 二级结果不再递归；边界截断不会单独触发放大。
- 模型 schema 无效时最多一次修复；错误不发布 artifact。
- warm cache 不 plot、不调用视觉模型。
- 图像尺寸/内容/hash/ink ratio、DBMOD 与视图恢复真机门禁。

### 退出条件

- 用户问全图概览时自动建立视觉索引。
- 与当前视觉 pipeline 的 golden 定位对比达到门禁，同时显著减少图片和模型调用。

## 9. P5：`cad_query`、精准精读与 Evidence Pack

### 目标

完成 pi-engineering 的“快索引定位 → COM 权威读取 → 自动定界高清图 → 证据包 → 主 Agent 回答”闭环。

### 工作

- 实现流式 `cad_query` 聚合、Qwen3.8 Max 低思考语义装箱、覆盖率和注入隔离。
- 实现 `cad_extract action=read` 的批量 handle 权威读取。
- 实现 `cad_detail`、1–8 handles、bbox union、padding 和 4:1 窗口。
- child 原生多模态读取 detail 图片；禁止从图片覆盖精确实体字段。
- 完成 cad-analyst prompt 的图纸定位、证据分级、限制和未采用材料纪律。
- host-owned evidence writer 校验项目相对引用并原子发布。
- 主 Agent 增加 evidence reader：Markdown 和显式引用图片可读，raw JSONL/trace/staging/token 不可读。
- 将当前构件教学/算法 preflight 从“必须有 CAD selection/用户图片”改为可接受 `CadEvidenceRef`；selection 只作可选锚点。

### 当前进度（2026-08-09，P5/P6-A）

- 已把生产 `AgentSessionManager` 接到 `CadSubagentRuntime`：child 使用当前用户 turn 的同一 `client_run_id`，父 prompt 停止/会话释放会按归属取消 child，运行结束汇总 main/subagent/visual usage。
- knowledge mode 在 `off|canary|on` composition root 下切换；启用时旧 CAD/RAG/probe/selection/原子工具根本不进入主工具表，只构造 `delegate`、canonical evidence reader、显式引用图片 reader 与非 CAD 算法工具。
- 主上下文在隔离模式下不再注入 CAD session/drawing 正文，构件 preflight 不再读取 selection 或要求用户图片；改为自动委派、读取 evidence、检查图片后再提取算法参数。
- 主 Agent 只能读取本会话已完成 child 发布的 `.xiaoliang/cad/evidence/<child>/evidence.md`；raw JSONL、manifest、trace、staging 等 CAD 文本路径被拒绝。图片必须先在已读 evidence.md 中被显式引用，才能由 `cad_evidence_image` 返回多模态内容。
- system prompt 已按实际工具 composition 切换到自包含委派、证据分级和 evidence 消费纪律；隔离模式不再包含旧 CAD 驾驶说明。
- `subagent_run` 已投影 queued/initializing/running/completed/failed/cancelled、phase、last tool、队列位置和稳定错误码，聊天 UI 可观察取证进度且沿用父会话停止入口取消。
- P5/P6-A 当时默认 flag 为 `off`；P7-C 完成设计迁移和生产收口后已切为 `on`。`canary` 仍可通过 `XIAOLIANG_CAD_SUBAGENT_CANARY_PROJECT_IDS` 指定项目。
- `cad_query` 已按 pi-engineering 套路升级：先对通过 source/producer/file hash 验证的 JSONL 做全量流式确定性聚合，再在 100 万上下文预算内全量或相关性装箱，单次调用 Qwen3.8-Max `low` 生成语义答案并显式返回 coverage。
- `cad_query` 请求使用同一 `client_run_id/child_run_id`、`call_purpose=cad_query`，429/5xx 最多重试一次；成功 usage 合并进 child terminal usage 与父 run 聚合。后端 per-call 明细、用户隔离查询和开发者诊断 UI 已在 P6-D 完成。

### 测试

- 大范围统计由一次 `cad_query` 完成，不出现分页 read/grep 手工计数。
- 关键 handle 合并一次 COM read；同 handle 不重复读取。
- 已知 bbox/handle 时跳过 frame detection。
- detail 至少包含目标和同区上下文；空图、错误图、过窄窗口可被门禁识别。
- evidence 固定五段，不含用户结论；所有引用存在且位于白名单。
- delegate ToolResult 不含 transcript/base64/raw JSONL/token。
- 主 Agent 读 evidence + 相关图片后可给出带来源、区分推断的答案。

### 退出条件

- golden 节点/详图/配筋/尺寸任务达到精读质量门禁。
- 用户无需手选实体或提供截图即可完成可自动定位的任务；无法唯一定位时才询问。

## 10. P6：知识问答模式切换与 UI 自动化

### 目标

让生产知识问答默认使用 cadsubagent，并移除人工预处理心智模型。

### 工作

- `knowledge_qa` 主工具 registry 删除所有直接 CAD 原子/复合工具，只保留 `delegate`。
- 主 system prompt 删除工具驾驶细节，保留自包含委派、evidence 读取和证据分级。
- 删除 CAD 正文常驻上下文注入；保留轻量 drawing/artifact 状态，或完全按需查询。
- `CadConnectionIndicator` 改为：AutoCAD 连接、实体索引状态、视觉索引状态、当前 child phase/queue、错误和诊断。
- 默认隐藏“读取实体/视觉识图”按钮；开发者模式可提供显式 rebuild，但必须显示会绕过缓存。
- chat timeline 展示“CAD 子代理：排队/抽取/定位/切图/精读/整理证据”，不展示 reasoning。
- 废弃 `AGENT_READ_CAD_DRAWING` 与 `AGENT_INDEX_CAD_DRAWING_VISUAL` 的用户入口，保留一版兼容 IPC。
- canary 用户按项目/账号开关；出现稳定新链路错误时可回退旧链路，但同一 turn 不并发驾驶 COM。

### 当前进度（2026-08-09，P6-A/P6-B）

- knowledge mode 的生产 canary composition、上下文边界、evidence 消费、取消/usage 生命周期和通用 child 事件已完成开发接线。
- 已新增主进程权威 `CadAutomationStatus` IPC，会从受信 feature flag、conversation mode、project binding 和 coordinator snapshot 判定能力，renderer 不解析环境变量也不为查状态而初始化 child runtime。
- 命中新链路的项目已隐藏“读取实体/视觉识图”与 selection 提示，并停止旧 selection/CAD artifact/connection 轮询；状态面板改为展示 MLightCAD 自动抽取、两级象限识图、COM 精读和当前 child phase。
- P7-C 已删除 renderer 旧连接/读取实体/视觉识图/selection UI 与轮询；`off` 或未命中 canary 时显示安全停用状态，不恢复任何手动入口。
- 开发者专用 artifact 诊断/精确失效重建已完成。旧 IPC 名称与会话管理器方法暂留一个兼容窗口，但 IPC 和 manager 入口均 fail closed，不再承担回滚执行路径。

### 测试

- 主 Agent 工具快照只含一个 CAD 委派入口。
- 全仓 import boundary：非 CAD child/application 不能导入 bridge/MLight/CadRuntimeService。
- UI 无手动前置提示；Agent 自动启动后状态可观察、可取消、失败有明确恢复建议。
- 旧项目/旧对话升级不崩溃，旧 artifact 标为 untracked 而不是伪 valid。

### 退出条件

- knowledge QA canary 达到发布门禁，回滚演练成功。
- 连续观察窗口内无主 Agent 绕过 child 访问 CAD。

## 11. P7：统一入口、旧设计功能删除与 Blender 子代理

### 目标

满足“CAD 与 Blender 执行都在各自隔离 child 中运行”，并让用户只面对一个聊天入口。

### 工作

- 删除问答/设计模式切换及其 renderer、IPC、持久化、prompt 和工具组合分支。
- 删除旧设计画布、CAD index、场景拓扑、3D、review、snapshot、export 和对应共享协议/测试/依赖。
- 保留 Blender MCP 连接层，但只投影到固定 `blender-modeler` 工具 ceiling；主 Agent 不直接获得 Blender MCP/Python。
- 统一 `SubagentCoordinator`、run store、usage 和 safe projector，给 CAD 与 Blender 分配平级角色与独立 FIFO 队列。
- CAD 驱动 Blender 时，由主 Agent 生成两次自包含委派并严格顺序消费 evidence。
- 删除主工具中的 legacy CAD/Blender 直连组合、旧上下文 provider 和手动 UI/IPC。
- 在至少两个发布版本后，提供用户确认的旧 userData artifact 清理；不自动删除。
- 默认 flags 切到新链路，保留紧急 kill switch 一个发布周期。

### 当前进度（2026-08-09，P7 完成）

- renderer 已删除问答/设计切换按钮、快捷键、派生状态与模式选择弹层；会话只有统一聊天入口。
- IPC、preload bridge、共享类型、SQLite 新建 schema、conversation repository 和 prompt context 已删除会话模式读写。后端 archive 仍按其兼容 schema 固定发送 `knowledge_qa`，不再代表本地可切换状态。
- 旧设计画布与其 canvas/index/scene/topology/3D/review/snapshot/export 全套服务、工具、共享协议和测试已删除；`three-app` alias、额外 `@types/three` 与 Vite 双 Three.js 隔离也已删除。
- `blender-modeler` 作为与 `cad-analyst` 平级的随包 child definition 接入统一 `subagent-runtime`；固定工具 ceiling 只包含状态、场景/对象读取、视口截图和 Blender code 执行。
- 主工具表始终提供 `delegate_blender`，项目 CAD 上下文与安全开关可用时再提供 `delegate_cad`；主模型根据意图自动选择，不向用户暴露能力模式。
- CAD 驱动 Blender 的系统契约固定为 `delegate_cad → evidence.md/相关图片核验 → 自包含 Blender task → delegate_blender → 视口截图自检`；两个 child 不共享 transcript、CAD、项目文件或工具。
- coordinator、run store、SQLite run 索引、usage aggregator 与 safe projector 已泛化为两种平级角色；CAD 与 Blender 使用独立 FIFO 队列。CAD 只发布 canonical evidence，Blender 只返回通过宿主门禁的有界执行报告。
- P7-B 已新增 `subagent_runs` 与 `cad_artifact_sets` SQLite 安全索引：run 的 JSON metadata 和项目 manifest 仍是事实源，应用启动时会剪裁过期 run、把中断的 `running` 收敛为 `HOST_RESTARTED`、重建 DB 行，并恢复同一父会话/项目的 canonical evidence allowlist。
- 项目 artifact 会在隔离会话进入和 CAD child 完成时按 manifest/source/producer/file hash 对账到 DB；旧 `cad_drawing_artifacts` 只登记为 `storage_scope=userdata_legacy/status=untracked_legacy`，不复制、不删除，也不升级为可信证据。
- P6-C 已提供受主进程开发者开关控制的诊断/重建入口：按当前项目显示 child run 与 artifact 安全摘要；可将 entities 或 visual manifest 记录精确失效，保留原文件，并让下一次 cadsubagent 任务按标准 preflight 自动重建。该入口不暴露绝对路径、token、trace 或 artifact 正文，也不允许在项目 child 运行期间修改 manifest。
- P6-D 已新增后端 `agent_usage_calls`：gateway 在实际模型调用边界记录 main/subagent/cad_query/visual_index/schema_repair/compaction 的 child 归属、alias/实际模型、状态、duration、input/output/cache/reasoning token 和图片数；流式完成、模型错误、客户端断开都会终态结算。`GET /users/me/agent-runs/{client_run_id}/usage` 提供用户隔离的汇总/分组/限量明细，开发者诊断面板按最近 CAD run 展示该数据。请求/响应正文、reasoning、token、绝对路径均不入库。
- P6-E 已建立 `GET /agent/v1/models` 托管能力目录：后端强制 default/vision/expert 三个 alias 均解析为 `qwen3.8-max`，统一下发图像能力、1M context、64K provider output ceiling 及 main/subagent/cad_query/visual_index/schema_repair/compaction 的任务上限。桌面端登录后先验签并缓存目录，目录缺失、过期刷新失败、alias 不全、非 Qwen3.8-Max 或限制越界时拒绝建模；主 Agent、child、CAD query、视觉索引、压缩和上下文环不再各自维护托管模型窗口/输出常量。思考模型请求统一使用官方推荐的 `max_completion_tokens`，后端只在兼容入口接收旧 `max_tokens` 并规范化。
- `agent/tools/index.ts` 不再导入或构造 legacy CAD/RAG/probe/selection/原子工具、旧设计工具或直接 Blender MCP；项目文件工具只允许读取本会话白名单内的 canonical evidence，CAD session/drawing provider 不进入父上下文。
- feature `off`/canary miss 只暂停 CAD automation，不影响 Blender child，也绝不恢复旧工具、选区、手动按钮或 artifact 正文。
- 安装包构建会复制两份 child definition；`verify:cad-subagent-package` 已同时校验 `cad-analyst.md` 和 `blender-modeler.md`。
- renderer/Electron 完整构建已通过；38 个 Node 测试通过，其中包含双角色 definition ceiling、独立 peer 队列、结果隔离、用量归集和 Blender 纵向运行契约。

迁移后续（不阻塞当前代码完成）：

- 部署后端 migration，并由用户完成真实 DWG/AutoCAD 2024、质量/速度、失败/取消、交互和安装包验收。
- 观察两个发布版本后，物理删除已 fail-closed 的 legacy session 方法、兼容 IPC/bridge 类型和旧 tool implementation；这些代码当前无生产调用。
- 仅在用户明确确认后提供/执行旧 userData artifact 清理，永不把 `untracked_legacy` 静默升级为可信证据。

### 退出条件

- 统一主 Agent 工具表没有直接 CAD 或 Blender 执行能力。
- 仓库架构测试证明只有对应 child composition root 能构造 CAD/Blender 私有工具。
- 旧链路无生产调用、无兼容数据依赖，完成删除前的最后回滚演练。
- 满足 [04-evaluation-and-release-gates.md](./04-evaluation-and-release-gates.md) 全部门禁。

## 12. Feature flags 与回滚

建议 flags：

```text
XIAOLIANG_CAD_SUBAGENT=off|canary|on
XIAOLIANG_CAD_SUBAGENT_CANARY_PROJECT_IDS=<project-id>[,<project-id>...]
XIAOLIANG_CAD_BRIDGE=stdio|http
XIAOLIANG_CAD_EXTRACT_BACKEND=mlight|com
XIAOLIANG_CAD_VISUAL_PIPELINE=legacy|quadrant-v1
XIAOLIANG_CAD_ARTIFACT_STORE=userdata|project
XIAOLIANG_CAD_AUTO_INDEX=lazy|eager
```

规则：

- flags 由受信配置/发布通道决定，不允许模型修改。
- 回滚只切路由，不删除 `.xiaoliang/cad` 新产物。
- `XIAOLIANG_CAD_SUBAGENT=off` 只暂停 CAD 自动化；不向主 Agent 恢复 direct CAD/RAG/probe/selection/visual 工具或旧上下文 provider。
- HTTP bridge 回滚到 stdio 前等待当前 COM operation 完成，不能让两个 worker 同时持有 COM。
- 不在真实用户 turn 同时运行两套视觉 pipeline；shadow 对比使用 fixture/测试项目或离线顺序执行。
- `force`、invalidate 和旧产物删除不是自动回滚动作。
- 任一安全隔离门禁失败时直接关闭新链路，而不是降级为把 child transcript 返回父。

## 13. 数据迁移

### 13.1 旧 CAD artifact

当前文件位于 Electron userData `cad-drawings/{drawingId}`，并由 `cad_drawing_artifacts` 表记录。迁移策略：

1. 升级时不复制、不删除、不把它标记 valid。
2. 根据 drawing/project mapping 在 UI 显示 `untracked_legacy`。
3. 第一次 cadsubagent 需要该图时，在项目 `.xiaoliang/cad` 生成新 entities/visual manifest。
4. 可在内部评估中比较旧摘要和新证据，但旧内容不进入最终证据链。
5. 新链路稳定两个版本后，提供“清理旧 CAD 缓存”用户操作，清楚说明不可恢复。

### 13.2 数据库

建议新增而不是复用过载字段：

```sql
subagent_runs(
  child_run_id PRIMARY KEY,
  parent_session_id,
  parent_prompt_id,
  client_run_id,
  project_id,
  agent_type,
  status,
  model,
  started_at,
  finished_at,
  usage_json,
  safe_artifact_refs_json,
  trace_ref
)

cad_artifact_sets(
  project_id,
  drawing_relpath,
  kind,
  manifest_relpath,
  source_sha256,
  producer_fingerprint,
  status,
  generated_at,
  PRIMARY KEY(project_id, drawing_relpath, kind)
)
```

内部 trace ref 不暴露给 renderer 模型上下文。manifest 丢失时 DB 状态必须降级并可从磁盘重扫，不能继续显示 ready。

## 14. 后端与计费改造

- 每次用户 prompt 仍只创建一个 `client_run_id`。
- 主 Agent、cadsubagent、`cad_query`、视觉索引、schema repair、压缩分别记录 `call_purpose`。
- child 请求使用同一 gateway credential/run authorization；不能新建无配额 run。
- usage finish 汇总 input/output/cache/reasoning/图片调用和 child duration；失败/取消也必须完成 run 结算。
- quota 在 child 启动前和每次辅助模型调用前都能稳定失败，并将 `GATEWAY_QUOTA_EXCEEDED` 投影为用户可理解错误。
- gateway alias 仍可分 `default/vision/expert` 便于统计，但解析后的 provider model 全部断言为 `qwen3.8-max`。
- `/v1/models` 目录驱动 image/context/max output；去掉各链路互相矛盾的常量。

## 15. 每次迭代的交付规范

每个 P 阶段拆成一个或多个小变更，但每个可合并单元必须同时包含：

- 代码与 schema/决策文档同步更新。
- 单元/集成测试和至少一个失败路径。
- feature flag 默认值和回滚说明。
- 日志/telemetry 字段，且经过敏感信息检查。
- 开发态验证；涉及 bridge/MLight/packaging 时再做安装包验证。
- 不修改或删除与本阶段无关的用户未提交改动。

建议我们后续严格按 P0 → P1 → P2 顺序推进。P1 完成隔离证明后，再让任何真实 AutoCAD 能力进入 child；P2 真机通过后，再开始 MLight 和视觉产物迁移。
