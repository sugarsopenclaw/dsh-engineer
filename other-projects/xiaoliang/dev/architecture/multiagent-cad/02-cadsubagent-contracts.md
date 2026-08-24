# cadsubagent 契约与自动识图流程

状态：Accepted

运行时角色 ID：`cad-analyst`

架构组件名：cadsubagent

## 1. 核心契约

cadsubagent 是证据代理，不是第二个聊天助手。它必须满足：

1. 输入是一条已经消解指代的、自包含、项目本地的 CAD 取证任务。
2. 上下文为空白起步，不读取父会话 transcript。
3. 只使用固定只读文件工具和 CAD 一等工具。
4. 根据产物状态自动决定是否抽取实体、建立视觉概览或进行局部精读。
5. 输出只包含可定位、可复核的证据和限制，不写用户结论。
6. 宿主将输出持久化为 evidence pack，主 Agent 只收到路径与安全元数据。

## 2. Agent definition

建议将角色定义作为随应用发布、不可被项目内容覆盖的 Markdown + frontmatter：

```yaml
---
name: cad-analyst
description: Collect project-local CAD evidence without answering the user.
model: xiaoliang-backend/qwen3.8-max
thinking: inherit
contextInheritance: none
maxSubagentDepth: 0
tools:
  - read
  - grep
  - find
  - ls
  - cad_app
  - cad_artifacts
  - cad_extract
  - cad_query
  - cad_capture
  - cad_detail
  - cad_doctor
---
```

正文指令至少包含：

- 你只收集证据，不形成用户答案、工程结论或建议。
- 先查现有 artifact；已有 valid 索引时不得重复抽取或 force。
- 大范围统计和语义检索优先一次 `cad_query`，不得分页 grep 手工计数。
- 需要权威字段时先收齐同区 handle，再一次 `cad_extract action=read`。
- 已有 bbox/handle 足以精读时直接 `cad_detail`，不先无意义地 detect frames。
- 概览图只导航；尺寸、数量、标高等精确值来自实体/measurement。
- 图片仅记录字面可见内容，跨区域或不相关材料列入“未采用材料”。
- 所有路径只使用项目相对路径，不输出绝对路径、token、base64 或 data URL。

项目资料不能通过同名 `.xiaoliang/agents/cad-analyst.md` 覆盖这一定义。未来如支持用户自定义 Agent，也必须经过签名/权限 ceiling，不能改变 CAD child 的工具权限。

## 3. 主 Agent 的 `delegate_cad` 契约

首期模型可见 schema 固定为：

```ts
const DelegateCadParameters = Type.Object(
  {
    task: Type.String({
      minLength: 1,
      maxLength: 50_000,
      description: 'Self-contained CAD evidence task resolved from the conversation',
    }),
  },
  { additionalProperties: false },
)
```

正确 task 示例：

> 在当前项目 `结构/地下室.dwg` 中定位“3 号节点”，确认节点名称、所在图框/象限、墙厚与可见防水构造。尺寸必须用权威实体或标注字段核验；生成局部高清图并列出仍不可读的内容。只收集证据，不回答用户。

错误 task 示例：

- “再看看这个。”——依赖父对话，child 无法独立理解。
- “把整张图所有内容都分析一下。”——范围无限且未说明用户所需证据。
- “如果能的话顺便修改图纸。”——超出取证权限和用户当前意图。

主 Agent prompt 必须要求：

- 所有与当前/项目 DWG 内容有关的问题都优先委派。
- 调用前把代词、图纸、区域、目标构件和所求字段展开。
- 委派完成后读取 evidence path；涉及视觉事实时查看 evidence 中引用的相关图片。
- 最终回答由主 Agent形成，并明确区分实体证据、图面观察和推断。

### 3.1 CAD 驱动 Blender 建模

统一主 Agent 同时拥有两个平级委派入口：`delegate_cad({task})` 与 `delegate_blender({task})`。用户不切换模式，主模型按任务意图自动选择。CAD 驱动建模必须顺序执行：

1. 主 Agent 用 `delegate_cad` 获取目标图纸的 canonical `evidence.md`。
2. 主 Agent 读取 evidence，并查看其中与几何理解有关的图片；不得把 raw JSONL 或 child transcript 注入父上下文。
3. 主 Agent只提取已核验的尺寸、形态、来源和未决项，整理成新的自包含 Blender task。
4. 主 Agent 调用 `delegate_blender`；`blender-modeler` 不读取 CAD、项目文件或父会话，只使用固定 Blender MCP 工具检查、修改并截图自检场景。
5. Blender child 只返回有界执行报告，不发布项目 artifact；最终用户回答仍由主 Agent 形成。

