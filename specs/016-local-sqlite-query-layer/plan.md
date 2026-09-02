# 实现计划

1. 开放 Pi 的 xAI/Grok 模型范围并验证 OAuth 模型目录。
2. 删除旧业务需求/CAD SQLite，不迁移任何历史记录。
3. 清理 PostgreSQL `ontology` schema 和 Alembic 标记。
4. 实现单文件 SQLite 拓扑语义仓储，并保持现有 HTTP 契约。
5. FastAPI 默认注入 SQLite，启动与就绪检查移除 PostgreSQL。
6. 同步 README、规格、测试与环境变量键。
