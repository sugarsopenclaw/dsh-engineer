# 结论

**底层确实需要两个运行时，但不需要做成两个用户可见的产品。**

对沈变所的设计人员，产品形态可以始终是：

> **THCAD 右侧一个“AI 审图助手”面板。**

后台实际上由两部分组成：

1. **THCAD 内部的 C#/.NET 插件**
   负责读取当前项目、DWG、天河专业对象、用户选中范围，以及定位、高亮、批注、修改图纸。

2. **外部的 DeepSeek Harness 审图服务**
   负责组织规范、企业知识、算法工具、审图流程、子智能体、审图报告和执行轨迹。

也就是说，不是“THCAD 插件 + 另一个晓量客户端”，而是：

```text
一个 THCAD 内嵌产品界面
+
一个用户无感的本地/内网 Agent 服务
```

## 我建议最终采用的技术路线

> **THCAD C#/.NET 插件为主，天河变压器专业数据接口为第一数据源，DWG 数据库遍历为第二数据源，DeepSeek Harness 作为外部审图编排层；BRX/TX 只在 .NET 无法读取或性能不足时补充。**

不要一开始同时开发 `.NET + BRX + TX` 三套实现。

---

# 一、这不是一个单纯的 DWG 解析项目

调查后最重要的发现是，天河现有体系已经不是“只在 DWG 里画线”。

天河公开的变压器行业方案包含：

* 算单；
* 自动出图；
* BOM 汇总；
* 通用件管理；
* 项目管理；
* PLM、ERP、MES 集成；
* 企业定制开发接口。([天河软件][1])

天河公开的特变电工沈阳变压器集团案例还明确提到：

* 算单结果自动传递至天河 CAD；
* 自动生成装配图和零件图；
* CAD 内集成轻量化项目管理；
* 检查装配关系、标题栏和明细表的一致性；
* 自动生成零部件、材料和成本 BOM；
* 管理通用件和实体库存储。([天河软件][2])

这里需要区分：官网案例主体是**特变电工沈阳变压器集团**，不一定就是你现在说的“沈变所”这一主体。但这个案例足以证明，天河在变压器领域已有相似的数据化和二次开发路径。由于资料来自供应商官网，它能够证明产品方向和公开能力，但不能替代你们自己的接口与性能实测。

因此，最优路径不是：

```text
DWG
→ 把 Line、Polyline、Text 全部导出来
→ 交给大模型猜这是什么
```

而是同时获取四类数据：

```text
天河变压器业务数据
        +
PCCAD/THCAD专业对象数据
        +
DWG底层图形数据库
        +
图纸视觉视图
```

其中，**业务数据和专业对象语义的价值通常高于裸图元。**

---

# 二、推荐的总体架构

```text
┌─────────────────────────────────────────┐
│                THCAD                    │
│                                         │
│  沈变所 AI 审图插件：C#/.NET             │
│  ├─ 当前项目、当前图纸、当前选择集         │
│  ├─ 天河标题栏、明细表、序号、通用件数据    │
│  ├─ DWG 全数据库抽取                     │
│  ├─ 局部 Plot / 截图                     │
│  ├─ 定位、缩放、高亮、批注                 │
│  └─ 右侧 AI 审图面板                     │
└──────────────────┬──────────────────────┘
                   │ HTTP/gRPC/WebSocket
                   ▼
┌─────────────────────────────────────────┐
│          CAD Data Gateway               │
│      本地进程或沈变所内网服务              │
│                                         │
│  ├─ 统一 CAD-IR                         │
│  ├─ 项目版本与图纸版本                    │
│  ├─ 图元、BOM、算单、关系索引              │
│  ├─ 几何计算和规则执行                    │
│  └─ 图纸图片及证据管理                    │
└──────────────────┬──────────────────────┘
                   │ 结构化工具接口
                   ▼
┌─────────────────────────────────────────┐
│          DeepSeek Harness               │
│                                         │
│  ├─ CAD Tools 插件                      │
│  ├─ 变压器审图 Skills                   │
│  ├─ 规范与企业知识检索                    │
│  ├─ 审图 Workflow                       │
│  ├─ 子智能体与任务规划                    │
│  └─ 审图轨迹、证据、报告                   │
└─────────────────────────────────────────┘
```

## 用户实际看到什么

用户只看到 THCAD：

```text
打开项目
→ 点击“开始审图”
→ 右侧出现问题列表
→ 点击某个问题
→ CAD 自动定位并高亮实体
→ 查看依据、实际值、期望值和建议
→ 接受、驳回或标记已修改
```

外部服务不一定需要桌面界面。它可以是：

* 本机后台进程；
* 沈变所内网服务器；
* 私有化部署的 Agent 服务；
* 管理员使用的规则与知识管理后台。

---

# 三、THCAD 侧应该采用什么技术

## 1. 第一选择：C#/.NET 插件

