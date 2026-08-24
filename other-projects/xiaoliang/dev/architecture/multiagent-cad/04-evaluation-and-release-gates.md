# 评测、验收与发布门禁

状态：Accepted

适用范围：Subagent 内核、MLightCAD、Python COM bridge、视觉概览、局部精读、Qwen3.8 Max 和最终切换

## 1. 原则

CAD 识图的“更快、更准”必须用同一批 DWG、同一问题和可复核证据来证明。验收分为五类：

1. 隔离与安全是绝对门禁，不能用平均指标抵消一次泄漏。
2. 实体、图片和回答质量使用人工标注 golden set。
3. 性能使用相同机器和 AutoCAD 版本做旧/新链路相对比较。
4. 缓存和产物一致性用确定性测试，而不是观察 UI 状态。
5. 真机 AutoCAD、安装包和 Qwen gateway 都必须跑纵向闭环，mock 不能替代最终验收。

## 2. Golden CAD 数据集

### 2.1 最小构成

建议至少包含：

| 类别 | 覆盖点 |
| --- | --- |
| 单图框平面图 | 文字、尺寸、轴网、块、图层、常规定位 |
| 多图框综合图 | 图框检测、frame 选择、同页多个专业区域 |
| 立面/剖面 | 标高、层高、剖切符号、细小文字 |
| 节点/详图 | 构造层次、密集标注、局部精读、相邻上下文 |
| 钢筋/配筋表 | 表格、引线、块属性、数字易混淆 |
| 大型密集 DWG | MLight 性能、装箱、内存和 p95 |
| 稀疏/异常 DWG | extents fallback、空 plot、坏实体容错 |
| 多个同名 DWG | drawing-key 与项目相对路径隔离 |
| DXF/版本差异 | MLight 兼容与 COM fallback |
| dirty/修改中 DWG | DBMOD、持久 artifact 发布门禁 |

每个文件记录 SHA-256、来源授权、匿名化状态、AutoCAD 版本和预期 frame/bbox。数据集不能包含未经授权的客户图纸进入仓库；敏感样本在受控本地路径运行，仅提交 manifest 和汇总结果。

### 2.2 任务类型

每张适用图纸至少准备以下问题：

- 确定性统计：实体类型、图层×类型、块引用、文字出现次数、bbox 范围。
- 目标定位：给定节点名/图号/构件名，返回正确 frame/象限/候选 handle。
- 宏观概览：图纸种类、可见区域、表格/剖面/节点所在位置。
- 精确读数：标注 measurement、标高、尺寸、属性值。
- 构造精读：必须结合局部图和实体的做法/节点问题。
- 不可回答：信息不存在、图片不可读、多个同名目标无法消歧。
- 对话跟进：父 Agent 将“这个/再看看/继续”改写成独立 task。

人工标注至少包含：正确 DWG、frame/quadrant、相关 handles、权威字段、应读 detail window、可见图面事实、允许的推断和必须拒答的字段。

## 3. G0：隔离与安全绝对门禁

以下任一失败即 No-Go：

| 门禁 | 要求 |
| --- | --- |
| 父→子上下文 | child 初始上下文中父 transcript、父 tool result、workspace memory 和 canary secret 命中数为 0 |
| 子→父投影 | 父 session 中 child transcript、reasoning、raw JSONL、bridge token、绝对项目外路径命中数为 0 |
| 二进制泄漏 | delegate content/details、日志、DB payload 中 data URI/长 base64 命中数为 0 |
| 工具权限 | cadsubagent 无 write/edit/shell/delegate/任意 command；主 Agent 无直接 CAD/MLight/bridge 工具 |
| 嵌套深度 | cadsubagent 生成孙子 Agent 的成功次数为 0 |
| 路径边界 | `..`、junction/symlink、大小写/UNC 等项目根逃逸测试全部拒绝 |
| COM 线程 | 所有 COM 创建/访问只发生于单一 STA thread；跨线程测试 0 次通过 |
| CAD 并发 | 任意时刻活动 CAD child ≤1；第二任务只能 queued |
| 图纸状态 | 成功/失败/取消后活动文档、layout/space、视图和 DBMOD 对象位恢复率 100% |
| 产物事务 | 失败运行不替换旧 valid set；半成品被发布次数为 0 |
| 计费授权 | child/aux 无 `client_run_id` 的模型请求成功次数为 0 |

