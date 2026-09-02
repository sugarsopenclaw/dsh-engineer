# 本机 SQLite 查询层

历史业务需求和 CAD 原子能力查询物化工具。当前 FastAPI 不再加载这两类实例，旧 SQLite 已删除；运行时只使用 `data/datasets/local/topology-semantics.sqlite` 保存后续拓扑与语义。

## 当前状态

这些脚本只为历史复现保留，不再是 FastAPI 启动或数据准备步骤。不要重新生成：

- `data/datasets/local/business-requirements.sqlite`
- `data/datasets/local/cad-capabilities.sqlite`

当前唯一活动文件是 `data/datasets/local/topology-semantics.sqlite`，由 FastAPI 自动建立结构、由 Pi 精读链路写入。PostgreSQL 清理已经完成，不再执行本目录的 PostgreSQL 清理脚本。