THCAD 官方公开列出了 ActiveX、COM、.NET、BRX（ARX 兼容）和 TX 等二次开发能力。([天河PCCAD官网][3])

第一版优先用 C#/.NET，原因很直接：

* 最适合做 THCAD 内部命令和右侧面板；
* 最适合调用 HTTP、gRPC、WebSocket；
* JSON、Protobuf、数据库、日志、异步任务生态成熟；
* 调试和维护成本远低于 C++；
* 便于把你们现有晓量的实体抽取逻辑迁移过来；
* 能够避免 Python 逐实体 COM 跨进程调用的性能问题。

但插件目标框架必须跟随天河提供的具体版本 SDK，不能事先拍脑袋决定使用哪个 .NET Runtime。

## 2. COM 只用来读取天河专业语义

天河官方明确表示，其自动化接口可以对 PCCAD 图纸中的标题栏、明细表数据进行读写，并支持 C++、C#、VB.NET；同时 PCCAD 自身支持整套图纸批量提取标题栏和明细表，并关联检查装配图明细表与零件图标题栏。([天河PCCAD官网][3])

因此 COM 可以保留，但用途要改变：

```text
不推荐：
C# / Python
→ COM
→ 每条线、每个文字、每个标注逐个读取

推荐：
.NET 数据库 API
→ 批量读取普通 DWG 对象

天河专用 COM / SDK
→ 读取标题栏、明细表、序号、通用件等专业数据
```

即：**标准图形走进程内数据库 API，天河专业对象走天河官方语义接口。**

## 3. BRX/TX 什么时候使用

BRX/TX 不应作为第一版主路径，只在以下情形中增加：

* 某些天河自定义对象在 .NET 中只显示为代理对象；
* .NET 没有暴露专业对象的底层参数；
* 整套项目批量解析出现明显性能瓶颈；
* 需要更深的几何内核、实体离散化或二进制数据；
* 沈变所已有 ARX/C++ 代码需要迁移；
* 天河只给某项业务接口提供 C++ SDK。

比较合理的组织方式是：

```text
Shb.Thcad.Plugin.dll          C#，主插件、UI、业务控制
Shb.Thcad.Extractor.dll       C#，标准数据抽取
Shb.Thcad.Native.dll          C++，后续按需增加的 BRX/TX 能力
```

而不是从一开始把全部逻辑写进 C++。

---

# 四、数据到底从哪里采

数据采集应当按以下优先级进行。

## 第一层：天河变压器业务数据

这是价值最高的一层，需要直接向天河或沈变所现有系统获取接口和数据字典，重点包括：

| 数据     | 典型内容                        | 后续用途            |
| ------ | --------------------------- | --------------- |
| 项目数据   | 项目编号、产品型号、客户要求、设计阶段、版本      | 确定审图上下文         |
| 产品技术参数 | 容量、电压等级、相数、频率、联结组别、阻抗、冷却方式等 | 对照图纸和算单         |
| 算单输入   | 客户输入、设计边界、材料及结构选项           | 判断设计前提          |
| 算单输出   | 铁芯、绕组、绝缘、损耗、温升、尺寸等计算结果      | 与图纸尺寸和 BOM 交叉检查 |
| 项目结构树  | 总装、部件、零件、图纸之间的层级            | 跨图纸审查           |
| BOM    | 物料编码、名称、规格、材料、数量、重量、父子关系    | 物料和图纸一致性        |
| 通用件库   | 标准件、借用件、历史通用结构              | 标准化和复用检查        |
| 变更记录   | 版本、变更原因、变更对象、审批状态           | 版本差异和回归检查       |

天河公开方案已经把算单、出图、BOM、通用件和项目管理作为同一套变压器设计链路，并明确支持与 PLM、ERP、MES 集成。([天河软件][1])

因此，应当优先要求天河提供：

```text
变压器设计系统 API
或
WebService
或
数据库视图
或
标准导出接口
```

不要先逆向解析它的业务数据库。

## 第二层：PCCAD/THCAD 专业对象数据

要采集的不是它最终显示出来的几条线，而是：

* 图框；
* 标题栏；
* 明细表；
* 序号及序号与明细表的关联；
* 标准件、出库零件、通用件；
* 粗糙度；
* 形位公差；
* 焊接符号；
* 基准符号；
* 技术要求；
* 特殊尺寸标注；
* 图纸初始化信息；
* 企业自定义字段；
* 隐藏字段；
* P3DM 装配关系。

PCCAD 官方页面明确说明，序号与明细表双向关联，标题栏和明细表可以导出，P3DM 可以展示装配树并检查相关数据不一致。([天河PCCAD官网][4])

这部分应优先使用天河 SDK、COM 或其批量数据提取接口，而不是把表格当成线段和文字重新识别。

## 第三层：DWG 全量底层数据

.NET Extractor 负责遍历整个数据库，而不是只遍历当前 ModelSpace。

