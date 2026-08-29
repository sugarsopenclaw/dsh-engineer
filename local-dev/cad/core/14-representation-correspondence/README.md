# 14 · 表达对应关系

14 在 13 的工程视图 scope 之间建立两类可复核关系：重复几何/同型候选，以及正投影视图候选。它不把“长得一样”或“投影对齐”直接解释成同一个业务对象。

## 两条独立证据链

### 重复几何

- 从区域的边长分布、顶点径向分布、度数直方图及点/边/面计数生成平移、旋转、镜像、等比例缩放不变的拓扑签名；
- 完全同签名形成 `repeated_geometry_candidate` 和重复族；高相似但不同签名只形成 `similar_geometry_candidate / ambiguous`；
- 语义上最多是 `same_type_candidate_only`，不能据此断言是同一对象、同一序号或同一 BOM 行。

### 正投影对应

- 左右排布的区域比较世界 Y 特征站位，上下排布的区域比较世界 X 特征站位；
- 特征站位来自拐角、端点、T 接点和分支点，保留两侧源 vertex ID；
- 同时记录站位覆盖率、容差、跨轴重叠、中心残差和范围残差；只有全部满足阈值才给 `supported_geometry_relation`；
- 即使强对齐，也只输出 `same_object_possible / possible_not_proven`。视向、构件名和对象身份要由剖视符号、文字、BOM、投影线或其他独立证据补强。

## 运行回归

```powershell
powershell -ExecutionPolicy Bypass -File .\local-dev\cad\core\14-representation-correspondence\test-representation-correspondence.ps1
```

合成回归包含左右正投影、旋转后的同拓扑视图和空间错位反例，并断言没有任何关系输出 `same_object_supported`。

