# 10 · 工程图线语义与轮廓拓扑

`EngineeringLineSemanticAnalyzer.cs` 是宿主无关 Core。THCAD Adapter 只负责提供每个实体的原始样式、图层样式、线型定义、二维几何和 07–09 的既有证据；算法不引用 Teigha/BricsCAD，也不修改 DWG。

## 为什么不能把颜色直接当语义

沈变七张回归图中，常见组合确实很稳定：白色连续线多见于轮廓、红色 `CENTER` 多见于中心参考、黄色/品红色 `DASHED` 多见于不可见轮廓、黄色连续线多见于剖面线、青色连续线多见于标注、品红色 `DIVIDE/PHANTOM*` 多见于双点划线。但颜色并不是标准语义本身，也不是全项目不变的枚举：

- `4虚线层` 在六张图为黄色、在一张图为品红色；
- `2细线层` 在六张图为青色、在一张图为绿色；
- 实体可以覆盖图层颜色或线型；
- 块定义中的 `ByBlock`，以及 0 层 `ByLayer`，必须到具体块实例才能得到最终显示样式。

因此 10 采用开放词汇：颜色只参与样式画像，不单独宣布业务含义；任何新颜色、新线型、新组合都会原样进入 `color_usage`、`linetype_catalog`、`style_profiles`，不能归入已知角色的组合还会进入 `unresolved_style_profiles`，供后续样本分析。

## 输入与有效样式

每个实体输入保留：

- 原始颜色索引、颜色方法、ByLayer/ByBlock、可取得时的 RGB；
- 原始线型和线宽；
- 图层颜色、线型和线宽；
- Line、Arc、Circle、Ellipse、Polyline、Spline 的几何、包围盒及所属坐标空间；
- 08 的标注候选句柄、07 的中心几何句柄和具名直线参考轴；
- 09 共基准尺寸剖面得到的恒定中点偏置，作为平行候选轴，不作为既定对称轴。

有效样式按实体覆盖、ByLayer、ByBlock 三种路径解析。ByBlock 和块定义 0 层继承标为 `requires_block_instance`，不拿块定义里的名义白色冒充最终实例颜色。

线型先保留图中定义的 `pattern_length` 与全部 `dash_lengths`，再按实际虚实节奏归一为：

- `continuous`：连续线；
- `dashed`：单一画段循环；
- `center_chain`：长画段 + 一个短画段/点；
- `double_chain`：长画段 + 两个短画段/点；
- `other`：现有证据不能稳定归类，保留等待新分析。

名称中的 `CENTER/DASHED/HIDDEN/DIVIDE/PHANTOM` 是兼容信号；陌生名称只要原始 dash pattern 足够明确，也能按节奏归类。名称和节奏都不明确时不会猜。

## 输出能力

第一版给出四层数据：

1. **全量样式画像**：每种有效图层 × 颜色 × 线型族 × 线宽 × 实体类型 × 候选角色的计数、样本句柄和解析状态；未知组合完整保留。
2. **图线角色候选**：标注几何、中心参考、双点划参考、不可见轮廓、剖面线、可见轮廓、细辅助线，以及没有业务图层信号的连续几何候选；出现多重信号时保留全部候选并按公开优先级给出主角色。
3. **轮廓拓扑**：在相同 `owner_scope + owner_block_name + role` 中按端点容差建立节点、连通分量、开口数、分支数和闭合轮廓候选；标注几何不进入构件轮廓拓扑。
4. **派生关系**：隐线/剖面/双点划线位于最小闭合连续包络内的候选关系、平移重复的拓扑组件，以及具名参考轴和候选平行偏置轴的几何对称覆盖率与残差。

对称判断必须通过几何反射匹配。若具名轴本身覆盖率不足、但 09 的恒定中点偏置或闭合轮廓中心产生的平行轴通过，则输出 `symmetric_about_parallel_offset_axis`、有符号法向偏置和来源，而不是把红色中心线直接写成对称轴。

## 整图产物

THCAD 整图抽取新增：

- `engineering-line-semantics.json`：线型目录、颜色使用、样式画像、全部图线、拓扑节点/组件、包含关系、重复模式和参考轴对称评估；
- `engineering-line-semantics.md`：面向人和 LLM 的角色计数、开放词汇和偏置对称摘要；
- `semantic-objects.json.engineering_line_semantics` 与 `extraction-report.json` 中对应统计；
- `tables.json` 的图层新增结构化颜色和线宽，线型新增原始 pattern/dash 数据；`entities.jsonl` 的颜色新增颜色方法与 RGB。

## 证据边界

- exact：DWG 实体/图层样式、原始线型节奏、数据库几何、端点重合；
- derived：候选图线角色、连通分量、闭合轮廓、包络关系、重复拓扑和对称残差；
- not inferred：构件业务名称、仅凭剖面线确定材料、未知双点划线的具体业务用途、设计意图和应否删改。

当前拓扑按二维 XY 且不展开块实例变换；块定义与模型空间绝不混算。Polyline 的 bulge 段长度/边界和 Spline 当前使用近似，输出会标明几何质量。线段中途相交但没有共同端点，第一版不建立节点。以后出现新颜色或新线型时，应先观察 `unresolved_style_profiles` 和原始 pattern，再补独立回归，不修改旧证据。

运行回归：

```powershell
.\local-dev\cad\core\10-engineering-line-semantics\test-engineering-line-semantics.ps1
```

回归覆盖重复闭环、包络内隐线、标注排除、未知 RGB、未知线型、按 dash pattern 识别陌生双点划线、块内 0 层继承和 `+10` 偏置对称；若本机保留七张 THCAD 抽取，还会核对其中允许变化的颜色组合。
