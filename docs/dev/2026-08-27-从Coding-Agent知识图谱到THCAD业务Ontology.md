# 从 Coding Agent 知识图谱到 THCAD 业务 Ontology

> 日期：2026-08-27  
> 状态：架构判断与后续建模方向，不是已完成实现  
> 对比对象：Graphify、CodeGraph、Palantir Ontology，以及本仓库现有 THCAD 能力盘点与 01–07 CAD 能力

## 0. 结论

Graphify 和 CodeGraph 证明了一件事：把代码中的函数、类、调用和依赖当作可查询的数据，Agent 就不必每次靠 grep、读文件和上下文窗口重新推导系统结构。

Palantir Ontology 又向前一步：它不只描述技术资产，而是把数据映射成现实业务对象、属性和关系，再把确定性逻辑、可执行动作和治理约束接到这些对象上，形成可供人和 Agent 共同操作的业务世界模型。

本仓库已经具备两类关键原料：

1. **技术能力原料**：抽取 JSON 字段，以及 THCAD/BricsCAD 的 .NET、COM、LISP/命令、BRX/ARX 能力盘点；
2. **业务语义原料**：01 全量实体抽取和 02–07 对图框、分区、明细表、技术要求、图层、中心线等规律的识别与验证。

因此可形成一套适合本项目的组合：

```text
Graphify / CodeGraph 的建图、查询、增量更新和证据路径方法
                              +
Palantir 的对象、属性、链接、函数、动作与治理思想
                              +
THCAD 实体事实、公开能力、02–07 业务规律和 Harness Agent
                              =
面向变压器图纸的可执行 CAD 业务 Ontology
```

这不是为了做一张酷炫关系图，也不是要照搬 Palantir 产品。核心价值是让 Agent 获得一个持久、可查询、可追溯并能连接真实 CAD 动作的外部世界模型。

## 1. 三个参照项目分别解决什么

### 1.1 Graphify：把代码及其上下文变成带来源的关系图

Graphify 的核心做法是：

- 用 Tree-sitter AST 确定性抽取函数、类、导入、调用等代码事实；
- 将文档、PDF、SQL schema 等非 AST 内容也连接进同一张图；
- 把边建模为“有方向、有类型的主张”；
- 区分直接抽取、推断和无法完全消歧的关系；
- 提供 `query`、`path`、`explain`，让 Agent 取得相关子图，而不是把整个仓库塞进上下文；
- 通过本地 `graph.json`、Skill 或 MCP 把图提供给不同 Agent。

对本项目最有价值的不是它的代码节点类型，而是四个方法论：

1. **确定性事实优先自动抽取**；
2. **推断关系必须保留来源，不能伪装成原始事实**；
3. **回答应能还原为一条可检查的路径**；
4. **给 Agent 返回相关子图，而不是全量原始数据**。

### 1.2 CodeGraph：预索引、持续同步和影响范围查询

CodeGraph 更集中于 Coding Agent 的代码智能：

- 预先建立符号、调用和依赖图；
- 进行跨文件解析；
- 文件变化时自动同步索引；
- 通过 MCP 向 Agent 暴露探索能力；
- 支持调用链和变更影响范围分析。

它对本项目的主要启发是：图不能只是一次性导出的静态报告。图纸、算法和能力版本变化后，应能只更新受影响的对象和关系；Agent 也应能询问“修改这一识别函数会影响哪些业务关系和下游动作”。

### 1.3 Palantir Ontology：从知识图走向可执行的业务世界

Palantir 将 Ontology 定义为组织的数字孪生和运营层。其核心不只是图结构，而是：

- `Object Type`：现实中的实体或事件；
- `Property`：对象特征；
- `Link Type`：对象之间的业务关系；
- `Function`：读取对象、计算并返回结果的确定性或模型逻辑；
- `Action Type`：对对象、属性和链接实施修改，并产生受控副作用；
- `Security`：约束谁能读、写、执行和审计。

Palantir 对决策的拆分尤其适合本项目：

