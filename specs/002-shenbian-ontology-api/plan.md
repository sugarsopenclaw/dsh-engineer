# 002 — 实施计划

## 目录

```text
backend/
  pyproject.toml
  uv.lock
  src/shenbian_api/
    api/                 HTTP 路由和依赖注入
    application/         查询与用例、基础设施端口
    domain/              领域类型与不变量
    infrastructure/      PostgreSQL / Redis / OSS / YAML 适配
    core/                配置和应用生命周期
  tests/

ontology/shenbian/v1/
  ontology.yaml          Object / Link / Action 类型契约

data/catalog/
  shenbian-*.yaml        Source 与 staging 登记
```

## 阶段 A — 本轮纵向切片

1. 编写 SDD、DDD 和客户数据利用方案；
2. 建立 `ontology.yaml` 及启动时校验；
3. 建立 4 份 Data Catalog 登记；
4. 建立 uv/FastAPI 工程；
5. 实现存活、就绪、Ontology 和 Data Catalog 查询 API；
6. 用替身基础设施完成单元测试；
7. 使用根 `.env` 对 PostgreSQL、Redis、OSS 做只读连通性验证。

## 阶段 B — 数据导入

1. 实现 `import_thcad_extraction` 管线；
2. 输出 raw/staging manifest 和质量报告；
3. 生成 drawing asset、revision、snapshot curated 表；
4. 建立 PostgreSQL 初始 schema 与迁移；
5. 在 API 中提供 DataAsset、Drawing、DrawingRevision 和 ExtractionSnapshot 查询。

## 阶段 C — DXF 净化任务骨架

1. 建立 ReviewTask、CheckRun、Finding、Evidence、Artifact 聚合；
2. 实现创建任务、确认制造区域、预览净化和人工复核 Action；
3. 接入天河 CAD 工作节点；
4. 实现制造几何安全门后再开放 DXF 导出。

## 阶段 D — 铁芯叠片一致性

1. 建立 ParameterSet 和字段字典；
2. 实现叠片几何重建、视图对齐和校验函数；
3. 形成差异证据、Finding 处置和复核报告；
4. 使用冻结测试集完成专家盲测。

## 技术取舍

- FastAPI 使用多模块 `APIRouter` 和 lifespan 管理共享资源；
- Python 项目使用 `src/` 布局，避免工作目录影响导入；
- PostgreSQL 采用 SQLAlchemy 异步引擎；
- Redis 使用官方 `redis.asyncio` 客户端；
- OSS SDK 的同步探测通过线程执行，避免阻塞事件循环；
- 外部服务不可用时 API 仍能启动，`ready` 明确报告失败；
- 第一轮不引入 Neo4j，链接先由声明式契约和 PostgreSQL 实现。

