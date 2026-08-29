# 本地 CAD 能力清单

依赖方向固定为：

```text
PowerShell COM 触发 / CAD 命令
              ↓
       THCAD .NET Adapter
              ↓
        宿主无关 Core
```

反方向依赖禁止。例如图框算法不能调用 THCAD；THCAD Adapter 可以把 `Line` 转成图框算法需要的普通坐标数据。

## 开发前先查能力总索引

- [`THCAD V24 能力面总索引`](../../docs/dev/2026-08-27-THCAD-V24-能力面总索引.md) 统一链接字段、公开 .NET、COM Automation、LISP/命令和原生 BRX/ARX 五个能力面；
- [`docs/thcad-extract-fields/`](../../docs/thcad-extract-fields/) 是当前抽取 JSON 的键级库存，回答“已经保存了什么”；
- [`THCAD V24 .NET 公开能力盘点`](../../docs/dev/2026-08-27-THCAD-V24-DotNet公开能力盘点.md) 是公开方法、属性、事件和构造能力的库存，回答“宿主还允许主动调用什么”。其中包含读取、计算、创建、修改、删除、变换、保存和编辑器交互，不做只读阉割。

JSON 或某一个 API 面没有某项，不等于 THCAD 拿不到它；先查总索引，再在具体入口和 `runtime_class` 上实测是否可用。需要宿主 API 的调用放在 THCAD Adapter/Host，能由普通坐标和语义数据完成的判断继续留在宿主无关 Core。

## 01 · 全量实体抽取

- 类型：THCAD .NET Adapter，不是假装成纯算法。
- 唯一实现：[`adapters/thcad/01-full-entity-extraction/DrawingExtractor.cs`](adapters/thcad/01-full-entity-extraction/DrawingExtractor.cs)
- 能力：整图、旁数据库批量、当前框选集复用同一实体序列化路径。
- 数据访问：进程内 THCAD/Teigha .NET API；TH 专业对象补充使用只读反射。
- COM 的作用仅是连接已启动的 THCAD 并发送命令，不读取实体内部数据。

当前框选抓取算 01 的一种输入方式，不另算一个识别算法。`Commands.cs` 和 COM 脚本仍属于 `dev-test` 的 Host/Automation 层。

## 02 · 图框检测

- 类型：宿主无关 Core 算法。
- 唯一实现：[`core/02-drawing-frame-detection/DrawingFrameDetector.cs`](core/02-drawing-frame-detection/DrawingFrameDetector.cs)
- 输入：普通线段的句柄、图层和二维端点。
- 输出：候选矩形、最外层图框、四边证据和诊断计数。
- THCAD 只是输入适配器；同一算法也可以直接处理既有 JSON 或以后其他 CAD 的数据。

当前默认图层 `图框层` 上的矩形是绘图区内框。物理纸张最外边框位于它外侧，字母数字分区带夹在两者之间；02 结果中的“最外层”仅表示配置图层候选之间的包含关系。

## 03 · 图框分区检测

- 类型：宿主无关 Core 算法。
- 唯一实现：[`core/03-drawing-zone-detection/DrawingZoneDetector.cs`](core/03-drawing-zone-detection/DrawingZoneDetector.cs)
- 输入：绘图区内框和模型空间文字的有效对齐锚点。
- 输出：行列分区及证据，并可把点或实体包围盒定位为 `A16`、`B3` 等区域。
- 七张图已识别 1040 个分区，166 条推算边界均与真实短分隔线吻合。

## 04 · 机械明细表知识化

- 类型：宿主无关 Core 算法。
- 唯一实现：[`core/04-mechanical-bom-knowledge/MechanicalBomKnowledgeBuilder.cs`](core/04-mechanical-bom-knowledge/MechanicalBomKnowledgeBuilder.cs)
- 输入：`PC_MXB_BLOCK` 行块的八个命名属性及句柄、坐标、包围盒、`TH_XUHAO` 证据，以及 `PC_BOMXHRELATEDIC` 的序号标注关系。
- 输出：固定列定义、结构化行、原始值与安全解析值、证据链、每行对应的零个/一个/多个图面序号标注（含可取得时的指向侧与序号侧坐标），以及缺号/重号/缺列等质量报告。
- 七张图已验证五张正式明细表、208 行，全部八字段齐全且序号与 `TH_XUHAO` 一致；174 条字典关系中 147 条附加到同图明细行，覆盖 136 行。
- 原生块属性是主路径；晓量式线网/DCEL 表格拓扑只保留为以后处理炸开表格的降级方向。