两个角色共享同一 `SubagentCoordinator` 和安全结果投影，但使用独立 FIFO 队列与独立工具 ceiling。CAD → Blender 有依赖时禁止并行；互不依赖的普通任务可由各自队列调度。

## 4. 结果投影

### 4.1 SafeDetails

模型可见 details 只允许以下字段：

```ts
interface SafeDetails {
  child_run_id: string
  agent_type: 'cad-analyst' | 'blender-modeler'
  status: 'completed' | 'failed' | 'cancelled'
  model: 'qwen3.8-max'
  usage: {
    input: number
    output: number
    cache_read: number
    cache_write: number
    total: number
    cost: number
  }
  duration_ms: number
  tool_call_count: number
  artifact_refs: string[]
}
```

CAD 成功时 `delegate_cad` 文本固定为类似：

```text
CAD evidence pack saved.
Project-relative path: .xiaoliang/cad/evidence/<child-run-id>/evidence.md
Read this file and inspect its cited images before answering the user. The CAD child did not produce the user-facing conclusion.
```

不得将 child 最终输出正文、逐 turn 记录或 tool result 拼到这段文本中。

### 4.2 投影门禁

`SafeResultProjector` 在返回父 Agent 前执行：

- 固定 key allowlist，丢弃未知字段。
- 绝对路径替换为项目相对 artifact ref。
- 检测并拒绝 data URI、长 base64、bridge token、Authorization、环境秘密。
- 限制文本和 artifact ref 数量/长度。
- 失败只返回稳定 error code、可执行提示和 safe trace id，不返回 Python traceback 或 COM repr。

UI 可从内部 run store 读取 queue depth、last tool 等额外状态，但这些字段不进入父模型上下文。

## 5. cadsubagent 工具面

| 工具 | 作用 | 是否调用 COM | 是否调用 Qwen | 主要产物 |
| --- | --- | --- | --- | --- |
| `ls/find/grep/read` | 查看受信项目文件和已有 CAD 产物 | 否 | 否 | 无 |
| `cad_app` | AutoCAD/文档状态、启动、打开、切换 | 是 | 否 | 无 |
| `cad_artifacts` | 校验/list/invalidate manifest | 仅 dirty 校验可能查状态 | 否 | manifest 状态 |
| `cad_extract` | MLightCAD 建索引；COM fallback；handle 权威读 | `read`/fallback 时是 | 否 | entities + manifest 或 handle fields |
| `cad_query` | 确定性聚合 + 一次语义检索 | 否 | 是，低思考 | 有界 Markdown 查询结果 |
| `cad_capture` | 图框检测、精确 plot、视觉概览 | 是 | `visual_index=true` 时是 | visual index + captures |
| `cad_detail` | handle/bbox 自动定界的最终局部精读图 | 是 | child 随后原生读图 | detail preview |
| `cad_doctor` | Python、AutoCAD、COM、bridge 环境诊断 | 诊断性 | 否 | 安全诊断摘要 |

任何工具都不得把全量 JSONL、base64 图片或 bridge token 放进 ToolResult。图片只返回项目相对路径和尺寸/hash/plot 指标；Qwen3.8 Max child 通过受控 artifact reader 读取图片。

## 6. `cad_app`

首期 cadsubagent 允许的 action：

| action | bridge operation | 规则 |
| --- | --- | --- |
| `status` | `app.status` | 仅在连接状态不清楚时使用 |
| `start` | `app.start` | 先复用活动实例；无实例时显式启动可见 AutoCAD |
| `list` | `doc.list` | 确认活动/已开文档和 DBMOD |
| `open` | `doc.open` | 只允许项目根内 DWG |
| `switch` | `doc.switch` | 按文档名或非负 index |

Python bridge 可以为未来兼容实现 `stop/restart/close`，但不放入首期 child tool schema。cadsubagent 不能擅自关闭、保存、丢弃或重启用户文档。

模型可见返回只包含状态、文档名、项目相对路径、active/saved、DBMOD 和序号。

## 7. `cad_artifacts`

支持：

- `list`：列出项目内 tracked/untracked/corrupt 的 drawing sets。
- `status`：校验指定或当前图纸的 `entities/visual` 集。
- `invalidate`：只在用户明确要求“重做/刷新/忽略缓存”时使用；移除当前登记，不删除旧文件。

