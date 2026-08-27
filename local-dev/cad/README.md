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
- 输入：`PC_MXB_BLOCK` 行块的八个命名属性及句柄、坐标、包围盒、`TH_XUHAO` 证据。
- 输出：固定列定义、结构化行、原始值与安全解析值、证据链和缺号/重号/缺列等质量报告。
- 七张图已验证五张正式明细表、208 行，全部八字段齐全且序号与 `TH_XUHAO` 一致。
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

## 07 · 器身中心线候选分析

- 类型：宿主无关 Core 分析与几何函数能力。
- 唯一实现：[`core/07-body-centerline-analysis/BodyCenterlineAnalyzer.cs`](core/07-body-centerline-analysis/BodyCenterlineAnalyzer.cs)
- 输入：绘图区内框、图层名/线型、各空间 Line，以及可能提到“器身中心线”的文字。
- 输出：独立轴和正交轴系候选、图层/文字/源句柄证据、歧义与限制；不会把普通中心线直接认证为器身轴。
- 每条候选提供带符号点到轴距离和镜像点计算，可供以后做轴两侧分类、对称拓扑搜索和经验证后的语义标签迁移。
- 七图都有几何候选，但都没有足够的模型空间显式证据升级成“已确认器身中心线”；结果如实保留多候选。

## 暂不单独编号

- 框选读取：是 01 的 Host 输入方式，不是业务算法。
- 标题栏收集：目前仍是抽取器里的早期规则，尚未形成稳定、独立的算法契约。

审图方向目前只记观察点，见 [`review-notes.md`](review-notes.md)，暂不设计或实现。
技术要求的位置与排布验证记录见 [`technical-requirements-notes.md`](technical-requirements-notes.md)。
七图的适用边界及各能力硬编码风险统一记录在 [`validation-and-risk-notes.md`](validation-and-risk-notes.md)。

## 规律开发约定

- 七张图只是当前回归样本，不代表全部图纸；“七图通过”不能写成通用标准。
- 每项能力都按“并列发现信号 → 用独立证据验证 → 保留证据后利用”推进。名字可以是信号，但不能成为唯一真相。
- 未找到、单个候选、多个候选和暂不支持都应正常返回状态与诊断，不能卡死整轮抽取，也不能为了有结果而硬猜。
- 具体信号、硬编码风险和扩样方式见 [`validation-and-risk-notes.md`](validation-and-risk-notes.md)；新图纸出现后按小模块补回归并迭代。

## 实现心得（先记住，不当硬规则）

- 拓扑、几何、命名属性等算法都是可选手段，应按图纸里实际存在的证据选择；提到一种算法不表示必须使用它。
- 导出结果分两层更合适：JSON 保留无损字段、句柄、坐标和质量诊断，Markdown 提供整理后的语义正文给人和 LLM 阅读。Markdown 是面向阅读的派生视图，不替代机器证据。
- 这些 Core 不只服务于“导出文件”，以后也可以直接包装成函数工具。例如输入图框和实体包围盒，返回实体位于框内、框外还是与边界相交，并进一步列出框外实体。
