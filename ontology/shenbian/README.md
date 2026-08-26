# 沈变图纸审查 Ontology

`v1/ontology.yaml` 是首期 Object / Link / Action 类型契约。它描述业务语义和允许的业务动作，不保存客户对象实例，也不连接数据库。

设计依据见 [`specs/002-shenbian-ontology-api/domain-model.md`](../../specs/002-shenbian-ontology-api/domain-model.md)。FastAPI 在启动时校验并通过只读 API 暴露该契约；实际对象状态后续存入 PostgreSQL，CAD 原子事实保留在 Data Layer。