建议在测试 transcript 中放入随机 canary，例如 `PARENT_ONLY_<uuid>`，并扫描 child prompt/trace；在 child 工具结果放另一 canary，扫描父 session。测试不能只断言代码没有显式 copy。

## 4. G1：功能正确性

### 4.1 Subagent 生命周期

- `queued → initializing → running → completed|failed|cancelled` 转换合法率 100%。
- 每个 terminal run 恰好一次完成通知、一次 usage 结算和最多一个 evidence pack。
- 取消当前 parent prompt 只影响该 prompt 的 child；早期已完成/其它 prompt 的 run 不受影响。
- 应用重启后能把遗留 running 状态 reconcile 为明确失败/取消，不永久显示运行中。
- SafeDetails key 与类型快照完全匹配，未知字段不能穿透。

### 4.2 Artifact

- 同一未修改 DWG 连续两次 entities/visual：第二次 `cache.hit=true`，抽取/plot/视觉模型调用数均为 0。
- 源 SHA 改变得到 `stale_source`；producer fingerprint 改变得到 `stale_pipeline`；产物 hash 改变得到 `corrupt`。
- mtime 改变但 SHA 不变仍可 valid。
- 完整实体 superset 存在时，窄查询不得覆盖完整索引。
- 同项目同名 DWG 不冲突；跨项目相同 DWG 不共享未授权路径。
- manifest/SQLite 任一丢失时状态可按约定重建或降级，不能伪 ready。

### 4.3 自动调用

- 缺 entities 且任务需要实体：Agent 自动调用一次 extract，无用户点击。
- 缺 visual 且任务需要概览：自动生成 visual，无用户点击。
- 纯实体统计任务不 plot、不调用视觉模型。
- 已知 handle/bbox 的精读任务不调用 detect frames。
- 视觉只导航；精确读数任务必须出现 COM `extract.read` 或明确的不可确认结论。
- 用户未要求刷新时 `force=true` 调用数为 0。

## 5. G2：识图质量门禁

以下阈值为首版建议；P0 基线完成后可调高，调低必须记录原因和批准人。

| 指标 | 定义 | 建议门禁 |
| --- | --- | --- |
| 目标定位 Recall@1 | 首个 frame/region/handle 候选包含人工目标 | ≥90% |
| 目标定位 Recall@5 | 前五候选包含人工目标 | ≥98% |
| detail 可用率 | detail 图同时包含目标主体和必要邻近上下文，且非空/非错误窗口 | ≥95% |
| 精确数值 exact match | 对人工标为可读取的 measurement/属性任务，数值与单位匹配 | ≥98% |
| 无依据数字 | 最终答案出现无法追到实体/measurement/明确计算的精确数字 | 0 |
| 宏观区域覆盖 | 人工标注的重要图区至少被 overview/region 索引命中 | ≥95% |
| 不可答克制率 | 无证据/不可读任务明确限制或询问，不编造答案 | 100% |
| Evidence 完整率 | 最终关键事实在 evidence 中有实体或图片条目 | ≥98% |
| 跨区污染 | 使用不相关象限/图框材料支持目标结论 | 0 |

对于剩余未达到 exact match 的任务，正确行为只能是“待确认/不可读”，不能给出错误数字。工程数字错误比拒答更严重，发布评估应单独统计 wrong-answer rate，而不是只看平均准确率。

### 5.1 旧/新盲评

对同一问题隐藏链路来源，由至少两名熟悉图纸的评审分别评分：

- 定位是否正确。
- 证据是否对应同一目标区域。
- 局部图是否足够清晰。
- 数值是否有权威来源。
- 回答是否混淆视觉猜测与实体事实。
- 失败时是否给出最小且正确的下一步。

新链路必须在总体质量上优于旧链路，且任何安全/数字错误类别不退化。

## 6. G3：速度与资源门禁

性能统一在同一台机器、同一 AutoCAD 2024、同一 DWG、本地冷/热缓存条件下运行至少 5 次，报告 p50/p95，不只报最快值。

| 指标 | 建议目标 |
| --- | --- |
| MLight 冷实体索引 p50 | ≤旧 COM 全图读取 p50 的 35% |
| MLight 冷实体索引 p95 | ≤旧 COM 全图读取 p95 的 60% |
| entities warm cache | p95 ≤2s，且 0 COM/0 模型调用 |
| visual warm cache | p95 ≤2s，且 0 plot/0 模型调用 |
| 首轮视觉图片数 | 固定 5 |
| 总视觉图片数 | 5–21，永不超过 21 |
| 宏观视觉模型调用 | 1–2，永不超过 2 |
| `cad_query` 正常模型调用 | 1；429/5xx 时最多 2 |
| COM 活动并发 | 1 |
| child 排队公平性 | FIFO，无后到任务插队 |
| detail 重试 | 默认 0；因可读性最多 1 次 |