至少采集：

```text
ModelSpace
PaperSpace
所有 Layout
所有 Block Definition
所有 Block Reference
嵌套块和变换矩阵
图层、线型、文字样式、标注样式
Line / Polyline / Arc / Circle / Spline
Text / MText / Attribute
Dimension / Leader / MLeader
Hatch / Table
Region / 3D Solid
Xref / Image / Underlay
Handle / Owner / 对象引用
XData / Extension Dictionary / XRecord
Proxy Entity / Proxy Object
```

对块不能只做“炸开后导出”，而要同时保存：

```text
块定义
块实例
嵌套路径
插入点
旋转和缩放
属性
转换后的实际几何
```

这样才能判断“同一个通用件被引用了多少次”和“某个实例是否被局部修改”。

每个对象至少保留：

```json
{
  "drawing_id": "D-001",
  "handle": "1A3F",
  "runtime_class": "AcDbBlockReference",
  "semantic_type": "transformer_part",
  "layer": "零件轮廓",
  "block_path": ["总装", "油箱", "箱盖"],
  "geometry": {},
  "bbox": {},
  "text": null,
  "attributes": {},
  "xdata": {},
  "source": "thcad_dotnet",
  "decode_status": "full"
}
```

## 第四层：视觉数据

即使有全量实体数据，也仍然需要图纸视图。

建议采集：

* 每张图纸整图 PDF 或 PNG；
* 各布局视图；
* 按图框或视口切分的局部图；
* 选中对象附近的高分辨率局部图；
* 图像坐标与 DWG Handle 的映射；
* 图层组合、显示状态和 Plot 配置。

这样视觉模型看到某个区域时，可以返回：

```text
图像区域
→ CAD 坐标范围
→ 对应 Handle 集合
→ THCAD 自动定位
```

而不是只能说“图纸右下角似乎有问题”。

---

# 五、数据怎样导出来

建议每次审图形成一个不可变的项目快照：

```text
project-snapshot/
├─ manifest.json
├─ project.json
├─ calculations/
│  └─ calculation-result.json
├─ bom/
│  ├─ assembly-tree.json
│  └─ bom.parquet
├─ drawings/
│  ├─ D001/
│  │  ├─ drawing.json
│  │  ├─ entities.parquet
│  │  ├─ relations.parquet
│  │  ├─ semantic-objects.json
│  │  └─ views/
│  └─ D002/
├─ source/
│  └─ original.dwg
└─ extraction-report.json
```

第一版可以全部使用 JSON/JSONL，先把闭环跑通。图元数量上来之后，再把实体和关系数据改成：

* Arrow/Parquet；
* Protobuf；
* DuckDB；
* PostgreSQL。

原 DWG 必须保留，抽取数据是派生数据，不能替代源文件。

## 采集触发方式

建议保留四种触发：

1. **项目首次导入**：整套图纸全量采集。
2. **点击开始审图**：检查当前快照是否最新，不一致则增量更新。
3. **保存图纸后**：计算 Handle、属性和几何差异。
4. **用户框选或点选提问**：只采集选择对象、嵌套块、周边实体和局部截图。

核心原则是：

> **全量数据进入存储，不是全量数据进入模型上下文。**

模型需要什么，再通过工具查什么。

---

# 六、DeepSeek Harness 应该怎么接

这里实际上有两套“插件”：

```text
THCAD 插件
负责 CAD 数据和 CAD 操作

DeepSeek Harness 插件
负责把这些能力暴露给 Agent
```

DeepSeek Harness 的插件是 TypeScript 模块，通过 `apply(ctx)` 注册服务和工具；其官方设计支持将能力拆成服务定义、服务提供者和模型工具三层。([Deepseek Harness][5])

建议开发以下 DSH 包：

```text
@shb/cad-contract
定义 CAD 查询、规则执行、定位和批注的数据结构

@shb/cad-provider-http
通过 HTTP/gRPC 调用 CAD Data Gateway

@shb/cad-tools
将 CAD 能力注册成模型可调用工具

@shb/transformer-review-skills
变压器审图方法、规范、企业规则和工作步骤

@shb/transformer-review-workflow
组织全项目扫描、分专业审查、汇总和复核

@shb/review-storage
保存问题、证据、审图轨迹和人工反馈
```

## 初始工具集

模型不应直接操作数据库，而应调用边界明确的工具：

```text
cad_get_project_manifest
获取项目、图纸目录和装配结构

cad_get_drawing_summary
获取图纸类型、标题栏、布局和对象统计

cad_query_entities
按类型、图层、块、属性、坐标范围查询对象

cad_get_entity
按 Handle 获取完整实体和关联关系

cad_get_bom
读取项目或某个装配的 BOM

cad_get_calculation
读取指定算单参数和来源

cad_get_view
生成指定坐标范围的局部视图并高亮实体

cad_run_rule
执行确定性审图算法

cad_compare_versions
对比两个设计版本

cad_create_issue
生成有实体定位和证据的问题

cad_locate_issue
通知 THCAD 缩放并高亮对应对象

cad_apply_annotation
经用户批准后写入云线、批注或审图标记
```