```text
Data      图纸、实体、坐标、属性、API 与历史验证
Logic     02–07 几何算法、拓扑规则、命名信号和业务判断
Action    定位、高亮、选择、显示隐藏、修改、绘制、保存
Security  客户原文不可变、权限、撤销、存图边界和审计证据
```

这解释了为什么单纯的数据仓库或 API 目录还不够：真正的闭环必须把“看到了什么、怎样判断、决定做什么、实际怎样改变 CAD”连接起来。

## 2. 三者与本项目的根本区别

Graphify 和 CodeGraph 的主要世界是**软件代码**。函数、类、文件和调用关系本身就是目标对象，AST 提供了相对稳定的事实来源。

本项目的主要世界是**工程图纸和设计业务**。线、圆、文字和块只是底层表现，真正关心的是：

- 哪个矩形是图框；
- 某实体位于哪个图框分区；
- 哪些文字共同组成技术要求；
- 明细行、图面序号和构件如何关联；
- 哪些几何具有中心和对称语义；
- 用户能对这些对象执行什么操作。

因此不能把 Graphify 的代码 schema 原样搬来，也不能认为“把所有 API 变成节点”就已经完成业务 Ontology。对我们而言，应同时保留两张相连但不混层的图：

```text
┌──────────────────────┐       uses / produces       ┌──────────────────────┐
│ 技术能力图谱          │ ──────────────────────────→ │ 图纸业务 Ontology     │
│                      │                              │                      │
│ Assembly / Type      │                              │ Drawing / Frame      │
│ Method / Property    │                              │ Zone / Entity        │
│ ProgID / Command     │                              │ BomRow / Annotation  │
│ Module / API Surface │                              │ Centerline / Part    │
└──────────────────────┘                              └──────────────────────┘
              ↑                                                    ↑
              │                                                    │
       .NET / COM / LISP                                 01 原始事实 + 02–07 识别
```

技术层的 `Line.StartPoint`、`ExplodeGeometry()` 和 `GetBomRecorder()` 不是“法兰”或“明细行”的同级业务属性。它们是取得或改变业务事实的能力入口，应通过函数和证据关系连接到业务对象。

## 3. 本项目已经有的四层资产

### 3.1 原始事实与数据源

- 客户 DWG 原文；
- 01 全量实体抽取生成的 drawing、entity、extraction-report 等 JSON；
- 标题栏、明细表、命名字典、XData 和 TH 专业对象壳；
- 当前选中实体和当前 THCAD 会话状态；
- 七张样图的验证结果与人工核实记录。

这些事实属于 Source/Data Layer，不等同于业务 Ontology 类型定义。

### 3.2 技术能力目录

当前已经分别盘点：

- 抽取 JSON 的 455 个键级字段；
- 公开 .NET 类型、属性、方法、事件和构造入口；
- 32/64 位 COM Automation、ProgID 和天河业务组件；
- LISP 函数、菜单宏、命令符号和已加载模块；
- BRX/ARX 原生模块与 PE 导出线索。

这些内容可以由文档进一步转成机器可查询的能力对象，例如：

```text
Capability: TH_XuHaoEntity.ExplodeGeometry
kind: dotnet_method
declared_by: TH_XuHaoEntity
returns: exploded_geometry
used_by: XuhaoCoordinateExtractor
produces_property: annotation_side_point, target_side_point
runtime_verified: true
```

### 3.3 02–07 业务识别函数

这些低耦合 Core 不是零散脚本，而是最早一批 Ontology Functions：

- **02 图框检测**：从普通线段生成 `DrawingFrame`，并建立图纸包含图框的关系；
- **03 图框分区检测**：生成 `DrawingZone`，并建立点/实体位于 `A16` 等分区的关系；
- **04 机械明细表知识化**：生成 `BomTable`、`BomRow`，连接图面序号标注和明细行；
- **05 技术要求提取**：生成 `TechnicalRequirementSection` 与编号条目，并保留原文字证据；
- **06 图层分析**：生成/查询 `CadLayer`，建立实体所属图层、空间和可见状态关系；
- **07 中心线识别**：生成 `CenterGeometry`、形态、相交点和局部视觉锚点。

