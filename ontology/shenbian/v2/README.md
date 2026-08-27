# v2：客户需求业务 Ontology

[`business-requirements.yaml`](business-requirements.yaml) 定义需求发现阶段的对象、关系和动作类型，实例来自数据集登记 `shenbian.client_requirements.curated.v1`。

这一版只建模客户需求本身：客户原话、规范化名称、原子拆分、来源证据、适用范围、候选验收条件、去重决定、待确认问题和视图布局。它尚未把需求连接到 `local-dev/cad` 的 01—07 logic、THCAD 能力点或 AgentRun；这些连接应由后续实际执行与 review 产生。

`RequirementRelation`、`RequirementSourceLink`、`RequirementScopeAssignment` 等关系带有自身元数据，因此按对象化关系建模。图谱坐标属于 `GraphView` 下的 `GraphLayoutPosition`，不是 `BusinessRequirement` 的属性。

