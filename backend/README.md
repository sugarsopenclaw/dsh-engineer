# shenbian-api

本地 Pi Agent 的共享 API。沈变插件负责理解用户任务并调用 THCAD；FastAPI 用一份本机 SQLite 保存拓扑与语义，同时保留 Redis 与 OSS 适配。不要求上传当前 DWG，也不参与本地 CAD 图元读写。

## 启动

后端只读取仓库根目录 `.env`，不要在本目录创建第二份环境文件。

从仓库根目录只启动后端：

```powershell
.\scripts\start-backend.ps1
```

也可以直接双击根目录 `start-backend.cmd`。该入口不会启动 Pi、THCAD、Redis、OSS 或前端。

分步启动仍然可用：

```powershell
cd backend
uv sync
uv run shenbian-api
```

默认监听 `127.0.0.1:8000`。开发时可直接运行：

```powershell
uv run uvicorn shenbian_api.app_factory:create_app --factory --reload
```

## 本机数据库

FastAPI 运行时不再连接 PostgreSQL，也不再执行 Alembic。唯一活动数据库是：

- `data/datasets/local/topology-semantics.sqlite`

路径由根 `.env` 的 `TOPOLOGY_SEMANTICS_SQLITE` 给出。首次启动自动创建空表；之后由 Pi 的局部精读链路幂等写入。旧业务需求/CAD SQLite 已删除，线上 PostgreSQL `ontology` schema 已清空，历史数据不迁移。

已有的共享读取与诊断接口代码继续保留，但业务需求/CAD 旧数据已经清理，不会回退读取历史库；它们也不构成 DWG 本地任务的前置流程：

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `GET /api/v1/ontology`
- `GET /api/v1/ontology/actions`
- `GET /api/v1/data-catalog`
- `GET /api/v1/business-requirements/graph`
- `GET /api/v1/business-requirements/{requirement_id}`
- `GET /api/v1/cad-capabilities/atoms`
- `GET /api/v1/cad-capabilities/graph-atoms`
- `GET /api/v1/cad-capabilities/atoms/{atom_id}`
- `GET /api/v1/cad-capabilities/facets`
- `POST /api/v1/topology-semantics/observations`
- `POST /api/v1/topology-semantics/descriptions`
- `POST /api/v1/topology-semantics/match`
- `GET /api/v1/topology-semantics/semantics`
- `GET /api/v1/topology-semantics/semantics/{description_id}`
- `GET /api/v1/topology-semantics/patterns`
- `GET /api/v1/topology-semantics/patterns/{pattern_id}`
- `GET /api/v1/topology-semantics/observations/{observation_id}`
- `GET /api/v1/topology-semantics/semantics/search?query=法兰`
- `GET /docs`

业务需求图谱接口的参数、响应类型、坐标语义和前端联调顺序见 [`docs/backend/business-requirements-graph-api.md`](../docs/backend/business-requirements-graph-api.md)。CAD 原子能力接口见 [`docs/backend/cad-capabilities-api.md`](../docs/backend/cad-capabilities-api.md)。

## 拓扑语义与局部精读记录

`delegate_thcad_bom_close_reading` 每完成一个序号段，就登记一条 `TopologyObservation` 和一条视觉 `SemanticDescription`；父 Agent 给出最终用户解释时，再追加一条可同时关联本次多个局部拓扑的主模型描述。记录包含：

- 实例级 `graph_hash`、消除平移/旋转/镜像/统一比例后的 `shape_hash`、保留实际尺寸的 `metric_hash`；
- 选中图元的句柄、世界坐标路径、图层/线型/颜色和局部范围；
- 完整 plot、去干扰 plot、确定性 sidecar 的本地引用与 SHA-256；
- BOM 序号段和 capability 21 同定义实例覆盖证据；
- 视觉子代理结构化事实、原始输出/Session 引用和主模型最终解释。

Pi 先把请求写入 review bundle 内的不可变 `topology-semantics-outbox/`，再尝试本接口。同步回执位于 `.pi/runtime/thcad-reviews/semantic-sync/`，不会在 review bundle 定稿后改写其完整性清单。后端暂不可用不影响 THCAD 只读取证；恢复后在 Pi TUI 执行 `/thcad-semantic-sync` 重放。规格见 [`specs/015-topology-semantic-library/`](../specs/015-topology-semantic-library/)。

## 验证

```powershell
uv run pytest
uv run ruff check .
```
