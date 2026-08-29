# 11 · 块实例与统一坐标事实层

`BlockInstanceCoordinateAnalyzer.cs` 是宿主无关 Core。它不炸开块、不修改 DWG，而是把块定义中的源实体和模型/图纸空间里真正显示的 occurrence 分开：同一源实体可由多个稳定 `instance_path` 指向，每个 occurrence 都保留世界变换、世界坐标几何、有效图层/颜色/线型/线宽及源句柄。

## 为什么必须独立成一层

01/10 遍历的是数据库所有 `BlockTableRecord`，块定义坐标不是最终显示坐标；七图中又实际存在 7,765 个镜像 occurrence，以及大量块内 0 层和 `ByBlock` 实体。如果直接拿块定义名义坐标或白色样式做拓扑，会把镜像、平移、重复实例和最终显示样式全部混错。11 因此成为 12 及以后几何能力的统一事实入口，10 本身的定义空间分析仍原样保留。

## 输入与算法契约

- Adapter 先登记全部 definition、根模型/图纸空间、图层样式和 definition 内实体；BlockReference 只保存目标 definition、局部仿射变换及 MINSERT 行列参数。
- THCAD `Matrix3d` 不按 `ToArray()` 猜行列顺序，而是实际变换原点和 X/Y/Z 三个单位基点，再组装宿主无关的 3×4 仿射矩阵。
- 组合固定采用列向量 `world = parent × local × point`；MINSERT 行列偏移先在块局部坐标生成，再进入父变换，因此镜像后的阵列方向也可追溯。
- 实例遍历带 definition 栈、最大深度和 occurrence 总量上限；循环引用、目标 definition 缺失、未加载外参等成为诊断，不递归失控。
- 动态块同时记录当前有效匿名 definition 和 authoring definition；外参记录来源边界；不把二者悄悄降成普通静态块。

## 有效样式

样式沿实例路径逐级求值：

- 块内 `Layer=0` 继承当前插入 occurrence 的有效图层；
- `ByBlock` 颜色、线型和线宽继承当前插入 occurrence 的有效样式；
- `ByLayer` 在完成 0 层替换后查最终图层定义；
- 显式覆盖保持显式值；关闭/冻结图层在 occurrence 上标记为显示抑制。

每个结果都保存 `*_source`，例如 `ByBlock_from_insert`、`ByLayer:layer0_inherits_insert_layer`，使下游模型不仅看到值，也看到值从哪里来。

## 几何质量

- Line、无 bulge 的 2D/3D Polyline 保留精确折线节点；
- bulge、Arc、Circle、Ellipse 按参数/弦误差目标离散；Spline 按控制点规模自适应采样；
- 每个 occurrence 明确输出 `geometry_quality`，12 不会把采样折线冒充解析曲线；
- 世界坐标路径保留 Z，12 是否接受其二维投影由独立平面容差决定。

## 产物与回归

THCAD 整图抽取新增 `block-instance-coordinate-facts.json/.md`，并在报告中给出 occurrence、曲线 occurrence、镜像、动态块、外参和诊断计数。完整大对象只写独立 artifact，`semantic-objects.json` 只放摘要和文件名，避免重复数十 MB。

合成回归覆盖镜像 2×2 MINSERT、0 层/ByBlock 继承、稳定实例路径和循环 definition。首轮七图旁数据库回归完成 91,605 个原始实体，得到 65,791 个 occurrence、59,645 个曲线 occurrence、7,765 个镜像 occurrence，11 诊断为 0；七图没有 MINSERT/动态块，因此这两项仍以合成回归为准。

运行：

```powershell
.\local-dev\cad\core\11-block-instance-coordinate-facts\test-block-instance-coordinate-facts.ps1
```