DeepSeek Harness 官方支持将工具注册到模型，并对参数和输出进行类型校验；它还会把系统提示、工具调用、工具结果、子智能体调度及上下文注入记录到追加式 Session Log 中，适合形成审图审计轨迹。([Deepseek Harness][6])

不过 DSH 目前仍明确标注为 Developer Preview，并提示可能发生破坏兼容性的更新，因此企业项目必须：

* 固定 Git Commit 或固定版本；
* 在外面包一层自己的 `cad-contract`；
* 不让业务代码直接依赖 DSH 内部实现；
* 保留将来替换 Harness 的能力。([GitHub][7])

---

# 七、一次审图任务具体如何执行

```text
1. 用户在 THCAD 中打开项目
2. 点击“开始审图”
3. .NET 插件确认当前图纸和项目版本
4. 提取项目、算单、BOM、专业对象、底层实体和视图
5. Data Gateway 建立项目快照和索引
6. 先运行确定性规则
7. DeepSeek Harness 制定审图计划
8. Agent 按需调用 CAD 查询、规则和视觉工具
9. 生成带 Handle、坐标、截图和依据的问题
10. THCAD 面板显示问题
11. 用户点击问题，CAD 自动定位和高亮
12. 用户接受、驳回或修改
13. 再次保存后进行增量复查
```

## 审图输出不能只是自然语言

每个问题都应是结构化对象：

```json
{
  "issue_id": "ISSUE-1024",
  "drawing_id": "D-017",
  "category": "BOM_DRAWING_MISMATCH",
  "severity": "major",
  "rule_id": "SHB-BOM-021",
  "title": "装配图数量与零件图标题栏不一致",
  "expected": "数量为 6",
  "actual": "明细表数量为 4",
  "entity_handles": ["3A2F", "3B10"],
  "bbox": {},
  "evidence_view": "views/issue-1024.webp",
  "basis": ["企业规则 QJ-xxx", "算单字段 winding_count"],
  "confidence": 0.97,
  "review_status": "pending"
}
```

这才能实现：

```text
问题
→ 证据
→ 图纸实体
→ 规范依据
→ 人工结论
→ 修改结果
```

---

# 八、第一批最适合做的审图能力

第一阶段不要直接挑战所有复杂的变压器设计正确性。先做数据确定、容易验收的内容。

## 1. 项目和图纸一致性

* 项目目录与实际 DWG 是否一致；
* 总装图明细表与零件图标题栏是否一致；
* 图号、名称、材料、数量、重量是否一致；
* 装配树是否存在缺失或孤立零件；
* 版本号、变更号、日期是否冲突；
* 借用件、通用件和新制件分类是否正确。

这正是天河现有批量数据提取和 P3DM 装配管理已经覆盖的数据基础。([天河PCCAD官网][4])

## 2. 算单、图纸、BOM 三方校核

例如：

```text
算单中的结构参数
↔
图纸中的尺寸和标注
↔
BOM 中的材料、数量和重量
```

这类检查是沈变所项目最有价值的部分，因为它不只是传统 CAD 规范检查，而是把：

```text
设计计算
→ 图纸
→ 物料
→ 制造
```

真正连起来。

## 3. 图纸规范审查

* 图层、颜色、线型、线宽；
* 单位、比例和图框；
* 字体和文字高度；
* 尺寸样式；
* 公差、粗糙度、焊接符号；
* 重复尺寸和尺寸冲突；
* 空文字、未填写字段；
* 图框外对象；
* 未解析的代理对象；
* 断开的轮廓、重叠线和极短线。

## 4. 变压器专业规则

在前三类稳定后，再逐步加入：

* 铁芯与绕组结构关系；
* 绕组、绝缘、油道相关尺寸；
* 油箱、箱盖及加强结构；
* 套管、引线和出线布置；
* 冷却器和管路布置；
* 电气距离和绝缘距离；
* 装配干涉与检修空间；
* 标准件和通用件选型；
* 可制造性及工艺约束。

这些规则不能只写成 Prompt，必须逐条沉淀为：

```text
适用条件
输入字段
实体选择方法
计算方法
阈值来源
例外条件
输出证据
```

由算法执行，LLM 负责选择规则、解释结果和组织审图过程。

---

# 九、数据怎样形成后续 AI 资产

真正有价值的数据集不是“很多 DWG”，而是每次审图完整记录：

```text
原始项目快照
+ 算单
+ BOM
+ CAD实体
+ 图纸图片
+ 使用的规则
+ Agent工具轨迹
+ 提出的问题
+ 工程师接受或驳回
+ 修改前后差异
+ 最终审定结果
```

人工反馈至少记录：

