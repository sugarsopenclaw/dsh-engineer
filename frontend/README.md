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

- 业务需求图谱只调用 `GET /api/v1/business-requirements/graph?dimensions=2|3` 与 `GET /api/v1/business-requirements/{requirement_id}`；契约见 `docs/backend/business-requirements-graph-api.md`。
- CAD 能力原子的列表/详情/facets 走 `GET /api/v1/cad-capabilities/atoms`、`/atoms/{atom_id}`、`/facets`；整批加载走 `GET /api/v1/cad-capabilities/graph-atoms`（NDJSON 流、最小投影、ETag/304、路由级 gzip）；契约见 `docs/backend/cad-capabilities-api.md`。默认 v2 有 334,049 个 THCAD/AutoCAD 独立原子，禁止用 200 条分页循环整批拉；面板支持按技术面、宿主或任意筛选组合**整批加载**（`src/graph/capabilityBulk.ts`：一次 fetch 流式解析、可取消、按 `atom_id` 去重，上限 30,000 是前端渲染预算），也可以逐个加入。后端使用预生成的 gzip 分片；AutoCAD `.NET` 26,778 条实测冷请求 59.6s、热请求 2.46s，ETag 命中返回 304。数值是当前环境验收结果，不得硬编码进 UI。
- 两类节点共享同一个 `GraphCanvas` 与同一份运行时图模型（`src/graph/runtime.ts` 的 `nodeKind` 判别联合）；后端尚未提供需求 → 能力原子的正式关系，前端不伪造跨层连线，`RuntimeGraph.links` 保持开放字符串类型以接收未来的跨层边。
- 需求节点坐标完全来自后端 `position.x/y/z`（`initial-semantic-v1` 语义布局：越靠近原点越贴近客户原始需求），`position.locked=true` 时设置 `fx/fy/fz`；前端不做力导向重排（`cooldownTicks=0`）。能力原子暂存区坐标由 `src/graph/capabilityLayout.ts` 确定性生成，无业务含义。
- API DTO（`src/api/types.ts`）与图库运行时对象（`src/graph/runtime.ts`）分离，经 `src/graph/adapt.ts` 单向适配，避免图库 mutate 污染缓存。
- 生产运行时不使用 mock、示例 JSON 或失败兜底假数据；接口失败只展示真实错误。
- 详情（含客户原文 `verbatim_text`）只在点击节点后请求，不写入 URL 或浏览器持久存储；唯一持久化的键是明暗模式偏好。
- 环境变量只读仓库根 `.env`（`vite.config.ts` 的 `envDir`），浏览器可见的键必须是 `VITE_*`。
