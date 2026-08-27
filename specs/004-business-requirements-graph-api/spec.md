# 004 — 业务需求图谱查询 API

## 背景

`shenbian.client_requirements.curated.v1` 已经通过根 `.env` 指向的 PostgreSQL 落入 `ontology` schema。前端需要真实接口读取 240 个业务需求、249 条关系和节点详情，不能依赖 Mock 或直接连接数据库。

## 需求

- **R1** 提供 `GET /api/v1/business-requirements/graph`，一次返回选定数据集和视图中的全部需求节点、关系及可直接渲染的 2D/3D 坐标。
- **R2** 提供 `GET /api/v1/business-requirements/{requirement_id}`，返回需求、上下游关系、别名、来源证据、范围、候选验收条件和待确认问题。
- **R3** 数据只从 PostgreSQL `ontology` schema 查询，连接只读取根 `.env` 的 `DATABASE_URL`；前端不读取 JSONL 或数据库。
- **R4** 当数据库坐标为空时使用确定性的 `initial-semantic-v1`：越贴近客户原始表达，欧氏距离越接近原点；同一输入重复请求坐标不漂移。
- **R5** 2D 与 3D 使用同一语义半径；3D 高度当前只用于稳定摊开，不表达优先级、成效或其他业务事实。
- **R6** 数据集、视图和需求不存在时分别返回稳定的 `404` 错误码；数据库不可用时返回不泄露连接信息的 `503`。
- **R7** API 进程关闭时释放查询连接池；领域与应用模型不依赖 FastAPI、SQLAlchemy、Redis 或 OSS SDK。
- **R8** OpenAPI、仓库 API 文档、接口测试和真实数据库验收必须与实现一致，不保留“Mock/待实现”的交付状态。

## 非目标

- 不在本规格实现需求写入、拖拽坐标保存或版本发布动作；
- 不把来源证据、能力、logic、AgentRun 或 Review 作为首屏图节点；
- 不增加服务端分页、全文搜索或通用图查询语言；
- 不扩大 CORS 或改变当前本机/受控内网部署边界。

## 验收

1. 真实数据库请求返回 `nodes=240`、`edges=249`、`atomic_requirements=201`、`level_one_requirements=20`。
2. `dimensions=2` 时全部 `z=0`；`dimensions=3` 时每个生成坐标的欧氏距离仍等于其语义半径。
3. 连续两次请求的节点顺序和坐标完全一致。
4. 查询 `BR-A01` 能返回其直接证据、上下游关系和关联业务对象。
5. 自动化测试覆盖成功、参数校验、三类 404、503 脱敏和资源关闭。