```text
正确问题
误报
漏报补充
严重程度调整
依据是否正确
建议是否可执行
实际如何修改
```

这些数据后续可以用于：

* 审图规则持续完善；
* Harness Workflow 优化；
* 检索和案例复用；
* 工程 Agent Benchmark；
* LLM Judge 标定；
* 小模型实体分类与符号识别；
* 变压器专业模型微调；
* 自动评估新模型、新 Harness 和新版本工具。

---

# 十、必须向天河确认并写进合作接口清单的内容

公开资料只能证明天河有相关能力，不能说明具体类名、数据表和授权边界。项目启动时，应直接要求天河提供：

1. THCAD 对应版本的 .NET SDK、BRX SDK、TX SDK 和示例；
2. PCCAD 标题栏、明细表、序号和标准件的读写 API；
3. 变压器行业模块的数据字典；
4. 算单输入、算单输出的接口；
5. P3DM 项目树和装配关系接口；
6. BOM、通用件和物料编码接口；
7. 自动出图参数与生成图纸之间的关联字段；
8. 自定义对象的 Runtime Class 和对象说明；
9. 批量打开、后台读取和无人工干预执行的授权方式；
10. PLM、ERP、MES 或现有 WebService 的接口文档；
11. 图纸定位、高亮、选择和写入批注的 API；
12. 现有沈变体系中已经完成的二次开发接口清单。

最关键的是争取拿到：

> **算单字段—专业对象—DWG Handle—BOM 物料—装配节点之间的关联。**

这条关联一旦拿到，DeepSeek Harness 才不是“看图说话”，而是在操作一个真正的变压器设计数据模型。

# 最终定案

沈变所定制项目建议采用：

```text
THCAD 内：
C#/.NET AI审图插件
负责数据获取、选中上下文、定位、高亮和批注

数据层：
天河变压器业务接口
+ PCCAD专业对象接口
+ THCAD DWG数据库全量抽取
+ 局部视觉视图

中间层：
本地/内网 CAD Data Gateway
统一项目快照、关系、算法和版本

Agent层：
DeepSeek Harness TypeScript插件
负责工具调用、审图Skill、Workflow、子智能体和审计轨迹

补充层：
BRX/TX只处理.NET未覆盖对象和性能瓶颈
```

这条路线既不要求重新做一个独立的晓量客户端，也不把关键能力押在通用 DWG 解析器上。**面向用户是一款 THCAD 内的 AI 审图插件；面向系统则是一个“天河专业数据 + 全量 CAD 数据 + DeepSeek Harness”的变压器工程 Agent。**

[1]: https://www.thsoft.com.cn/transformer.html "变压器设计系统_变压器行业CAD解决方案 - 天河软件"
[2]: https://thsoft.com.cn/case_xq/84.html "特变电工沈阳变压器集团有限公司 - 天河软件"
[3]: https://www.thcad.net/thcad "天河THCAD国产自主CAD解决方案，完全替代AutoCAD | 天河PCCAD官网"
[4]: https://www.thcad.net/pccad "天河PCCAD官网 | 天河PCCAD官网"
[5]: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/ "Your first plugin | DeepSeek Harness"
[6]: https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool "Build a tool | DeepSeek Harness"
[7]: https://github.com/deepseek-ai/deepseek-harness "GitHub - deepseek-ai/deepseek-harness: DeepSeek Harness: Everything is a Plugin. · GitHub"


---

# 有区别，但区别不在 C#，而在“谁能识别这张图里的对象”

对于**同一份 DWG**：

* 普通 `LINE、POLYLINE、ARC、CIRCLE、TEXT、MTEXT、DIMENSION、HATCH、INSERT、ATTRIB、LAYER` 等标准对象，用 AutoCAD C#/.NET 和 THCAD C#/.NET 提取，经过统一字段归一化后，结果应当**基本一致**。
* 天河/PCCAD 生成的标题栏、明细表、序号、通用件、企业编码、装配关系等专业数据，**THCAD 内提取通常更完整**。
* AutoCAD Mechanical、Architecture、Civil 3D 或其他 ObjectARX 应用创建的专有对象，则可能反过来是 AutoCAD 对应产品更完整。
* 哪个平台缺少创建该对象的应用程序或 Object Enabler，哪个平台就可能只能得到 `Proxy Entity/Object`，而不是完整专业语义。Autodesk 官方明确说明：缺少创建应用时，自定义对象会被代理对象替代，其能力显著减少。([Autodesk Help][1])

所以，对沈变所这个项目，**THCAD 导出不能简单看成 AutoCAD 导出的国产替代版**。更准确地说：

> AutoCAD 和 THCAD 都能导出标准 DWG 数据；但 THCAD 还可能拿到沈变所真正需要的天河机械设计业务语义。

---

# 一、普通 DWG 实体，两边差别很小

例如同一条直线，两边最终都应导出：

