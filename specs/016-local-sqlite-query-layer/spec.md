# 016 · FastAPI 单文件本机 SQLite

状态：Implemented

## 目标

FastAPI 不再连接 PostgreSQL。运行时只保留一份干净的本机 `topology-semantics.sqlite`，用于后续保存局部拓扑、现场观察、视觉事实、主模型解释及其关联。旧业务需求/CAD 查询库和 PostgreSQL 历史实例全部清理，不迁移。

## 数据对象

- `topology-semantics.sqlite`：唯一活动数据库文件，路径由 `TOPOLOGY_SEMANTICS_SQLITE` 给出。
- `topology_patterns`：可复用的拓扑指纹。
- `topology_observations`：某次图纸精读的现场证据。
- `semantic_descriptions`：视觉事实、主模型解释或人工描述。
- `topology_semantic_links`：观察、模式和描述之间的多对多关联。

## 约束

- SQLite 文件不进 git，不复制客户 DWG，只保存结构化记录和本地 artifact 引用。
- FastAPI 首次启动只建空表，不导入旧业务需求、CAD 能力或 PostgreSQL 记录。
- 观察与描述写入继续保持幂等；同键异内容返回冲突，不静默覆盖。
- Redis 和 OSS 适配保留；PostgreSQL 不再参与启动、就绪检查或请求处理。
- 旧业务需求/CAD 接口代码暂留兼容，但没有活动数据物化；产品新数据只进入拓扑语义 SQLite。

## API

活动持久化接口：

- `POST /api/v1/topology-semantics/observations`
- `POST /api/v1/topology-semantics/descriptions`
- `POST /api/v1/topology-semantics/match`
- `GET /api/v1/topology-semantics/*`

## 验收

- `data/datasets/local/` 只剩 `topology-semantics.sqlite`，初始四表均为 0 行。
- PostgreSQL `ontology` schema 和 Alembic 标记已删除。
- FastAPI 默认使用 SQLite 仓储，启动脚本不执行 Alembic，就绪检查报告 `sqlite`、`redis`、`oss`。
- 拓扑写入、重复幂等、同键冲突、哈希匹配、详情和语义搜索回归通过。
- 根 `.env` / `.env.example` 键集合一致，Pi 可继续通过原 API 回写。