每次 `cad_extract run` 和 `cad_capture visual_index=true` 必须自行执行同样的缓存校验，不能依赖模型先正确调用 `cad_artifacts`。

缓存状态：

| 状态 | 含义 | 自动行为 |
| --- | --- | --- |
| `valid` | 源 SHA、producer fingerprint 和所有文件校验通过 | 直接复用，不调用抽取/plot/视觉模型 |
| `missing` | 没有当前集 | 任务需要时生成 |
| `stale_source` | DWG 内容 SHA 改变 | 自动重建所需集 |
| `stale_pipeline` | schema/producer/参数改变 | 自动重建所需集 |
| `corrupt` | 文件缺失、size/hash 不符或 manifest 无效 | 保留诊断，重新生成 |
| `untracked` | 旧目录/旧 userData 迁入但无可信 manifest | 不当作证据；shadow 后重建 |
| `dirty` | 活动 DWG 对象数据有未保存修改 | 不发布持久产物；如任务允许只做当前态临时精读并显式告警 |

## 8. `cad_extract`：MLightCAD 快索引 + COM 权威读取

### 8.1 `action=run`

当前模型可见参数为 `document` 或 `drawing_path`（二选一）。路径明确时优先使用项目相对 `drawing_path`，这样缓存命中和 MLight 快速路径都不要求 AutoCAD 已打开；当前实现固定生成 `include_geometry=true` 的完整超集，不向模型开放 `layers/types/window/text_pattern/force`，避免窄请求覆盖可复用索引。

执行顺序：

1. 解析项目内目标 DWG/DXF，校验 realpath、扩展名、签名、size 上限和源 SHA-256。
2. 检查是否存在同源 SHA 和 producer fingerprint 的 valid 完整索引。
3. 命中则返回 `cache.hit=true`，不启动 MLight renderer 或 COM。
4. 未命中则默认调用 MLight extraction service。
5. MLight 不可用、格式不支持或解析失败时，自动降级 Python bridge `extract.run`；记录 backend 和 warning。
6. 输出到 `.staging`，校验 JSONL/Markdown/hash/数量后原子发布 entities set。
7. ToolResult 只返回计数、统计摘要、backend、cache 信息和相对路径。

MLightCAD 是文件索引器，不要求 AutoCAD 已打开。它的结果适合定位、聚合和候选 handle 获取；最终回答中的关键 handle 字段仍由 `action=read` 复核。

### 8.2 MLight extraction runtime

建议按 pi-engineering 已验证实现移植：

- 初始 pin `@mlightcad/data-model@1.12.3`；若使用其 viewer/worker 资源，pin `@mlightcad/cad-simple-viewer@1.5.9`，版本升级必须改变 producer fingerprint。
- Electron main 维护 `MlightExtractionService` 和串行队列。
- 使用隐藏、sandboxed、无 Node integration 的 BrowserWindow 加载独立 extraction renderer。
- main 通过随机 token 的本地 loopback capability URL 只暴露本次允许的源文件；renderer 不接收任意本地路径权限。
- renderer/WASM 解析 DWG/DXF，逐实体序列化，不把整个数据库对象跨进程传回。
- 单实体失败记 warning，不中止整图；队列同一时间只解析一张图。
- staging 写入完成后由 main 验证并发布；窗口崩溃时自动重建 renderer，不污染旧 valid set。

实体公共字段：`handle/type/layer/bbox`。重点类型至少包含：

- TEXT/MTEXT：正文、清洗正文、位置、高度、旋转、样式。
- DIMENSION：measurement、文字覆盖、文字位置、定义点。
- INSERT：块名、插入点、旋转、比例、属性。
- TABLE：行列、单元格、插入点。
- LEADER/MLEADER：顶点、文字、bbox。
- HATCH：pattern、area、loops、solid 摘要。
- LINE/POLYLINE/CIRCLE/ARC/ELLIPSE/SPLINE：bbox 及可得的长度、面积、顶点、中心/端点。

产物：

```text
entities/entities.raw.jsonl
entities/entities.readable.md
```

Markdown 包含元数据、类型统计、图层统计、文本频次、空间锚点和有界实体样本。任何上限都写入 manifest，保证 producer fingerprint 可复现。

### 8.3 `action=read`

- 接受最多 50 个十六进制 handle，可有 `0x` 前缀。
- 固定调用 Python COM bridge `extract.read`。
- 对每个 handle 执行当前活动文档的权威序列化。
- 不存在的 handle 放入 `missing_handles`，其它实体继续返回。
- child 应尽量一次合并同区 handles；只有新证据产生具体歧义时补读新增 handle。