```json
{
  "handle": "2A7",
  "dxf_type": "LINE",
  "layer": "OUTLINE",
  "start": [0.0, 0.0, 0.0],
  "end": [100.0, 0.0, 0.0],
  "color": {
    "method": "ByLayer"
  },
  "linetype": "ByLayer",
  "lineweight": 25
}
```

同一个块参照，两边都应取得：

```json
{
  "handle": "4F3",
  "dxf_type": "INSERT",
  "block_name": "COIL_ASSEMBLY",
  "position": [1200.0, 600.0, 0.0],
  "rotation": 0.0,
  "scale": [1.0, 1.0, 1.0],
  "attributes": {
    "PART_NO": "SB-102",
    "MATERIAL": "T2"
  }
}
```

THCAD 官方公开功能表列出了标准 DWG、块、动态块、关联阵列、外部参照、文字、标注、表格、ACIS 实体等对象，同时提供 `.NET、BRX 和 TX` 开发接口，因此在标准二维 DWG 数据层，它具备做完整抽取器的基础。([天河PCCAD官网][2])

但这里说的是**语义基本一致**，不是 JSON 每个字段都天然一模一样。因为：

* 两个平台的托管程序集、类名和运行时包装可能不同；
* 异常对象的容错行为可能不同；
* 动态块和关联对象的求值状态可能不同；
* 文字边界、标注显示几何可能受字体、SHX 和重生成环境影响；
* 三维实体的离散网格、包围盒和质量计算可能受几何内核及容差影响。

因此不要直接序列化 `.NET` 对象本身，而要序列化你们定义的统一 CAD-IR。

---

# 二、`ObjectId` 一定不同，`Handle` 才是跨平台锚点

这是最容易踩坑的一点。

AutoCAD 官方说明：

* `ObjectId` 只在当前数据库加载到内存期间存在；
* 图纸关闭后，该 `ObjectId` 就失效；
* 下一次打开时可能变化；
* `Handle` 会保存在 DWG 中，并在不同会话之间持续存在。([Autodesk Help][3])

所以 AutoCAD 和 THCAD 导出时：

```text
AutoCAD ObjectId != THCAD ObjectId
```

这是正常的，不能拿 `ObjectId` 比较。

应该使用：

```text
file_id + database_fingerprint + handle
```

作为对象标识，例如：

```json
{
  "entity_key": "DWG-SHA256:abc123/4F3",
  "handle": "4F3",
  "runtime_object_id": "仅调试使用"
}
```

但要注意，Handle 只保证在**同一个 DWG 数据库中唯一**，不同 DWG 中完全可能出现相同 Handle。因此必须组合文件 ID。

---

# 三、真正的大区别：PCCAD/天河专业对象

假设沈变所画了一张装配图，其中包含：

* 图框；
* 标题栏；
* 装配明细表；
* 零件序号；
* 序号和明细表的双向关联；
* 材料编码；
* 通用件标记；
* 装配树节点；
* 零件图与装配图关系；
* 企业自定义字段。

## AutoCAD 普通 .NET 抽取可能看到的是

```text
BlockReference
AttributeReference
DBText
MText
Line
Polyline
Leader
XData
ExtensionDictionary
ProxyEntity
```

也就是说，它可能知道：

> 这里有一个块，块里有文字“45#”，旁边有序号“12”。

但不一定知道：

> 序号 12 对应明细表第 12 行，该行对应零件图 SB-0012，对应物料编码 M000342，并属于装配节点“油箱—箱盖”。

## THCAD/PCCAD 专业接口可能直接得到

```json
{
  "object_type": "PCCAD_PART_BALLOON",
  "item_no": "12",
  "bom_row_id": "ROW-12",
  "part_number": "SB-0012",
  "part_name": "箱盖加强板",
  "material_code": "M000342",
  "material": "Q235B",
  "quantity": 4,
  "assembly_node": "油箱/箱盖",
  "drawing_reference": "SB-0012.dwg"
}
```

天河官方明确说明：

* 可批量提取整套图纸的标题栏和明细表；
* 可以关联检查装配图明细表与零件图标题栏；
* P3DM 中保存和展示装配树；
* 通过 COM 自动化接口，可以用 C# 读取和写入 PCCAD 标题栏、明细表数据。([天河PCCAD官网][2])

这正是 THCAD 路线相对 AutoCAD 普通实体抽取的核心优势。

---

# 四、但不能先假设 THCAD 一定把所有专业数据放在 DWG 里

天河专业数据可能存在几种落盘方式：

1. **普通块和属性**

```text
BlockReference + AttributeReference
```

这种 AutoCAD 和 THCAD 都容易读取。

2. **XData**

```text
DBObject.XData
```

两边通常都能读取原始 TypedValue，但只有知道字段协议后，才能理解其业务含义。

3. **Extension Dictionary + XRecord**