若 MLight 对某类 DWG 明显慢于 COM，应通过格式/大小策略选择 COM fallback，而不是取消整体 MLight 默认。策略条件必须可测试并进入 producer/telemetry。

需要记录的阶段耗时：

```text
delegate_queue_ms
child_startup_ms
artifact_validation_ms
mlight_parse_ms / com_extract_ms
cad_query_scan_ms / cad_query_model_ms
plot_ms
visual_model_ms
detail_ms
evidence_write_ms
total_child_ms
parent_evidence_read_ms
```

## 7. G4：Qwen3.8 Max 能力门禁

现有 `dev/backend/scripts/smoke_qwen38_max_capabilities.py` 应扩展或复用，至少验证：

- gateway 的 default/vision/expert/compaction/query alias 最终都解析为 `qwen3.8-max`。
- `/v1/models` 对该模型声明 `text + image`，context/max output 与前端 runtime 一致。
- 主 Agent fast=`low`、deep=`xhigh` 参数正确，且不同时发送 `reasoning_effort` 与冲突的 `thinking_budget`。
- cadsubagent 能原生读取本地 artifact 经 gateway 归档后的图片。
- 宏观视觉 strict JSON 在 full + quadrants 输入下稳定返回 schema，并固定使用 thinking off。
- `vl_high_resolution_images=true` 实际传到支持链路。
- Tool calling、长上下文、compaction、图片归档和 usage 都能归属同一 client run。
- 401/402/429/5xx、schema invalid 和图片归档失败均在预期位置停止，不绕过 gateway。

每次更新 Qwen provider 参数、模型 alias 或 image pipeline 时，必须跑这一组 smoke 和至少一个真实 CAD 视觉任务。

## 8. 测试分层

### 8.1 无 AutoCAD 单元测试

- Subagent request/schema/definition/capability intersection。
- Coordinator admission、FIFO、parent turn cancellation、terminal idempotency。
- SafeResultProjector 的 key、secret、base64、绝对路径和长度门禁。
- drawing-key、path guard、manifest 状态、hash、staging/rollback。
- MLight serializer 的 fixture object → JSONL/Markdown。
- quadrant 纯函数、最多两层、q1–q4 方向。
- detail bbox union/padding/4:1、退化/非法输入。
- visual strict JSON parser、needs_zoom 选择和 21 图上限。
- evidence parser/writer 的固定章节和引用白名单。
- Qwen input packing、覆盖率、重试上限和 prompt injection 边界。

### 8.2 Fake integration

- fake gateway + fake MLight + fake bridge 的完整主→子→证据→父链路。
- bridge auth/protocol/queue/deadline/error envelope。
- renderer crash、bridge busy、模型 schema invalid、quota exhausted、磁盘写失败。
- 应用重启时 child run reconcile、descriptor 复用与失效。
- old/new artifact migration 和 untracked 状态。

### 8.3 MLight fixture integration

- 在不启动 AutoCAD 的环境解析真实、可提交的 DWG/DXF fixture。
- 与已保存的结构化 golden 对比，升级 MLight 版本时显式 review diff。
- 大文件内存、renderer 重启、串行队列和取消。

### 8.4 AutoCAD 2024 真机

- 无实例启动、已有实例复用、无活动文档、多文档切换。
- open/switch/extract/read/detect/full/quadrants/detail。
- 用户正在操作导致 `RPC_E_CALL_REJECTED`。
- plot PNG 正常、PNG fallback PDF、空白/稀疏图。
- 成功、异常、取消后的 view/layout/DBMOD 恢复。
- 晓量退出/崩溃后 AutoCAD 保持打开。
- 安装包环境下 Python runtime、依赖、MLight worker asset 和 descriptor 权限。

### 8.5 Agent eval

- 自动工具选择与“不做多余工作”。
- 跟进问题 task rewrite。
- 视觉导航后 COM 精读。
- evidence-only child 行为。
- 父 Agent 读取 evidence、选择图片、区分证据/推断并回答。
- CAD 缺失/不可读/多义时的正确克制。

## 9. 故障注入清单