## 05 · 技术要求提取

- 类型：宿主无关 Core 算法。
- 唯一实现：[`core/05-technical-requirements-extraction/TechnicalRequirementsExtractor.cs`](core/05-technical-requirements-extraction/TechnicalRequirementsExtractor.cs)
- 输入：绘图区内框，以及模型空间文字的内容、图层、句柄和包围盒。
- 输出：标题、编号条目、续行合并、来源证据及缺号/重号诊断；同时渲染面向 LLM 的 Markdown。
- 七张图已验证 6 段、54 条、5 个续行；上节油箱缺号 6 会报告但不会导致提取失败。

## 06 · 图层分析

- 类型：宿主无关 Core 分析与查询能力。
- 唯一实现：[`core/06-layer-analysis/CadLayerAnalyzer.cs`](core/06-layer-analysis/CadLayerAnalyzer.cs)
- 输入：图层定义，以及实体的图层、所属空间、类型、可见属性和块参照目标。
- 输出：图层清单、使用情况、模型空间/块定义分账、类型分布、当前显示抑制和引用完整性。
- 提供按名称找图层、按图层与所属空间查实体句柄的函数；实际修改图层开关仍留给以后独立的 THCAD Adapter 工具。
- 七图已核对 91,605 个实体，图层引用全部完整；`消隐层` 关闭共影响 162 个模型空间实体。

## 07 · 中心线与中心几何识别

- 类型：宿主无关 Core 识别、查询与几何函数能力。
- 实现：[`core/07-centerline-identification/CenterlineIdentifier.cs`](core/07-centerline-identification/CenterlineIdentifier.cs) 负责发现与查询，[`CenterlineShapeClassifier.cs`](core/07-centerline-identification/CenterlineShapeClassifier.cs) 负责形态组装与求交。
- 文字正查和中心线层/`CENTER*` 样式倒查共同处理 Line、Arc、Circle、Polyline、Spline，再按坐标空间 + 句柄求并集。
- Line 保留精确角度并分为水平、竖直、斜向；Line/Arc 可按端点与切向组装，Polyline 可识别 U 形，Circle 保留圆心半径。
- 任意支持的中心几何在同一坐标空间内求交；同一点多路结果合并为视觉锚点，保留参与句柄、相交角，并可生成交点附近局部窗口。
- 七图识别 3,848 个有效中心几何（其中斜向 Line 743），组装 3,412 个形态，得到 2,059 个去重交点；详细边界见 07 README。

## 08 · 全图标注识别

- 类型：宿主无关 Core 分类与组合识别能力。
- 唯一实现：[`core/08-annotation-identification/AnnotationIdentifier.cs`](core/08-annotation-identification/AnnotationIdentifier.cs)。
- 输入：标准尺寸/引线、天河序号/文字引线/粗糙度/基准/箭头实体，以及普通 Line、Solid、Text 的类型、文字、包围盒、几何点和所属空间。
- 输出：标注分类、显示文字、测量值与尺寸定义点、方向、证据、源句柄和成组移除候选句柄；只识别，不修改 DWG。
- 04 的序号和 07 的中心线文字允许在 08 中重复出现；七图回归得到 1,203 条确定性标注和 7 个字母方向标记，P/Q 只保留为业务含义未解析的几何拓扑。

## 09 · 尺寸拓扑与尺寸链分析

- 类型：宿主无关 Core 几何拓扑与确定性派生能力。
- 唯一实现：[`core/09-dimension-topology/DimensionTopologyAnalyzer.cs`](core/09-dimension-topology/DimensionTopologyAnalyzer.cs)。
- 输入：08 已取得的线性尺寸测量值与 `xline1/xline2/dimension_line` 定义点，以及 07 已确认的具名直线参考轴。
- 输出：尺寸站位图、连续尺寸链、共基准剖面、嵌套包络、数值闭合式、派生差值和相对参考轴的中点偏置；只给证据与残差，不把具名中心线擅自判为对称轴。
- 截图样图验证三条连续链、`825 + 885 = 1710`，并识别三层包络相对“器身中心线”恒定偏置 `+30`；另有 45° 尺寸链与远距离同站位反例回归。

## 10 · 工程图线语义与轮廓拓扑