01 更接近传感器和 Data Adapter：它把 THCAD 世界转换成普通、可复现的实体事实。02–07 则在这些事实之上物化业务对象、派生属性和关系。

### 3.4 执行动作与宿主适配器

目前已经拥有或发现了大量动作入口，但不能把“元数据存在”写成“稳定动作已经实现”：

- COM 附着当前 THCAD、取得文档和选择集、发送命令；
- .NET 读取和修改数据库对象、创建实体、变换和编辑器交互；
- LISP/命令复用当前会话与既有天河工作流；
- 图层显示隐藏、实体定位、高亮、选择、绘制和保存等潜在动作。

未来每个正式 Action 都应明确目标对象、参数、前置条件、作用范围、是否修改 DWG、撤销方式和证据记录。能力盘点不排除写操作，但也不能把未验证的接口直接暴露成生产动作。

## 4. 对 Agent 的实际差异

### 4.1 只依赖 Harness 工具时

Agent 需要：

1. 先知道有哪些 02–07 工具；
2. 自己决定调用顺序；
3. 在上下文中保存每次 JSON 返回值；
4. 临时拼接不同工具的 ID、句柄和坐标；
5. 下次任务或换 Agent 后重新阅读文档、重新计算。

工具能给出可靠局部结果，但整个图纸的世界状态主要由当前 Agent 临时维护。

### 4.2 以 Ontology 图作为世界模型时

Agent 的工作循环变成：

```text
理解用户目标
  → 查询当前对象、关系和可用能力
  → 区分“已知为否”与“尚未计算”
  → 只调用补齐缺失关系所需的 02–07 Function
  → 将结果连同证据写回图
  → 沿多跳关系规划下一步
  → 调用 THCAD Action
  → 记录结果与对图纸状态的影响
```

图为 Agent 带来的不是更大的上下文，而是更小、更精确的相关子图：

```text
BomRow 15
  → REFERS_TO XuhaoAnnotation 15
  → POINTS_TO Component X
  → LOCATED_IN Zone H14
  → ON_LAYER 轮廓线
```

这使 Agent 能够：

- 从业务目标反查应该调用哪个能力；
- 复用已经计算和人工验证的关系；
- 进行跨图框、明细表、序号、构件、中心线的多跳推理；
- 查询算法或 API 变化的影响范围；
- 用来源路径解释结论，而不是只给一个无法复核的答案；
- 将不同 Agent 和不同会话的工作积累为共享工程记忆。

## 5. 建议的最小对象与关系

这只是首批建模候选，应按真实用例逐步增加，不预建通用 CAD 大本体。

### 5.1 技术能力对象

- `CadHost`：THCAD、AutoCAD；
- `ApiSurface`：DotNet、COM、LISP、Command、Native；
- `AssemblyOrModule`；
- `ApiTypeOrInterface`；
- `ApiMember`：Method、Property、Event、Constructor；
- `CommandOrProgId`；
- `CapabilityProbe`；
- `CapabilityEvidence`。

首批关系：

- `HOST_EXPOSES_SURFACE`；
- `MODULE_DECLARES_TYPE`；
- `TYPE_DECLARES_MEMBER`；
- `MEMBER_ACCEPTS_TYPE` / `MEMBER_RETURNS_TYPE`；
- `CAPABILITY_AVAILABLE_IN_VERSION`；
- `PROBE_VERIFIES_CAPABILITY`；
- `FUNCTION_USES_CAPABILITY`。

### 5.2 图纸业务对象

- `Drawing`；
- `CadEntity`；
- `DrawingFrame`；
- `DrawingZone`；
- `CadLayer`；
- `BomTable` / `BomRow`；
- `XuhaoAnnotation`；
- `TechnicalRequirementSection` / `TechnicalRequirementItem`；
- `CenterGeometry` / `CenterIntersection`；
- `Component`；
- `Evidence`。

首批关系：

