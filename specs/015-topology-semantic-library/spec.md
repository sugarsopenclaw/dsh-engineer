# 015 · 拓扑语义与局部图元审读库

状态：Implemented

## 目标

把 THCAD 局部构件精读中已经产生的确定性拓扑、选中范围、完整图、去干扰图、BOM/能力 21 对账证据、视觉模型理解和主模型最终解释，按同一现场观察持久化到 backend。随着样本积累，可以按拓扑检索历史语义，也可以对语义描述建立 RAG 索引后反查候选拓扑。

## 数据对象

- `TopologyPattern`：版本化的图结构、形状和实际尺寸指纹，以及生成指纹的完整确定性特征。
- `TopologyObservation`：某张图、某次分析、某个局部序号段的现场实例；保存选中态、plot、BOM、能力 21 和本地 review bundle 引用。
- `SemanticDescription`：视觉模型、主模型或人工给出的完整机械语义描述，保存模型、提示词、会话和证据来源。
- `TopologySemanticLink`：模式与描述的多对多链接；同一拓扑允许多种机械角色，一段跨多个局部实例的主模型解释也可以链接多个模式。

## 约束

- 拓扑指纹和模型语义分开保存；模型输出不得改写确定性指纹。
- `shape_hash` 用于同形候选，`metric_hash` 保留实际尺度，`graph_hash` 保存连接结构摘要；全部带 `fingerprint_schema_version`。
- 不把一个拓扑强制解释为唯一构件身份，不使用数字置信度限制模型的机械推理；检索返回的是哈希命中类型和可复验来源。
- 后端只保存图片、sidecar、Session 和 artifact 的引用、大小及 SHA-256，不复制客户 DWG，也不把 backend 设为 THCAD 本地操作的前置条件。
- 写接口按 `knowledge_scope + ingestion_key/description_key` 幂等。相同键不同内容视为冲突，不静默覆盖历史。
- Pi 在视觉分段完成后登记现场观察与视觉描述，在父 Agent 收尾后追加最终解释。backend 暂时不可用时写本地 outbox，后续可重放。

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
- 19/20/21 精读记录包含共同序号段、BOM 行、能力 21 对账、两张 plot、选中图元拓扑、视觉输出和父模型解释。
- backend 测试、Alembic migration、Pi 类型检查和精读 fixture 回归通过。