- 类型：宿主无关 Core 样式解析、几何拓扑与开放词汇分析能力。
- 唯一实现：[`core/10-engineering-line-semantics/EngineeringLineSemanticAnalyzer.cs`](core/10-engineering-line-semantics/EngineeringLineSemanticAnalyzer.cs)。
- 输入：每个实体及图层的颜色/线型/线宽、线型原始 dash pattern、二维曲线几何，以及 07 中心参考、08 标注句柄和 09 参考轴偏置证据。
- 输出：不丢未知颜色或线型的样式画像、图线角色候选、端点连通与闭环、连续包络内关系、重复拓扑及具名轴/平行偏置轴的对称覆盖率和残差；颜色只作证据，不直接等同业务语义。
- 七图已验证同名层也存在颜色变体（`4虚线层` 黄/品红、`2细线层` 青/绿），因此采用开放词汇；块内 0 层和 `ByBlock` 保留为需实例解析，第一版不跨坐标空间或自动展开块实例。

## 11 · 块实例与统一坐标事实

- 类型：宿主无关 Core 的 definition/occurrence 解析与坐标、样式事实层。
- 唯一实现：[`core/11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs`](core/11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs)。
- 输入：全部块定义、根模型/图纸空间、BlockReference 基向量变换、MINSERT 参数、图层与实体原始样式，以及 10 的角色证据。
- 输出：稳定实例路径、源 definition/实体句柄、组合世界变换、世界坐标路径、镜像/动态块/外参状态，以及完成 0 层和 `ByBlock` 逐级继承后的有效样式；不炸块、不改图。
- 首轮七图得到 65,791 个 occurrence、59,645 个曲线 occurrence 和 7,765 个镜像 occurrence，实例遍历诊断为 0；MINSERT/动态块当前只由合成回归覆盖。

## 12 · 切节点平面拓扑

- 类型：宿主无关 Core 的吸附计划、全交点切分、固定网格 arrangement 与 DCEL 面拓扑。
- 唯一实现：[`core/12-planar-topology-kernel/PlanarTopologyAnalyzer.cs`](core/12-planar-topology-kernel/PlanarTopologyAnalyzer.cs)。
- 输入：11 的世界坐标曲线 occurrence；默认排除标注、中心/双点划参考和剖面填充角色，并显式门控非平面曲线。
- 输出：非破坏吸附证据、真交点/共线重叠切分、带全部源支持的规范边、点度数与连通分量、halfedge/twin/next、环、孔洞、有界面面积，以及严格 Euler 与未成面环秩对账等六项校验。
- `computed / ambiguous / unsupported_partial` 都是有效状态；退化环、未成面环秩、预算截断和源几何近似必须暴露，不能为了闭合率伪造拓扑。真实回归的当前完成边界与一次 THCAD 原生终结器崩溃修复见 12 README，尚不宣称最终七图全绿。

## 13 · 工程视图与局部区域

- 类型：宿主无关 Core 的图纸 scope 分解与局部坐标能力。
- 唯一实现：[`core/13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs`](core/13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs)。
- 输入：11 occurrence、12 点边面与连通分量，以及可选的 02 图框、全图文字、04 BOM、05 技术要求和标题栏范围。
- 输出：纸张结构、文档区、工程视图候选、小型局部几何和稀疏辅助区；每区保留局部坐标架、尺度及 component/edge/vertex/occurrence/文字/文档证据链。
- 纸张级连通骨架不再把全图粘成一个区域；无原文只输出几何候选，不猜主视图、零件名或视向。七图保存事实回归得到 125 个 scope，其中 76 个视图候选、18 个文档区、7 个纸张结构，eligible occurrence 全部有归属。

## 14 · 表达对应关系

- 类型：宿主无关 Core 的重复几何和正投影视图关系分析。
- 唯一实现：[`core/14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs`](core/14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs)。
- 重复关系使用平移/旋转/镜像/等比例缩放不变的拓扑签名及有界相似度；左右视图比较世界 Y 特征站位，上下视图比较世界 X 特征站位，并保留匹配 vertex、覆盖率、容差与残差。
- 相同几何最多是 `same_type_candidate_only`，强投影最多是 `same_object_possible / possible_not_proven`；没有独立业务证据时绝不合并对象。
- 七图只对 76 个视图候选评估 514 对，留下 6 条相似几何和 13 条投影关系，其中 5 条达到强几何支持；没有触发区域或配对预算。