- `DRAWING_CONTAINS_ENTITY`；
- `DRAWING_HAS_FRAME`；
- `FRAME_HAS_ZONE`；
- `ENTITY_LOCATED_IN_ZONE`；
- `ENTITY_ON_LAYER`；
- `BOM_ROW_REFERS_TO_ANNOTATION`；
- `ANNOTATION_POINTS_TO_ENTITY`；
- `CENTER_INTERSECTS_AT`；
- `CENTER_IS_SYMMETRY_AXIS_OF`；
- `RELATION_SUPPORTED_BY_EVIDENCE`；
- `FUNCTION_PRODUCES_OBJECT_OR_LINK`。

## 6. 证据与规律的记录方式

七张图是回归样本，不是所有图纸的普遍真理。图谱不能把一次推断抹平成永久事实。

每个重要派生对象或关系至少应能追溯：

- `source_ref`：DWG、实体句柄、JSON 路径、API 类型或文档位置；
- `producer`：哪个抽取器、02–07 函数或人工操作产生；
- `algorithm_version`；
- `sample_scope`：在哪些图纸上验证；
- `evidence`：文字、线型、几何、拓扑、命名字典或运行时调用结果；
- `verified_by` / `verified_at`：如有人工确认；
- `supersedes`：算法升级后替代哪个旧结论。

不要求所有 Core 都返回一套复杂通用状态包。这里记录的是图中“这条主张为什么存在”，目的是区分原始事实、确定性派生、启发式推断和人工确认，避免让 Agent 把未知当作不存在。

## 7. 仓库分层落点

遵守现有平台分层，不因引入图谱而把所有东西塞进一个数据库或插件：

```text
client-data/   客户原始 DWG，只收不改
data/          抽取、图实例、关系实例、增量物化管线
ontology/      Object / Property / Link / Function / Action 类型定义
local-dev/cad/ 宿主无关 02–07 Core 与 THCAD Adapter
dev-test/      API 盘点、COM/LISP/原生探针和本机 PoC
plugins/       Harness Agent 可调用的查询、函数与动作工具
backend/       按需提供共享查询、存证和基础设施适配
```

图存储引擎不是当前第一决策。可以先用可版本化的 schema 和简单 JSONL/SQLite 派生图验证查询；确认对象规模、增量模式和实际查询后，再判断是否需要 Neo4j、FalkorDB 或其他图数据库。

也不建议把每个顶点坐标都复制成图节点。无损几何仍留在 Data Layer；Ontology 保存稳定对象 ID、关键业务属性、关系和回到原始证据的引用。

## 8. 应借鉴与不应照搬的部分

### 应借鉴

- Graphify 的确定性抽取、关系来源、`query/path/explain` 和相关子图；
- CodeGraph 的预索引、跨文件/跨对象解析、增量同步和影响分析；
- Palantir 的对象/链接与函数/动作分离，以及 Data–Logic–Action–Security 闭环；
- 本地优先、可重建派生数据和稳定 ID；
- 让 Agent 查图后再读大文件或调用昂贵工具。

### 不应照搬

- 不把代码 AST 的节点类型当作 CAD 业务模型；
- 不把所有 COM/.NET 方法直接提升为最终用户可见 Action；
- 不把七图规律写成固定行业标准；
- 不为“图数据库”而图数据库，也不提前复制全部原始几何；
- 不用知识图谱代替精确几何、拓扑算法、事务、撤销和宿主适配；
- 不让 Ontology 实例绕过 Data Layer 直接遍历 `client-data/`。

## 9. 建议的渐进路线

### 阶段 A：先定义，不换底座

- 为“能力图谱 + 图纸业务 Ontology”单独写规格；
- 定义稳定 ID、首批对象、关系和证据字段；
- 保留现有 01–07 文件结构与调用方式。

### 阶段 B：先导入技术能力图

- 将字段目录、.NET、COM、LISP 和原生盘点转换为机器可查对象；
- 建立 `Function → uses Capability → produces Property/Link`；
- 首先支持“某业务数据怎样取得”和“某 API 被哪些函数使用”两类查询。

