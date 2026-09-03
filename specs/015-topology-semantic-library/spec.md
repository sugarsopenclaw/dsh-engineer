# 015 · 拓扑语义与局部图元审读库

状态：Implemented

## 目标

把 THCAD 局部构件精读中已经产生的确定性拓扑、选中范围、完整图、去干扰图、BOM/能力 21 对账证据、视觉模型理解和主模型最终解释，按同一现场观察持久化到 backend。随着样本积累，可以按拓扑检索历史语义，也可以对语义描述建立 RAG 索引后反查候选拓扑。

## 数据对象

- `TopologyPattern`：版本化的图结构、形状和实际尺寸指纹，以及生成指纹的完整确定性特征。
- `TopologyObservation`：某张图、某次分析、某个局部序号段的现场实例；保存选中态、plot、BOM、能力 21 和本地 review bundle 引用。
- `SemanticDescription`：视觉子代理给出的可复核事实，或主模型/人工给出的机械语义描述；保存模型、提示词、会话和证据来源。
- `TopologySemanticLink`：模式与描述的多对多链接；同一拓扑允许多种机械角色，一段跨多个局部实例的主模型解释也可以链接多个模式。

## 约束

- 拓扑指纹和模型语义分开保存；模型输出不得改写确定性指纹。
- 视觉子代理只提取当前图像、BOM 与宿主拓扑中可复核的事实、对应关系、未观察项和冲突，不补充用途、设计意图、其他视图形态或变压器领域知识。
- 主 Agent 读取事实证据后，围绕用户问题结合数值、形状、机械制图与变压器知识进行推理，并在用户答案中区分证据与推理。
- `shape_hash` 用于同形候选，`metric_hash` 保留实际尺度，`graph_hash` 保存连接结构摘要；全部带 `fingerprint_schema_version`。
- 不把一个拓扑强制解释为唯一构件身份，不使用数字置信度限制模型的机械推理；检索返回的是哈希命中类型和可复验来源。
- 后端只保存图片、sidecar、Session 和 artifact 的引用、大小及 SHA-256，不复制客户 DWG，也不把 backend 设为 THCAD 本地操作的前置条件。
- 写接口按 `knowledge_scope + ingestion_key/description_key` 幂等。相同键不同内容视为冲突，不静默覆盖历史。
- Pi 在视觉分段完成后登记现场观察与视觉事实，在父 Agent 收尾后追加最终解释。backend 暂时不可用时写本地 outbox，后续可重放。
- 一次全 BOM 精读先串行完成当前图的 .NET 分析、全部序号段 Plot 和不可变视觉输入快照，再复用现有无工具视觉 child，以最多 10 路并发理解各序号段；结果仍按原序号段顺序汇总和持久化，不新增子代理类型。
- 局部窗口 Plot 生成的中间 PDF 不使用经验字节阈值判定可用性；只要产物存在就交给实际栅格化与图像内容检查决定是否可用。
- 批处理完成后只向父 Agent 回传文本清单：整体与逐段完成情况、结构化结果/覆盖账本/Review 引用，以及每段完整图、去干扰图和拓扑边车的路径。图片字节不重复嵌入父上下文；父 Agent 先读子代理事实，需要视觉复核时再按清单读取对应图片。

## API

- `POST /api/v1/topology-semantics/observations`
- `POST /api/v1/topology-semantics/descriptions`
- `POST /api/v1/topology-semantics/match`
- `GET /api/v1/topology-semantics/semantics`
- `GET /api/v1/topology-semantics/semantics/{description_id}`
- `GET /api/v1/topology-semantics/patterns`
- `GET /api/v1/topology-semantics/patterns/{pattern_id}`
- `GET /api/v1/topology-semantics/observations/{observation_id}`
- `GET /api/v1/topology-semantics/semantics/search`

## 验收

- 同一观察和描述重复提交只返回原记录，不增加重复行；同键异内容返回 409。
- 一个视觉描述可链接一个局部拓扑，父模型最终解释可链接同一 run 下多个拓扑。
- 可以按 shape/metric/graph 哈希召回模式、实例和语义，也能按语义正文反查候选模式。
- 19/20/21 精读记录包含共同序号段、BOM 行、能力 21 对账、两张 plot、选中图元拓扑、v2 视觉事实和父模型解释；视觉事实不包含用途或领域推断。
- BOM 视觉调度回归证明并发上限为 10，并发完成顺序不改变批次结果的序号段顺序。
- BOM 父链交接回归证明工具结果只有文本清单和文件引用，不含图片 content；父模型以 error、aborted、length 或空文本结束时 Review 保持 partial。
- backend SQLite 仓储测试、Pi 类型检查和精读 fixture 回归通过。
