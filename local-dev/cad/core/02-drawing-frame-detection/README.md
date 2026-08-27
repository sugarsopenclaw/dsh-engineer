# 02 · 图框检测

核心实现只有一个源文件：`DrawingFrameDetector.cs`。

它只依赖 .NET Framework 基础类型，命名空间为 `Shb.Cad.Core`，不引用 THCAD、Teigha、BricsCAD、COM、文件系统或 JSON 解析器。

当前默认检测 `图框层`。七张沈变图中，这一矩形实际是绘图区内框，不是物理纸张的最外边框；分区字母数字位于它与外边框之间。结果字段 `is_outermost` 只表示“未被同一配置图层上的其他候选包含”。

## 输入与输出

- 输入：`DrawingFrameSegment` 列表，字段只有句柄、图层、起点和终点。
- 输出：全部矩形候选、最外层候选、四条边的句柄证据，以及过滤和拒绝计数。
- 配置：候选图层、坐标容差、轴对齐容差、最小宽高。

## 当前 v1 边界

- 识别指定图层上的水平/垂直 Line；
- 每条边目前必须由一根 Line 覆盖；
- 支持多个并列图框和嵌套矩形，并标出最外层图框；
- 暂不拼接分段边，不处理旋转框、Polyline 或块定义内部的框。

这些限制会出现在检测结果的 `limits` 中，不会被静默隐藏。

## 回归测试

从仓库根目录运行：

```powershell
& .\local-dev\cad\core\02-drawing-frame-detection\test-drawing-frame-detector.ps1
```

测试直接编译同一份 Core 源码，并使用七张既有抽取数据及多图框、嵌套、噪声、错层和分段边合成用例。