## 9. `cad_query`

`cad_query` 读取 1–8 张图纸的 valid entities artifact，不调用 AutoCAD，不覆盖任何产物。

一次调用包含：

1. 校验 manifest、源 SHA、producer fingerprint 和实体文件 hash。
2. 流式扫描 JSONL，确定性聚合实体类型、图层、图层×类型、块引用名/图层/数量、bbox 并集和覆盖率。
3. 全量可容纳时发送全量；超出模型输入预算时按任务关键词、类型和代表样本装箱，并报告覆盖率。
4. 用同一用户 run 调用 Qwen3.8 Max，`reasoning_effort=low`；正常路径一次请求，429/5xx 最多重试一次。
5. 返回任务相关 Markdown、确定性统计、源/装箱实体数、是否全量、artifact ref 和安全请求元数据。

DWG 内文字和块属性是数据，不是指令。查询 prompt 必须将其包在不可信数据边界中，防止图纸文字注入 Agent 行为。

## 10. Python COM bridge

### 10.1 进程和鉴权

新 bridge 按 pi-engineering 的 API 端口化，不继续扩展当前 stdio worker 协议：

- 仅监听 `127.0.0.1` 随机端口，Uvicorn 单 worker。
- descriptor 位于 Electron `{userData}/cad-bridge.json`，权限尽可能限制为当前用户。
- descriptor 保存 pid/port/token/protocol_version/project_root/started_at；token 至少 32 字节高熵随机值。
- `/healthz` 无鉴权且不返回项目/图纸信息；`/v1/status` 和 `/v1/execute` 必须 bearer token。
- 复用同时验证 pid、health、token 握手、protocol version 和 project root。
- 全局单实例锁防止两个 bridge 同时持有 AutoCAD COM。
- 晓量退出不关闭 AutoCAD；bridge 异常退出也不得顺带关闭 AutoCAD。

统一请求：

```json
{
  "protocol_version": 1,
  "request_id": "cad-...",
  "operation": "capture.plot",
  "params": {},
  "deadlines": {"queue_ms": 5000, "response_ms": 120000}
}
```

### 10.2 STA 与队列

- HTTP handler 只校验、排队和等待，不导入或调用 COM。
- 一个专用线程 `CoInitialize/CoUninitialize`，所有 COM 引用只能存在于该线程。
- 有界队列默认 32；满时 `QUEUE_FULL`，不无限堆积。
- queue deadline 与 response deadline 分离；HTTP 超时不能从其它线程强杀正在执行的 COM。
- `RPC_E_CALL_REJECTED` 最多重试 3 次，每次 500ms，仍失败返回 `CAD_BUSY`。
- coordinator 的 CAD child 并发固定 1；bridge 队列仍保留，覆盖 UI 诊断和宿主内部操作。

### 10.3 公开 operation

首期 bridge operation 与 pi 对齐：

```text
app.status / app.start / app.stop / app.restart
doc.list / doc.open / doc.switch / doc.close
extract.run / extract.read
capture.detect_frames / capture.plot / capture.detail
```

bridge 的公开 operation 不等于 child 的可见 action；`stop/restart/close` 在首期 Agent allowlist 中关闭。

### 10.4 Plot 不变量

- 优先使用 `PublishToWeb PNG.pc3 + acWindow + SetWindowToPlot + acad.ctb`。
- 设置 `BACKGROUNDPLOT=0`；PNG 无效时用 `DWG To PDF.pc3` 再由 pypdfium2 栅格化。
- Pillow 裁白边；`ink_ratio < 0.0015` 返回 `PLOT_EMPTY`。
- plot 前保存活动 document、TILEMODE/space/layout、BACKGROUNDPLOT、VIEWCTR、VIEWSIZE、临时 plot 配置和 DBMOD。
- 无论成功或失败都恢复上述状态；恢复异常返回 warning/`VIEW_RESTORE_FAILED`。
- 正式产物发布前重新校验文档身份、源 SHA 和对象级 DBMOD。

## 11. `cad_capture` 与一分四再分

### 11.1 图框检测

`action=detect_frames` 的候选：

1. 闭合四顶点、近似正交的 LWPOLYLINE。
2. 名称含 `图框/TK/FRAME/TITLE` 的块引用。
3. 图层名含上述启发词的实体 bbox。
4. 无候选时使用 drawing extents。

按面积、A 系列 `sqrt(2)` 比例和来源评分并去重。只有未知全图范围时调用；已有目标 bbox/handle 时不把 detect frames 当固定前置。

