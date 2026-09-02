# 004 — 实施计划

## 分层

```text
FastAPI route
  → BusinessRequirementsQueryService
  → BusinessRequirementsReader port
  → 本机 SQLite adapter
  → business-requirements.sqlite
```

查询层见 [`specs/016-local-sqlite-query-layer/`](../016-local-sqlite-query-layer/)。拓扑语义仍在 PostgreSQL，不在本规格。

- `domain/` 定义图谱、节点、边、详情和错误契约；
- `application/` 负责查询编排与 `initial-semantic-v1` 布局；
- `infrastructure/` 只负责本机 SQLite 参数化查询和结果映射；
- `api/` 只做参数校验、依赖注入和 HTTP 错误映射。

## 查询

图谱接口按数据集一次读取元数据、节点摘要、视图坐标和关系。240 个节点不分页，前端本地筛选。详情接口按节点读取证据、范围、验收项等，避免首屏返回全部正文。

## 布局

根节点在原点。其他节点按 `customer_stated → normalized → domain_decomposition` 形成由内向外的语义层，再用层级深度修正半径。一级需求按 `display_order` 分扇区，子节点在所属扇区内稳定排序；3D 的俯仰角来自稳定 SHA-256，不使用进程随机哈希。

数据库中同一 `layout_version` 的完整坐标存在时优先使用；否则动态生成并明确返回 `position_source`。本规格不持久化动态坐标。

## 运行边界

查询池随 FastAPI lifespan 关闭。数据库异常只向客户端暴露固定错误码，不回显 SQL、参数、连接串或源文件路径。开发前端通过 `/api` 反向代理联调。