## 15 · 表示身份解析

- 类型：宿主无关 Core 的证据约束身份图与保守对象聚类。
- 唯一实现：[`core/15-representation-identity-resolution/RepresentationIdentityResolver.cs`](core/15-representation-identity-resolution/RepresentationIdentityResolver.cs)。
- 输入：13 工程表示、14 同型/投影候选，以及可选的独立身份断言和额外物理、表格、类型表示；输出五类边、保守物理对象簇、可能同一对象组、同型组、表格挂接、阻断合并与证据链。
- 只有带独立来源的 `same_object_supported` 能合并；`different_object_proven` 对整个并查集两侧构成硬约束，`same_object_possible` 与 `same_type_only` 永不触发对象合并。单例只表示证据不足，不表示已经证明不同。
- 七图保存事实回归得到 76 个工程表示、11 条身份断言（5 条 `same_object_possible`）、5 个候选组和 76 个保守单例；没有外部强证据，因此合并、阻断和强身份均为 0。

## 16 · 制造轮廓与孔槽候选

- 类型：宿主无关 Core 的视图内轮廓、内嵌边界、重复特征和开放拓扑分析。
- 唯一实现：[`core/16-manufacturing-profile-features/ManufacturingProfileAnalyzer.cs`](core/16-manufacturing-profile-features/ManufacturingProfileAnalyzer.cs)。
- 输入：12 的 DCEL 面/边/分量、13 工程视图区和 15 保守对象簇；输出可回链轮廓形态、共享边/包含关系、重复特征间距、开放链网及不跨视图融合的对象摘要。
- 有界面只称轮廓候选，圆形内嵌边界不直接称孔，共享 DCEL 边不直接称物理接触，开放线网也不自动称缺陷；这些升级必须等待尺寸、剖视、身份或规范证据。
- 七图保存事实回归对 22,162 个输入面逐图守恒，19,259 个归区、2,903 个留空，得到 6,083 个内嵌边界候选（其中圆形 1,909）、1,009 组重复特征、1,535 个开放拓扑候选和 76 个对象摘要。

## 17 · 机械接口与装配邻接候选

- 类型：宿主无关 Core 的接口特征、投影模式和邻接证据图。
- 唯一实现：[`core/17-mechanical-interface-adjacency/MechanicalInterfaceAdjacencyAnalyzer.cs`](core/17-mechanical-interface-adjacency/MechanicalInterfaceAdjacencyAnalyzer.cs)。
- 输入：12/13/15/16；输出内嵌接口特征、直接层级的同轴/方向对齐栈、重复模式、共享边证据、多 occurrence/句柄重合边、开放端到轮廓的间隙及对象簇摘要。
- 二维同心不证明三维同轴或配合，重复不证明螺栓/数量，共边和重合线不证明物理接触，开放端近接也不证明连接或缺陷；所有关系保留残差、容差和来源。
- 七图保存事实回归得到 6,083 个接口特征候选、7,485 个模式记录（含 393 个圆形同轴、1,009 个重复模式）及 31,388 条邻接证据（含 6,305 条多源重合边、66 条开放端近接），按 76 个对象簇建立不融合几何的摘要。

## 18 · 尺寸—几何绑定与量值核对

- 类型：宿主无关 Core 的尺寸实例展开、结构锚定和数值筛查能力。
- 唯一实现：[`core/18-dimension-geometry-binding/DimensionGeometryBindingAnalyzer.cs`](core/18-dimension-geometry-binding/DimensionGeometryBindingAnalyzer.cs)。
- 输入：09/11/12/13/16/17；输出尺寸定义点的世界坐标 occurrence、顶点/边锚点候选、region/profile/interface/object 回链，以及结构跨度对实体测量值和显示值的残差范围。
- 显式 `DIMLFAC` 与重复数字覆盖比例分别建模；数字覆盖、上下界、直径、半径、螺纹和括号参考不会混成一种比较。近接绑定不证明原生关联，残差和重复比例都不证明设计错误、单位换算或应修改图纸。
- 七图保存事实回归处理 712 个尺寸定义和 619 个实例，得到 229 个双端唯一绑定；75 个原始显示超阈值候选中，23 个有 8 组重复比例证据，52 个仍明确留作未解释复核候选。

## 19 · 版本与阶段语义差分

