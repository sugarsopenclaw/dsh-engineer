# 实现计划

1. 定义版本化拓扑指纹、观察、语义描述和多对多链接契约。
2. 用 Alembic 建立 PostgreSQL 表与哈希、run、语义检索索引。
3. 实现幂等写入、哈希匹配、详情与语义反查 API。
4. 将 capability 21 段证据并入 BOM 精读计划，并生成实例级指纹。
5. 用本地 outbox 在视觉完成和父 Agent 收尾两个时机可靠写入 backend。
6. 添加 API、客户端、指纹、outbox 与现有精读链路回归。
