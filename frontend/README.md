# frontend/ — 沈变业务需求图谱前端

产品 Web 前端。只通过 `backend/` 的 `/api/v1` 契约读取业务数据，不直连数据库、不读取 `client-data/`。

## 技术栈

Vite + React 18 + TypeScript + pnpm；图谱渲染用 `react-force-graph-2d` / `react-force-graph-3d`，服务端状态用 `@tanstack/react-query`。

## 日常命令

```powershell
cd frontend
pnpm install
pnpm dev        # 开发服务器，/api 代理到 http://127.0.0.1:8000
pnpm lint
pnpm test --run
pnpm build
```

联调前先用仓库根目录 `start-backend.cmd` 启动 FastAPI（PostgreSQL 需在 `.env` 指向的地址可用）。

## 约定

- 只调用 `GET /api/v1/business-requirements/graph?dimensions=2|3` 与 `GET /api/v1/business-requirements/{requirement_id}`；契约见 `docs/backend/business-requirements-graph-api.md`。
- 节点坐标完全来自后端 `position.x/y/z`（`initial-semantic-v1` 语义布局：越靠近原点越贴近客户原始需求），`position.locked=true` 时设置 `fx/fy/fz`；前端不做力导向重排（`cooldownTicks=0`）。
- API DTO（`src/api/types.ts`）与图库运行时对象（`src/graph/runtime.ts`）分离，经 `src/graph/adapt.ts` 单向适配，避免图库 mutate 污染缓存。
- 生产运行时不使用 mock、示例 JSON 或失败兜底假数据；接口失败只展示真实错误。
- 详情（含客户原文 `verbatim_text`）只在点击节点后请求，不写入 URL 或浏览器持久存储。
- 环境变量只读仓库根 `.env`（`vite.config.ts` 的 `envDir`），浏览器可见的键必须是 `VITE_*`。