- 类型：宿主无关 Core 的跨版本语义快照、身份门、保守匹配和变化证据分类能力。
- 唯一实现：[`core/19-semantic-drawing-diff/SemanticDrawingDiffAnalyzer.cs`](core/19-semantic-drawing-diff/SemanticDrawingDiffAnalyzer.cs) 与 [`SemanticDrawingSnapshotBuilder.cs`](core/19-semantic-drawing-diff/SemanticDrawingSnapshotBuilder.cs)。
- 输入：04/05/08/11/13/16/17/18 的作者证据与派生事实；输出稳定语义快照、同图身份判断、全局平移、精确/回退匹配、几何/移动/语义/关联/样式变化、新增删除候选、尺寸同步复核、issue 生命周期和差异区域。
- 图纸身份未建立、稳定键重复、空间候选平局、预算或快照截断都会阻止过度结论；新增/删除、同步复核和问题未复现均不是设计意图、漏改或关闭证明。
- 七图保存事实生成 130,732 个快照元素，逐图自差分均为全部元素匹配且变化/新增/删除/多解为 0；七图没有真实修订对，因此这只验证确定性和安全边界，不表示跨版本准确率已经验证。

## 20 · 跨图工程接口与项目关系

- 类型：宿主无关 Core 的多图引用图、跨文件身份和接口签名比较能力。
- 实现：[`core/20-cross-drawing-interface-graph/CrossDrawingProjectInputBuilder.cs`](core/20-cross-drawing-interface-graph/CrossDrawingProjectInputBuilder.cs) 生成单图 observation，[`CrossDrawingInterfaceGraphAnalyzer.cs`](core/20-cross-drawing-interface-graph/CrossDrawingInterfaceGraphAnalyzer.cs) 汇聚项目图。
- 输入：19 图纸身份与语义元素、BOM/文字/外参引用、17 接口形态与模式、18 绑定尺寸及 13 局部坐标；输出 `drawing_ref / component_ref / interface_ref` 节点与关系、`SUPPORTED / POSSIBLE / CONFLICTED / UNRESOLVED` 身份、接口比较及缺图/版本/量值复核候选。
- 只有结构化引用精确命中标题栏才支持构件—图纸身份；接口还要求明确上下文、唯一候选和多项相容签名。纯几何相似、引线近接、未证明比例和缺少目标文件均不会被升级成强结论。
- 七图保存事实得到 179 条有代号构件引用和 13,568 个接口引用；样本集内没有 BOM 代号命中另一张标题栏，因此正确输出 133 个去重的集合缺口候选、0 个接口比较，没有凭相似几何乱连。

## 暂不单独编号

- 框选读取：是 01 的 Host 输入方式，不是业务算法。
- 标题栏收集：目前仍是抽取器里的早期规则，尚未形成稳定、独立的算法契约。

审图方向目前只记观察点，见 [`review-notes.md`](review-notes.md)，暂不设计或实现。
技术要求的位置与排布验证记录见 [`technical-requirements-notes.md`](technical-requirements-notes.md)。
七图的适用边界及各能力硬编码风险统一记录在 [`validation-and-risk-notes.md`](validation-and-risk-notes.md)。
供运行时 Agent 现场写验证代码时使用的简短操作准则和踩坑记录见 [`agent-field-playbook/`](agent-field-playbook/)。

## 规律开发约定

- 七张图只是当前回归样本，不代表全部图纸；“七图通过”不能写成通用标准。
- 每项能力都按“并列发现信号 → 用独立证据验证 → 保留证据后利用”推进。名字可以是信号，但不能成为唯一真相。
- 具体信号、硬编码风险和扩样方式见 [`validation-and-risk-notes.md`](validation-and-risk-notes.md)；新图纸出现后按小模块补回归并迭代。

## 实现心得（先记住，不当硬规则）

- 拓扑、几何、命名属性等算法都是可选手段，应按图纸里实际存在的证据选择；提到一种算法不表示必须使用它。
- 导出结果分两层更合适：JSON 保留无损字段、句柄、坐标和质量诊断，Markdown 提供整理后的语义正文给人和 LLM 阅读。Markdown 是面向阅读的派生视图，不替代机器证据。
- 这些 Core 不只服务于“导出文件”，以后也可以直接包装成函数工具。例如输入图框和实体包围盒，返回实体位于框内、框外还是与边界相交，并进一步列出框外实体。