```text
DBObject.ExtensionDictionary
└─ Dictionary
   └─ XRecord
```

AutoCAD 的 XRecord 可以保存大量应用数据，还能保存硬/软指针和所有权关系。([Autodesk Help][4])

4. **自定义实体或自定义非图形对象**

```text
PCCAD_CUSTOM_ENTITY
PCCAD_CUSTOM_OBJECT
```

这种必须有相应运行时类、DBX、TX 或专业 SDK，普通 AutoCAD 可能只看到代理对象。

5. **外部数据库或 P3DM 项目文件**

```text
DWG
+
P3DM 项目数据库
+
材料库
+
通用件库
+
企业编码库
```

这种情况下，只抽 DWG 永远不可能拿全。必须同时接天河的业务接口、项目管理接口或数据库视图。

因此要让天河明确回答：

> 标题栏、明细表、序号关联、P3DM 装配树、物料编码、通用件和变压器算单数据，分别保存在 DWG、XData、XRecord、自定义对象，还是外部数据库中？

---

# 五、同一对象在两边可能有四种结果

| 对象情况           | AutoCAD .NET                | THCAD .NET     |
| -------------- | --------------------------- | -------------- |
| 标准 DWG 实体      | 基本完整                        | 基本完整           |
| 普通块、属性、文字表格    | 基本完整                        | 基本完整           |
| PCCAD 专业对象     | 可能只有普通图形、原始私有数据或代理对象        | 更可能取得完整专业字段    |
| AutoCAD 垂直产品对象 | 安装对应产品或 Object Enabler 后较完整 | 可能成为代理对象       |
| 第三方自定义实体       | 取决于是否安装对应模块                 | 取决于是否安装对应模块    |
| 外部 P3DM/业务库数据  | 默认没有                        | 通过天河业务接口可能取得   |
| 视觉显示结果         | 受 AutoCAD 图形系统影响            | 受 THCAD 图形系统影响 |

Autodesk 对 Custom Object 的规则非常明确：创建应用不存在时，会以 Proxy Object 替代；Object Enabler 可以恢复部分查看、读取或编辑能力。([Autodesk Help][1])

因此“AutoCAD 是原厂，所以打开任何 DWG 数据都最全”并不成立。它对标准 AutoCAD 对象最权威，但对天河自己定义的专业对象，未必比天河完整。

---

# 六、动态块、标注、表格等复杂对象还要防止“看起来一样，内部不完全一样”

## 动态块

应同时导出：

```json
{
  "block_definition": "...",
  "anonymous_block_definition": "...",
  "is_dynamic": true,
  "dynamic_properties": [],
  "visibility_state": "...",
  "evaluated_geometry": []
}
```

不能只导出当前显示出来的线。

AutoCAD 的动态块本身就有独立的属性查询和匿名块求值机制。([Autodesk Help][5])

THCAD 虽然公开宣称支持动态块，但仍应在实际图纸中验证：

* 参数名称是否一致；
* 当前可见状态是否一致；
* 匿名块定义是否一致；
* Lookup、Stretch、Visibility 参数是否都能取得；
* 当前求值几何是否一致。

## 标注和专业符号

例如 PCCAD 的：

* 粗糙度；
* 形位公差；
* 焊接符号；
* 基准符号；
* 锥斜度；
* 中心孔；
* 技术要求。

它们可能是：

```text
标准 AutoCAD Dimension/MLeader
```

也可能是：

```text
普通块 + 属性
```

还可能是：

```text
PCCAD 自定义智能对象
```

这三种实现，在 AutoCAD 中导出的数据质量会完全不同。天河官方将这些列为其机械专业功能，而不是单纯标准 AutoCAD 基础实体。([天河PCCAD官网][2])

---

# 七、对沈变所应该怎么选

## 生产主链路：THCAD 内提取

因为图纸是围绕天河体系设计和绘制的，所以建议：

```text
THCAD C#/.NET Extractor
├─ 标准 DWG 全数据库抽取
├─ PCCAD 专业对象接口
├─ 标题栏、明细表、序号接口
├─ P3DM 装配树接口
├─ 变压器算单与 BOM 接口
└─ 选中、定位、高亮、批注
```

这条链路最大限度保留：

```text
图形
+
机械语义
+
物料关系
+
装配关系
+
项目关系
```

## AutoCAD Extractor：验证和兜底

你们已有 AutoCAD C#/.NET 抽取能力，不必废弃，可将其定位成：

```text
AutoCAD Extractor
├─ 标准 DWG 数据对照
├─ 检测 THCAD 抽取遗漏
├─ 验证跨平台兼容
├─ 处理外部 AutoCAD 图纸
└─ 建立测试 Oracle
```

但没有必要让沈变所日常设计同时启动 AutoCAD。

---

# 八、不要开发两套完全不同的数据模型

推荐做成：

```text
               ┌─ AutoCAD Adapter
DWG Host ──────┤
               └─ THCAD Adapter
                       ↓
                Canonical CAD-IR
```

