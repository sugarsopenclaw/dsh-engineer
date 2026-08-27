# 07 · 中心线与中心几何识别

本能力仍属于一个 07，核心分成两个低耦合源文件：

- `CenterlineIdentifier.cs`：文字正查、样式倒查、图元去重、直线角度与查询 API；
- `CenterlineShapeClassifier.cs`：中心路径组装、形态分类、几何求交和交点邻域窗口。

Core 不引用 THCAD、Teigha、BricsCAD、COM、文件系统或 JSON，也不会修改图纸。

## 识别范围

中心线不再等同于一根直线。当前接收这些二维中心几何：

- `Line`：直线中心轴；
- `Arc`：圆弧中心路径；
- `Circle`：圆形分布基准；
- `Polyline`：折线、U 形或闭合中心路径，支持 bulge 圆弧段；
- `Spline`：样条中心路径。

`BlockReference` 即使使用中心线样式，也不是一条可直接求交的几何。块内图元已在块定义空间单独抽取，因此不把块参照本身重复计数。

## 两条发现路径，一个并集

- `FindByText(...)`：从“XX中心线”TH Leader 正向查找。以 Leader 第一个顶点为指向点，在同一坐标空间中寻找最近的 Line、Arc、Circle、Polyline 或 Spline。
- `FindByStyle(...)`：从几何反向查找。实体线型包含 `CENTER`、所属图层线型包含 `CENTER`，或图层名包含“中心线”，任一满足就识别。
- `Identify(...)`：按 `owner_scope + owner_block_name + handle` 求并集；同一图元被两路命中时只输出一次，并保留两种来源。

模型空间、块定义局部空间、图纸空间和外参空间不混算。

## 直线方向

每条中心 Line 都保留 `[0, 180)` 内的精确 `orientation_degrees`，并按与坐标轴的夹角分类：

- `horizontal`：接近 0°/180°；
- `vertical`：接近 90°；
- `angled`：其余带角度直线。

当前轴向容差为 0.5°，集中在 `CenterlineIdentificationConfig.DirectionAxisToleranceDegrees`。角度值不会因分类而被舍入。直线继续提供 `SignedDistance(...)` 和 `ReflectPoint(...)`。

## 中心形态

`CenterlineShapeClassifier` 在同一坐标空间内，按端点重合与切向连续把 Line/Arc 组装为中心路径，并输出：

- `straight_axis` / `straight_axis_chain`：单根或共线连续直轴；
- `arc_path`：独立圆弧，并区分 90°、180°、270°和自由角；
- `rounded_bend_path`：Line + Arc 等组成的圆角弯曲路径；
- `composite_center_path` / `circular_arc_chain`：更一般的组合路径；
- `circular_reference`：完整圆形基准；
- `u_polyline_path`：三段或带收口段的 U/回转折线路径；
- `closed_polyline_path` / `polyline_path`；
- `spline_path`。

每个形态保留源图元句柄、所属坐标空间、开闭状态、路径长度、转角，以及适用时的圆心、半径和圆弧角。

这只是可验证的几何形态。只有以后再结合孔中心等距分布、两侧等距轮廓等上下文，才进一步命名为“螺栓孔分布圆”“弯管中心路径”等业务角色。

## 交点与“附近小世界”

中心几何在同一坐标空间内两两求交，支持：

- Line × Line；
- Line × Arc/Circle；
- Arc/Circle × Arc/Circle；
- Polyline 的直线段和 bulge 圆弧段与以上几何求交。

相距 0.01 图纸单位以内的计算结果合并为一个交点，避免三根或更多中心线在同一点汇合时重复输出。每个 `CenterlineIntersection` 保留：

- 精确二维坐标和所属坐标空间；
- 参与图元句柄与几何类型；
- 相交角度；
- `crossing`、`multiway`、`tangent`、`corner_join` 或 `tangent_join` 类型。

`Around(halfWidth, halfHeight)` 可从交点直接生成同一坐标空间内的局部包围盒；`FindIntersectionsNear(...)` 可按位置与半径查询视觉锚点。以后只需把包围盒交给实体归属或渲染工具，就能取出交点附近的“小世界”，不必重新计算中心线。

## 七图回归

七张现有样图共识别 3,848 个有效中心几何：

- Line 3,627；Arc 68；Circle 112；Polyline 40；Spline 1；
- 直线中水平 1,243、竖直 1,641、带角度 743；
- 原始样式命中中另有 4 条零长度 Line，因没有轴方向而排除；
- 另有 9 个中心线样式 BlockReference，因不是几何图元而不重复计数；
- 29 个“XX中心线”标注中 19 个直接落到中心几何，均与样式倒查去重。

形态组装得到 3,412 个结果，其中包括：

- 112 个完整圆形基准；
- 26 个 U 形 Polyline 路径；
- 14 个圆角弯曲路径；
- 44 个独立圆弧路径；
- 281 个连续直轴链。

交点去重后得到 2,059 个视觉锚点，其中 `multiway` 783 个、普通 `crossing` 1,127 个，其余为端点转角或相切连接。

当前截图中的既有关系保持不变：

- `器身中心线` Leader `37783` → Line `4B297`；
- `油箱中心线` Leader `377B2` → Line `36AA8`；
- 两条线都同时由文字与样式命中，Y 方向相距 30。

这些数字只用于七张样图的回归，不代表其他项目也采用相同画法。

## 输出与测试

THCAD Adapter 整图抽取时仍统一写：

- `centerline-identification.json`：全部中心几何、角度、形态、交点和查询所需坐标；
- `centerline-identification.md`：同一结果的 LLM 友好视图。

离线回归：

```powershell
& .\local-dev\cad\core\07-centerline-identification\test-centerline-identifier.ps1
```

## 当前边界

- “中心线”和 `CENTER*` 来自当前样图，仍是可配置发现信号，不是所有 CAD 的完整命名字典。
- 图层名含“中心线”但线型不同的几何仍会纳入；这是名称反查。
- `ByLayer` 可解析为图层线型；`ByBlock` 的最终显示样式可能依赖具体块参照。
- 块定义结果使用块局部坐标；转换到每个 BlockReference 的世界坐标留给独立的块实例变换能力。
- 当前求交使用同一 owner 空间的二维 XY 投影；七图均为机械二维图。不同 Z 高程或非 +Z 法向的三维图纸需要扩展。
- Spline 现有抽取只保存控制点，不能据此给出精确样条交点，因此 Spline 会分类和计长，但暂不参加交点计算。
- 当前文字正查处理 TH Leader 自身 `custom.explode` 中的文字及第一个顶点；独立文字与独立引线需要新样图后补充。

后续函数工具可以直接包装 `Identify`、`FindByLabel`、`FindInCoordinateSpace`、`FindShapesByType`、`FindIntersectionsNear`、`CenterlineIntersection.Around`、`SignedDistance`、`ReflectPoint`、`RadialDistance` 和 `PolarAngleDegrees`，无需复制算法。