### 11.2 象限坐标

对 bbox `min=(x0,y0), max=(x1,y1)`，中点 `xm=(x0+x1)/2, ym=(y0+y1)/2`：

| 象限 | WCS bbox |
| --- | --- |
| `q1` 左上 | `[x0,ym] → [xm,y1]` |
| `q2` 右上 | `[xm,ym] → [x1,y1]` |
| `q3` 左下 | `[x0,y0] → [xm,ym]` |
| `q4` 右下 | `[xm,y0] → [x1,ym]` |

`quadrant` 只允许空、`q1..q4` 或两段 `q1/q1..q4/q4`。最多两层；同一纯函数同时用于请求校验、文件命名、manifest bbox 和单元测试，避免像素裁切与 WCS 定位不一致。

### 11.3 视觉概览算法

1. 对实际选用的 frame 生成 `full/q1/q2/q3/q4` 五张精确 WCS plot。
2. 每张 PNG 不超过 4096×4096 且不超过 20MB。
3. 一次请求发送给 Qwen3.8 Max，要求宏观标题、图别、比例、平/立/剖、表格/配筋/标高线索和每区 `legible/needs_zoom`。
4. 仅对 `needs_zoom=true` 的一级象限生成其四个二级象限。
5. 最多进行一次补充视觉请求；最多 16 张补充图，总图片上限 21。
6. 不继续递归。构件仅被象限边界切开时标记 `boundary_truncated` 并联看相邻区，不因此自动放大。
7. 写入 visual artifact；ToolResult 返回摘要和路径，不回图片正文。

推荐视觉请求参数：

```json
{
  "model": "qwen3.8-max",
  "enable_thinking": false,
  "vl_high_resolution_images": true,
  "response_format": "strict-json"
}
```

宏观视觉索引已确定关闭 thinking。未来若变更此策略，必须修改 producer fingerprint，避免复用不同口径的视觉产物。

视觉索引最小 schema：

```json
{
  "schema_version": 1,
  "drawing": {"name": "sample.dwg", "project_relative_path": "drawings/sample.dwg"},
  "frame_id": "frame-01",
  "model": "qwen3.8-max",
  "generated_at": "...",
  "overview": {
    "title": null,
    "drawing_type": null,
    "scale": null,
    "summary": "",
    "visible_sections": []
  },
  "regions": [
    {
      "region_id": "q1",
      "bbox": {"min": [0, 0], "max": [21000, 14850]},
      "image_path": ".xiaoliang/cad/.../q1.png",
      "legible": true,
      "needs_zoom": false,
      "boundary_truncated": false,
      "summary": "",
      "labels": []
    }
  ],
  "warnings": []
}
```

视觉索引只能用来回答“去哪里看”。涉及构造做法、小字、尺寸、编号、钢筋、数量或标高时必须继续精读。

## 12. `cad_detail`：最后一步精准精读

参数：

- `document`：可选名称/index。
- `handles`：可选 1–8 个 handle。
- `window`：可选 WCS min/max；与 handles 至少一个存在。
- `padding_ratio`：默认 0.15，范围 0–0.5。

窗口算法：

1. 对每个 handle 执行 `HandleToObject → GetBoundingBox`；失败项进入 `missing_handles`。
2. 合并成功 bbox 的角点和显式 window。
3. `base=max(width,height)`；所有点重合则 `INVALID_ARGUMENT`。
4. 四边各扩 `padding_ratio * base`。
5. 长短边超过 4:1 时对称扩短边到 4:1。
6. 使用满像素预算 plot；空图由 ink ratio 门禁拒绝。

相同 canonical params 生成稳定文件：

```text
.xiaoliang/cad/previews/{drawing-key}/details/detail-{params-sha256[0:10]}.png
```

child 应从实体/视觉候选中尽量选择同一局部至少两个可见 handle，避免单点窗口裁掉上下文。读取图片后可调整 anchors/padding 重试一次。图片证明图面观察；精确数值仍引用 `cad_extract read` 返回的字段。

## 13. 自动调用策略

用户不再需要先选择实体或点击“读取实体/视觉识图”。默认策略：