### 阶段 C：让 01–07 物化业务图

- 01 生成 Drawing/Entity 基础实例；
- 02–07 增量写入 Frame、Zone、BomRow、Requirement、Layer、CenterGeometry 与关系；
- 保留现有 JSON/Markdown 导出作为证据和人类阅读视图。

### 阶段 D：给 Harness Agent 图查询工具

首批无需自然语言图数据库，可只提供稳定的小工具：

- `find_objects(type, filters)`；
- `neighbors(object_id, link_type)`；
- `path(from, to)`；
- `explain(object_or_link_id)`；
- `find_missing_relations(drawing_id, use_case)`；
- `find_capability_for(output_or_action)`。

### 阶段 E：闭合 THCAD Action

- 先从定位、选择、高亮、缩放、图层显示隐藏等可恢复动作开始；
- 再进入修改、删除、绘制和保存；
- Action 记录目标、输入、前置图状态、执行入口、结果和撤销/恢复信息。

## 10. 判断这套 Ontology 是否有用的首批问题

如果图不能稳定回答以下问题，就还只是可视化数据而不是 Agent 世界模型：

1. “序号 15 的指向侧坐标通过什么能力取得，证据是什么？”
2. “某明细行指向哪个图面构件，它位于哪个图框分区？”
3. “这条中心线是文字识别、线型反推还是人工确认的？”
4. “修改中心线识别算法会影响哪些关系、报告和后续动作？”
5. “当前图纸哪些关系尚未计算，而不是已经确认不存在？”
6. “要把某实体定位并高亮，应调用哪个宿主、哪个 Action？”
7. “某个业务结论能否还原到实体句柄、几何、文字和算法版本？”

## 11. 当前架构判断

对本项目最合适的不是“Graphify for CAD”的简单复制，也不是“自建一个 Palantir”。更准确的定位是：

> 用 Graphify/CodeGraph 式方法把技术能力和图纸事实建成 Agent 可查询的图；用 Palantir 式 Ontology 把这些事实提升为业务对象、关系、函数和动作；由本地 Harness Agent 调用 THCAD 完成真实工作。

Harness、02–07 与 Ontology 不是三选一：

- Harness 是运行和编排循环；
- 01 是感知适配器；
- 02–07 是确定性业务视觉/几何函数；
- Ontology 图是外部世界模型、共享记忆和能力目录；
- .NET/COM/LISP 是读取和改变 CAD 的执行面；
- LLM 负责理解目标、查询已知事实、发现缺口和决定下一步。

当这几层连接起来后，新功能不再只是“多一个脚本”：它会明确增加一种感知、一类业务对象、一条可追溯关系，或一个可以对真实图纸执行的动作。

## 12. 外部资料与本仓相关文档

外部一手资料：

- [Graphify 官方概念说明](https://graphify.com/concepts)
- [Graphify GitHub](https://github.com/Graphify-Labs/graphify)
- [CodeGraph GitHub](https://github.com/colbymchenry/codegraph)
- [CodeGraph 官方文档](https://colbymchenry.github.io/codegraph/)
- [Palantir Ontology overview](https://www.palantir.com/docs/foundry/ontology/overview)
- [Palantir Ontology core concepts](https://www.palantir.com/docs/foundry/ontology/core-concepts/)
- [Palantir: Why create an Ontology?](https://www.palantir.com/docs/foundry/ontology/why-ontology/)

本仓资料：

- [`2026-08-27-THCAD-V24-能力面总索引.md`](2026-08-27-THCAD-V24-能力面总索引.md)
- [`2026-08-24-THCAD全量实体数据能拿到什么.md`](2026-08-24-THCAD全量实体数据能拿到什么.md)
- [`../../local-dev/cad/README.md`](../../local-dev/cad/README.md)
- [`../../ontology/README.md`](../../ontology/README.md)
- [`../../specs/001-platform-layers/spec.md`](../../specs/001-platform-layers/spec.md)
