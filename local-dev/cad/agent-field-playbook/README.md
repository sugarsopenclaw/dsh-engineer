# CAD 现场算法手册

这里记录“Agent 面对新 DWG，如何安全地现场写小段代码验证问题”，不存行业规范，也不把七图规律冒充标准。

## 固定工作法

1. 先查 THCAD 能力总索引，区分“字段已保存、API 元数据存在、运行时可达、业务语义已验证”。
2. 宿主调用写 Adapter，坐标/拓扑判断写 Core；源 DWG 只读，修补只发生在派生事实。
3. 先做能推翻假设的最小合成样例，再跑最小实图、单张大图，最后才批量。
4. 每层保存可重放事实、阶段耗时、预算、诊断和算法版本；下游尽量脱离 CAD 重放。
5. `computed / ambiguous / unsupported_partial` 都是数据。运行结束不等于结论正确，预算截断也不能用于“未发现问题”。
6. 现场代码必须有输入上限、候选上限、稳定 ID、证据回链和停止条件；不能靠无限两两比较碰运气。
7. THCAD 崩溃后不自动重启、不碰另一个 CAD；先查事件日志，再用单图命令验证修复。

新记录保持简短：写清假设、反例、最终规则、可重放入口和仍未验证的边界。

## 记录索引

- [`2026-08-29-11-12-block-and-topology.md`](2026-08-29-11-12-block-and-topology.md)：块 occurrence、容差、空间索引、Euler 对账和原生 wrapper 生命周期。
- [`2026-08-29-13-14-view-and-correspondence.md`](2026-08-29-13-14-view-and-correspondence.md)：纸张骨架误粘连、局部 scope、重复几何与对象身份边界。
- [`2026-08-29-15-identity-resolution.md`](2026-08-29-15-identity-resolution.md)：身份边分层、传递硬约束、表格挂接与保守对象聚类。
- [`2026-08-29-16-manufacturing-profiles.md`](2026-08-29-16-manufacturing-profiles.md)：轮廓/孔槽候选、旋转形状、重复间距和几何语义防越权。
- [`2026-08-29-17-interface-adjacency.md`](2026-08-29-17-interface-adjacency.md)：接口/邻接证据分级、直接嵌套同轴、端点近接与视图尺度容差。
- [`2026-08-29-18-dimension-geometry-binding.md`](2026-08-29-18-dimension-geometry-binding.md)：尺寸实例坐标展开、结构锚定、显示文字口径、`DIMLFAC` 与重复比例证据。
- [`2026-08-29-19-semantic-drawing-diff.md`](2026-08-29-19-semantic-drawing-diff.md)：跨版本身份门、平移配准、稳定/回退匹配、多解和截断安全边界。
