# 18 · 尺寸—几何绑定与量值核对

18 把 09 的线性尺寸拓扑放回 11 的实际块实例坐标，并与 12/13/16/17 的结构几何和对象索引建立可追溯绑定。它回答“尺寸两端靠在哪些图面结构上、量的是哪一类跨度、实体测量值/显示值/结构几何是否一致”，但不把二维近接冒充原生尺寸关联，也不把数值残差直接判成图纸错误。

## 输入与输出

- 输入：09 `DimensionTopologyDocument`、11 `BlockInstanceCoordinateDocument`、12 `PlanarTopologyDocument`、13 `EngineeringViewRegionDocument`、16 `ManufacturingProfileFeatureDocument` 和 17 `MechanicalInterfaceAdjacencyDocument`；
- 实例展开：按 11 的 occurrence 世界变换展开尺寸 `xline1/xline2/dimension_line` 定义点和尺寸轴，保留实例路径、镜像、轴向缩放和源定义；没有可见 occurrence 的块定义尺寸单列为 `unplaced_source_definition`；
- 端点绑定：只索引 13 工程视图区内的 12 顶点/边，以视图尺度容差搜索最近锚点；等距候选、单端绑定、双端未绑定和预算截断都显式输出；
- 几何归属：锚点回链 region、12 edge、16 profile、17 interface feature、15 object cluster、源 occurrence/handle 和几何质量；两端关系区分同接口、同轮廓、同对象、同视图及跨区域候选；
- 量值核对：沿尺寸实例轴投影锚点跨度，先除以实例轴缩放回到源尺寸单位，再分别与实体 `Measurement` 和图面显示值比较；保留残差范围、容差、候选组合数和确定性状态；
- 显示语义：区分无文字覆盖、`<>` 占位、括号参考尺寸、纯数字覆盖、上下界、直径、半径和螺纹代号；显式 `DIMLFAC` 单独保存并用于无覆盖/占位尺寸的显示核对；
- 比例假设：同一工程区域、同一尺寸样式至少三个独立数字覆盖呈稳定非 1 的 `geometry/display` 比例时，生成重复比例候选并回挂支持尺寸。原始超阈值残差仍保留，比例候选不等同于已确认视图比例、单位换算或正确性证明。

整图输出为 `dimension-geometry-binding.json/.md`；JSON 中每条 binding 都可回到尺寸句柄、实例、锚点候选、结构边和上游对象。算法只读，不修改、重关联或删除 DWG 实体。

## 判定边界

`ACAD_DIMASSOC` 对象句柄仅作为作者关联证据保留，18 当前没有解析其内部引用点；几何绑定来自定义点到 12 拓扑的容差近接。因此：

1. `bound_unique` 表示当前候选范围内两端各有唯一结构锚点，不表示已经证明原生 associativity；
2. `within_configured_numeric_tolerance` 是数值筛查通过，不表示公差验收或设计正确；
3. `outside_*_candidate` 是复核入口，不证明尺寸错、几何错或应修改图纸；
4. 16/17 的轮廓、孔槽和接口仍是二维候选，18 的尺寸挂接不会把它们升级为已确认零件特征；
5. 15 只用于对象摘要索引，不跨视图融合几何。

## 回归

```powershell
powershell -ExecutionPolicy Bypass -File .\local-dev\cad\core\18-dimension-geometry-binding\test-dimension-geometry-binding.ps1
```

合成回归覆盖唯一/歧义/单端/未绑定、未放置块定义、实例缩放和平移、数字覆盖、括号参考、显式 `DIMLFAC`、重复显示比例及规模截断。

2026-08-29 七张保存事实回归读取 712 个 09 尺寸定义，展开 619 个 occurrence，并明确保留 93 个未放置定义；得到 229 个双端唯一绑定、178 个单端绑定、212 个双端未绑定，当前无等距多解。229 个唯一绑定可作量值核对，75 个显示值为原始超阈值候选；其中 23 个由 8 组至少三条尺寸支持的重复比例候选解释，52 个仍保留为未解释候选。例：最小图句柄 `E80` 的实体测量值约 `407.00014`、绑定结构跨度为 `407`、图面数字覆盖为 `427`，输出为同对象内轮廓跨度及 `-20` 显示残差候选，而不是自动报错。该回归只验证保存事实上的 Core；最新 Adapter 的 `DIMLFAC` 读取已编译，但尚未热加载到当前 THCAD 进程。