| 用户任务 | cadsubagent 自动链路 |
| --- | --- |
| 图层、类型、块、文字、数量、范围统计 | artifact status → 缺失时 MLight extract → 一次 `cad_query`；关键数值按需 COM read |
| “这张图大概有什么”/找图名/找区域 | entities status → visual status → 缺失时 detect frame + 全图/四象限 + needs_zoom |
| 节点、详图、构造做法、小字、配筋、标高 | query/visual 定位 → COM batch read → `cad_detail` → child 原生读图 |
| 已知 handle/bbox | 跳过 detect frame/全图视觉 → COM read + detail |
| 图纸未打开但项目内路径明确 | `cad_app list` → `open/switch` → 后续流程 |
| 模糊跟进“再看看这个” | 主 Agent 先解析为明确 task；child 不读取父历史 |
| 用户明确“刷新/重做” | invalidate/force；否则永不 force |
| CAD/bridge 异常 | 先稳定错误；只有环境不清楚时 `cad_doctor` |

活动 CAD selection 可以作为可选的额外锚点，但不能再是实体抽取或构件教学的必需前置。没有 selection 时，Agent 应从问题、项目 DWG、实体文本、bbox 和视觉区域自动定位；确实存在多个不可区分目标时才向用户询问。

推荐的自动化时机是 lazy-on-demand：进入项目只做 DWG/status 发现；第一个需要 CAD 证据的委派自动生成缺失 artifact。这样不会对用户从未询问的全部图纸产生 COM 占用和视觉成本。

## 14. Evidence pack

宿主将 child 最终文本写为：

```text
.xiaoliang/cad/evidence/{child-run-id}/evidence.md
```

固定结构：

```md
# CAD Evidence Pack

## 委派任务
<原样记录已消解的 task>

## 目标定位
- 图纸：结构/地下室.dwg
- 图框/区域：frame-01 / q2/q3
- 定位依据：文字、handle、bbox 或视觉导航

## 图片证据
- [IMG-001] `.xiaoliang/cad/previews/.../detail-abc.png`
  - 字面观察：……
  - 关联实体：A12、A13

## 实体与文件摘录
- [ENT-001] handle=A12，type=DIMENSION，measurement=200，layer=……
- [TXT-001] `entities.readable.md` 中的相关原文……

## 限制与未采用材料
- 仍不可读：……
- 未采用：q4 的材料与目标不在同一区域……
```

禁止出现“结论”“最终答案”“建议用户……”等回答性章节。证据条目必须能回到项目相对文件、handle、bbox 或图片。

写入流程：

1. child 完成后宿主验证文本不含秘密、绝对路径、base64 和项目外引用。
2. 将 task 作为独立受信段落写入，不能允许 child 改写委派目标。
3. 检查所有引用文件位于允许的 CAD artifact 目录且存在。
4. 原子写入 evidence.md；成功后才将 child 状态置为 completed。
5. 主 Agent 用白名单 artifact reader 读取 evidence；需要时再读取被引用图片。

内部 child trace 可保存在 userData 的 `subagent-runs/{child-run-id}`，用于诊断和审计，设置保留期；它不进入项目 evidence，也不能被主模型读取。

## 15. 稳定错误与恢复

至少定义：

```text
AUTH_REQUIRED / PROTOCOL_MISMATCH
QUEUE_FULL / QUEUE_TIMEOUT / RESPONSE_TIMEOUT
CAD_NOT_RUNNING / CAD_BUSY / UNSUPPORTED_LT
NO_ACTIVE_DOCUMENT / DOCUMENT_NOT_FOUND / ENTITY_NOT_FOUND
UNSAVED_DOCUMENTS / PATH_OUTSIDE_PROJECT / INVALID_ARGUMENT
MLIGHT_UNAVAILABLE / MLIGHT_PARSE_FAILED
ARTIFACT_MISSING / ARTIFACT_STALE / ARTIFACT_CORRUPT / DRAWING_DIRTY
DBMOD_GUARD_UNAVAILABLE / PLOT_EMPTY / VIEW_RESTORE_FAILED
MODEL_UNAVAILABLE / MODEL_SCHEMA_INVALID / GATEWAY_QUOTA_EXCEEDED
SUBAGENT_CANCELLED / INTERNAL_ERROR
```

恢复原则：

- MLight 失败只自动降级一次 COM，不循环重试两种 backend。
- Qwen 429/5xx 最多重试一次；schema 无效可用同一请求做一次严格修复，记录 attempt count。
- CAD_BUSY 由 bridge 完成三次短重试；child 不再无上限重试。
- cancellation 取消 queued child；running child 传播 AbortSignal，但不从错误线程强杀 COM。
- 任何生成失败都保留旧 valid artifact，不发布半成品。
- 所有恢复行为和降级必须写入 evidence 限制与 telemetry。
