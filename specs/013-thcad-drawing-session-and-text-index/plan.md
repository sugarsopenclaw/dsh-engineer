# 实施计划

## 分层

1. `text-inventory` adapter 只负责 THCAD/Teigha side-DB 文字读取和 PCCAD 块结构化。
2. V4 Host 负责 CAD 主线程、文档生命周期、操作分类和最终写路径守卫。
3. TypeScript `documents.ts` 与 `text-index.ts` 负责编排、第二层路径守卫、增量物化和有界检索。
4. `thcad-project.ts` 只暴露两个父工具，并在描述中提供“检索→激活→精读”的路由配方。
5. 既有 01–20 Core 与机械/视觉 child 不改变工具面。

## 关键取舍

- 文档生命周期必须使用 Session 命令；当前图分析仍使用 Modal 命令。
- side-DB 一次可扫描多图，大响应不经 stdout 回传。
- 客户原图只读由路径事实决定，不接受模型关闭这一限制。
- 默认 copy 复制磁盘态；捕获 dirty 内存态必须显式 `from_session`。
- 搜索返回裁剪命中，不返回完整 JSONL。
- 原计划中的规格编号 006 已存在，按仓库规则顺延为 013。

## 数据流

```text
DWG → V4 scan_texts → TextInventoryExtractor → TS JSONL/manifest
                                               ↓
用户词 → bounded search → drawing/item numbers → V4 Session activate → BOM close reading
```