| 故障 | 预期 |
| --- | --- |
| MLight renderer 启动失败 | 一次 COM fallback，记录 warning |
| MLight 解析中崩溃 | staging 清理，旧 valid 保留，可 fallback |
| bridge descriptor 被篡改 | 握手失败并重启，不把 token 写日志 |
| COM busy 超过重试 | `CAD_BUSY`，不无限循环 |
| queue deadline 到期 | queued request 失败；正在执行项不被错误线程强杀 |
| plot 空白 | `PLOT_EMPTY`，不发布 visual/detail |
| view restore 失败 | 明确 warning/error，正式 artifact 不伪 success |
| 源 DWG 在生成中改变 | 发布前 SHA 不同，丢弃 staging 并标 stale |
| DBMOD 对象位 dirty | 不发布持久 artifact，evidence 显式限制 |
| Qwen 返回非 JSON | 最多一次 schema repair，仍失败则不发布 |
| gateway quota 不足 | 结束同一 client run，UI 显示配额错误，不回退未计费模型 |
| evidence 引用项目外图片 | writer 拒绝完成，child failed |
| 用户取消 | queued 立即取消；running 传播 signal，COM 安全收尾 |
| 应用在 child running 时退出 | 重启 reconcile，不遗留永久 running/锁 |

## 10. Telemetry 与隐私

允许记录：

- run/session/project 的内部 ID、drawing 相对路径 hash、源 SHA 前缀。
- agent/model/call purpose、状态、错误 code、duration、turn/tool/image 数、token/usage。
- extraction backend、cache state、实体计数、region 数、plot 指标。
- feature flag 组合、app/bridge/producer version。

禁止记录：

- bridge bearer token、gateway access token、环境秘密。
- base64、签名图片 URL、child reasoning、完整 transcript。
- 原始实体 JSONL、客户图纸正文、绝对本地路径。
- 未经脱敏的 evidence 正文。

日志中的 drawing/project 可使用稳定不可逆 hash；诊断包需要用户明确选择后再收集安全摘要。

## 11. 发布阶段

### Stage A：开发者开关

- 历史开发阶段默认 `XIAOLIANG_CAD_SUBAGENT=off`；P7-C 后生产默认已切为 `on`。
- P1–P5 全部自动化通过，使用 fixture 和内部测试项目。
- 新旧比较只能顺序执行，不能两个 COM worker 同时运行。

### Stage B：内部 canary（knowledge QA）

- 按账号/项目开启，不迁 design。
- 每日检查失败 code、缓存命中、图片数、wrong numeric 和回滚次数。
- 至少完成一次真实安装包升级/回滚演练。

### Stage C：knowledge QA 默认开启

- `delegate` 是唯一 CAD 入口。
- kill switch 只暂停 CAD 自动化，不恢复旧链路；UI 不暴露手动前置按钮。
- 达到连续观察窗口和 G0–G4 门禁。

### Stage D：design 迁移并全面开启

- design 只消费 `CadEvidenceRef`，没有直接 runtime import。
- 运行全仓 architecture test 和设计回归。
- G0–G5（含 packaging）全部通过。

### Stage E：遗留删除

- 两个发布版本无生产依赖。
- 最后一次回滚演练成功。
- 删除旧 stdio/视觉/主 Agent CAD 工具前保留迁移说明。
- 旧 userData artifact 只在用户确认后清理。

## 12. Go/No-Go 检查表

发布负责人只有在以下全部为“是”时才能推进阶段：

- [ ] 三项产品决策已记录。
- [ ] G0 绝对门禁全部通过。
- [ ] golden 质量达到 G2，wrong unsupported numeric 为 0。
- [ ] MLight 和视觉性能达到 G3 或有批准的、数据支持的调整。
- [ ] Qwen3.8 Max capability smoke 通过。
- [ ] AutoCAD 2024 真机成功/失败/取消路径通过。
- [ ] 安装包包含 bridge、Python 依赖、MLight renderer/worker assets。
- [ ] 同一 user run 的 main/child/aux usage 能完整结算。
- [ ] rollback 不关闭 AutoCAD、不删除新产物，已实际演练。
- [ ] UI 不再要求用户手工读取实体/视觉识图。
- [ ] knowledge/design 对应阶段不存在绕过 cadsubagent 的 CAD import/tool。

若任一 G0 项失败，不能以 feature fallback 自动把原始 child 输出塞回主 Agent；正确动作是关闭新链路并修复隔离边界。