## 公共层

```json
{
  "source": {
    "file_id": "...",
    "host": "thcad",
    "host_version": "...",
    "extractor_version": "..."
  },
  "identity": {
    "handle": "4F3",
    "owner_handle": "1A",
    "dxf_type": "INSERT"
  },
  "classification": {
    "runtime_class": "...",
    "semantic_type": "part_reference",
    "decode_status": "full"
  },
  "geometry": {},
  "style": {},
  "block": {},
  "text": {},
  "dimension": {},
  "xdata": [],
  "extension_dictionary": {},
  "relations": []
}
```

## 天河扩展层

```json
{
  "extensions": {
    "thcad": {
      "pccad_object_type": "part_balloon",
      "item_no": "12",
      "bom_row_id": "ROW-12",
      "material_code": "M000342",
      "assembly_node_id": "NODE-203",
      "project_drawing_id": "SB-0012"
    }
  }
}
```

## AutoCAD 扩展层

```json
{
  "extensions": {
    "autocad": {
      "rx_class": "AcDbBlockReference",
      "dynamic_block_properties": [],
      "annotation_contexts": []
    }
  }
}
```

这样 DeepSeek Harness 不关心数据是 AutoCAD 还是 THCAD 产生的。普通工具查询公共层：

```text
cad_query_entities
cad_get_block
cad_get_dimension
cad_get_view
```

变压器专业工具查询天河扩展层：

```text
transformer_get_bom_item
transformer_get_assembly_node
transformer_get_calculation_parameter
transformer_check_bom_drawing_consistency
```

---

# 九、最应该立即做的验证

不用争论两套 API 理论上谁更完整，直接拿沈变所 20～50 张代表性 DWG，做一次双路普查。

对同一原始文件分别运行：

```text
AutoCAD C#/.NET Extractor
THCAD C#/.NET Extractor
```

然后按 Handle 对比：

```text
对象总数
对象类型分布
Handle 集合
块定义和块实例数量
属性数量
文字和标注数量
XData 应用名和字段数量
Extension Dictionary 数量
XRecord 数量
动态块参数数量
Proxy Entity/Object 数量
标题栏字段数量
明细表行数
序号与 BOM 关联数量
装配树节点数量
未识别对象数量
```

最终会得到三类结论：

```text
A. 两边完全一致的标准字段
→ 进入 common CAD-IR

B. 只有 THCAD 能读到的字段
→ 进入 thcad extension

C. 两边都无法解释的对象
→ 要求天河提供 SDK、数据字典或业务接口
```

---

# 最终判断

**有区别，但标准图元层区别不会很大；真正决定项目价值的是天河专业语义层。**

对沈变所而言：

```text
AutoCAD .NET 导出
≈ 标准 DWG 数据的可靠抽取

THCAD .NET 导出
≈ 标准 DWG 数据
+ PCCAD 标题栏/明细表/序号
+ P3DM 装配关系
+ 天河机械设计业务数据
```

因此最合理的定案是：

> **THCAD C#/.NET 作为生产主抽取器，读取标准 DWG 数据和天河专业数据；现有 AutoCAD C#/.NET 抽取器保留为标准数据对照和外部图纸适配器。两边统一输出同一套 CAD-IR，使用 Handle 而不是 ObjectId 建立图纸实体定位。**

前提只有一个：必须通过代表性沈变图纸 PoC，确认 PCCAD 专业数据究竟存放在普通 DWG 对象、XData/XRecord、自定义对象，还是外部 P3DM/业务数据库中。这个结果会直接决定你们只开发 `.NET` 插件，还是还需要天河提供 COM、TX/BRX 和业务系统接口。

[1]: https://help.autodesk.com/view/ACD/2026/ENU/?caas=caas%2Fdocumentation%2FACDLT%2F2014%2FENU%2Ffiles%2FGUID-6515268E-3D71-4CBC-8D3C-2059CFAA4E38-htm.html "AutoCAD 2026 Help | About Custom Objects and Proxy Objects | Autodesk"
[2]: https://www.thcad.net/thcad "天河THCAD国产自主CAD解决方案，完全替代AutoCAD | 天河PCCAD官网"
[3]: https://help.autodesk.com/cloudhelp/2027/ITA/OARX-DevGuide-Managed/files/GUID-8D56532D-2B17-48D1-8C81-B4AD89603A1C.htm?utm_source=chatgpt.com "Work With ObjectIds (.NET)"
[4]: https://help.autodesk.com/cloudhelp/2022/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Xrecord.html "Xrecord Class"
[5]: https://help.autodesk.com/view/OARX/2023/DEU/?guid=GUID-A860E04C-570A-4CF0-AFF4-CA7786E25C1E&utm_source=chatgpt.com "AutoCAD 2023 Developer and ObjectARX Hilfe | Dynamic Block ..."
