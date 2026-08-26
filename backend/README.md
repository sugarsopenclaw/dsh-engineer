# shenbian-api

沈变工程图纸 Ontology 与审查任务后端。该服务位于应用服务层，读取根目录 `ontology/` 类型契约和 `data/catalog/` 数据登记；它不会直接扫描或修改 `client-data/`。

## 启动

后端只读取仓库根目录 `.env`，不要在本目录创建第二份环境文件。

```powershell
cd backend
uv sync
uv run shenbian-api
```

默认监听 `127.0.0.1:8000`。开发时可直接运行：

```powershell
uv run uvicorn shenbian_api.app_factory:create_app --factory --reload
```

主要接口：

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `GET /api/v1/ontology`
- `GET /api/v1/ontology/actions`
- `GET /api/v1/data-catalog`
- `GET /docs`

## 验证

```powershell
uv run pytest
uv run ruff check .
```

架构和数据边界见 [`specs/002-shenbian-ontology-api/`](../specs/002-shenbian-ontology-api/)。
