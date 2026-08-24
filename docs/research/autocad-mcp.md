# 结论先说

**截至 2026 年 8 月 24 日，Autodesk 官方 MCP 与 Autodesk Assistant 还没有完整覆盖晓量，但已经覆盖了晓量最容易被复制、也最不应该继续当作核心壁垒的那一层：**

> **“在 AutoCAD/Revit/Fusion 里用自然语言查对象、数对象、看属性、定位、选择、做基础检查和执行部分修改。”**

更直白地判断：

| 晓量的产品定义                      |     当前被官方覆盖程度 |
| ---------------------------- | ------------: |
| AutoCAD 聊天框、查询图层、数块、找对象、框选定位 |   **70%–90%** |
| AutoCAD 原生实体查询与基础统计工具层       |   **50%–70%** |
| Revit 模型问答、明细表、视图、图纸整理       |   **60%–80%** |
| Fusion 简单参数化零件、批量改参数、报告与导出   |   **70%–85%** |
| DWG/PDF/图片融合识图、跨图关联、工程语义理解   |   **15%–30%** |
| 可追溯算量、工程审图、规范判断、结果验证         |   **10%–30%** |
| 晓量完整的“读取—理解—规划—执行—验证—交付”闭环   | **约 20%–35%** |

这些比例是我基于当前公开能力做的产品战略估算，不是 Autodesk 官方数据，也还需要用你们的 EBB-AEC-100 实测。

所以最终判断是：

> **如果晓量仍然被定义成“比 AutoCAD 多一个 AI 对话框”，会被官方覆盖。**
> **如果晓量变成“跨软件、跨文件、跨专业的工程任务编译、执行与审计系统”，不会被轻易覆盖。**

真正危险的并不只是现在的七个 MCP 工具，而是 Autodesk 正同时构建：

1. **Assistant：默认用户入口**
2. **MCP：统一工具执行层**
3. **AEC/Manufacturing Data Model：原生数据层**
4. **Automation API：云端批量执行层**
5. **Marketplace：第三方专业能力分发层**

这已经是一个完整的 Agent 平台战略。

---

# 一、先弄清楚：官方 MCP 和 Assistant 不是一回事

## 1. Autodesk MCP

Autodesk MCP 是面向模型或 Agent 的**工具与数据接口层**。它负责把自然语言意图转成结构化调用，例如：

* 查询对象
* 读取属性
* 聚合统计
* 选择与定位
* 修改参数
* 导出文件
* 调用 Autodesk API
* 管理项目数据

目前官方中央文档列出的产品包括：

| 官方 MCP                    | 部署形式 | 当前状态                       | 核心功能                                |
| ------------------------- | ---- | -------------------------- | ----------------------------------- |
| Product Help MCP          | 远程   | GA                         | 搜索 110 多个 Autodesk 产品的实时官方文档        |
| Fusion MCP                | 本地   | GA                         | 对当前 Fusion 会话执行建模和命令操作              |
| Fusion Data MCP           | 远程   | GA                         | 项目、协作者和管理类操作                        |
| Revit 2027 MCP Read-Tools | 本地   | Tech Preview / Public Beta | 7 个只读模型查询、定位、导出工具                   |
| AutoCAD / Civil 3D MCP    | 本地   | Tech Preview / Public Beta | 7 个对象查询、统计、定位、标准检查和部分 Civil 3D 修改工具 |

当前官方文档已经把 Product Help、Fusion 和 Fusion Data 标为 GA；Revit 与 AutoCAD/Civil 3D 仍是公开技术预览。([Autodesk Help][1])

## 2. Autodesk Assistant

Assistant 是 Autodesk 自己的**Agent 入口和编排器**。

它不是单独一个模型，而是一个统一的交互界面，背后按产品连接不同 MCP、模型上下文、官方文档和内部工具。

目前 Assistant 已经进入 AutoCAD、Fusion、Forma、Revit、Civil 3D、Inventor、Vault，并在 Moldflow、3ds Max、Maya、InfoWater Pro 等产品中提供不同程度的能力；但是 Autodesk 明确说明，各产品能力并不一致，有的只是帮助问答，有的已经能查询模型和执行任务。([Autodesk][2])

可以这样理解：

```text
用户
  ↓
Autodesk Assistant
  ↓
任务理解、模型选择、工具编排
  ↓
AutoCAD MCP / Revit MCP / Fusion MCP / Product Help MCP / APS API
  ↓
CAD、BIM、制造数据和真实软件操作
```

而晓量当前大致是：

```text
用户
  ↓
晓量主智能体
  ↓
专业任务规划、Subagent、模型路由
  ↓
AutoCAD COM / MLight / Plot / 视觉模型 / 算法算子
  ↓
实体、图像、工程语义、计算结果
```

从架构形态看，二者已经正面相遇。

---

# 二、AutoCAD / Civil 3D 官方 MCP 到底能干什么

这是与你们当前晓量 AutoCAD 子智能体重叠最高的部分。

## 1. 官方 MCP 的七个工具

### ① `discoverAutoCADTypes`

动态发现对象类型及其字段定义，包括：

* Line
* Circle
* Arc
* Text
* MText
* Polyline
* Dimension
* Layer
* Block
* 以及更多 AutoCAD 类型

Civil 3D 还能发现：

* Alignment
* Surface
* Corridor
* Pipe
* 其他 `civil3d_*` 对象

它不仅告诉 Agent 有什么对象，还告诉 Agent：

* 哪些字段可以查询
* 哪些字段可以写
* 字段的类型和说明

这相当于你们过去通过 COM 反射、类型枚举、实体清洗得到的一部分“对象 Schema 层”。([Autodesk Help][3])

### ② `queryAutoCADObjects`

获取真实对象和属性，支持：

* 对象类型
* 指定字段
* Handle
* 条件过滤
* 分页
* 嵌套属性查询
* 当前选择或整张图范围

例如：

```text
找出 TITLE 图层上的全部文字，
返回文字内容、高度和图层名称。
```

官方内部会先发现 Text Schema，再查询 `textString`、`height`、`layer.name` 等字段。([Autodesk Help][4])

### ③ `aggregateAutoCADObjects`

专门负责：

* Count
* Sum
* Average
* Min
* Max
* 绝对值 Min/Max
* 分组统计

典型用法：

* 每个图层有多少对象
* 某类多段线的总长度
* 各种块分别有多少个
* 按图层、类型或属性分组
* 最大、最小或平均尺寸

这会直接覆盖晓量里大量“为了回答数量问题而抽取整图实体”的简单场景。([Autodesk Help][3])

### ④ `manipulateDrawingCanvas`

控制 AutoCAD 画布：

* 选择
* 取消选择
* 获取当前选择
* Zoom Objects
* Zoom Extents
* Zoom Window
* Zoom Scale
* `showme`：选择并自动缩放到对象
* 处理模型空间与图纸空间切换

这与晓量已经做好的“指哪打哪、根据实体 Handle 定位、自动缩放截图”高度重叠。([Autodesk Help][3])

### ⑤ `checkAutoCADObjects`

把当前 DWG 与模板图纸进行比较，返回差异和合规报告。

目前它主要针对的是：

* 图层
* 颜色
* 线型
* 样式
* 对象属性
* 企业 DWT/DWG 模板约束

它是**制图标准检查**，不是完整的建筑规范审查。

比如它可以判断：

* 图层名称是否符合公司模板
* 对象是不是用了错误颜色
* 文字、标注或线型配置是否不同
* 当前图纸相较标准模板缺少了什么

但不能仅凭这项功能得出：

* 防火分区是否符合规范
* 疏散距离是否超限
* 梁柱关系是否合理
* 机电净高是否满足
* 设计说明与平面图是否矛盾

官方给出的典型用法就是“将当前图纸与公司模板比较并列出差异”。([Autodesk Help][4])

### ⑥ `updateAutoCADObjects`

这里必须特别注意官方文档内部的表述差异。

概览页用“修改对象属性”描述 Civil 3D 写入能力，甚至给出了修改文字高度的示例；但最新的详细工具参考把当前 `updateAutoCADObjects` 明确描述为：

> 更新 Civil 3D 2027.1 及以后版本中 Surface 对象的坡度分析数据。

也就是说，**不能把它理解成已经开放了通用 AutoCAD 任意实体写入**。当前可公开确认的写入面仍然很窄，而且处在 Tech Preview。([Autodesk Help][4])

### ⑦ `civil3dQueryModifyStyles`

可以查询和修改 Civil 3D 样式：

* Entity Style
* Embedded Style
* Display Style
* 切换显示组件
* 修改样式属性
* 复制样式
* 批量设置对象样式

对 Civil 3D 用户价值较大，但与晓量当前建筑、变压器、钢结构 DWG 理解的主线重叠有限。([Autodesk Help][3])

---

## 2. AutoCAD Assistant 2027.1 已经做到什么

当前版本新增或强化了：

* 更可靠的自然语言对象计数
* 支持更多对象类型
* 自动把用户当前框选对象作为查询上下文
* 报告中明确显示与 DWG 一致的单位
* 查询文字内容
* 查询图层属性和设置
* 查询块属性
* 查询闭合多段线
* 自然语言导航到对象
* 根据用户操作推荐 Prompt

而且 AutoCAD 2027.1 已经让 Assistant 在打开图纸时**默认自动打开**。这不是技术能力问题，而是非常强的分发优势：大量用户不需要安装任何晓量插件，就会首先尝试官方入口。([Autodesk Help][5])

---

## 3. AutoCAD 官方 MCP 当前的关键限制

### 限制一：AutoCAD 端仍然主要是只读

官方明确写的是：

* AutoCAD：读和分析工具
* Civil 3D：额外提供写入和样式工具

所以现在它还不能普遍做到：

* 创建任意 AutoCAD 图元
* 修改任意实体几何
* 自动完成完整绘图
* 执行任意 AutoCAD 命令链
* 对所有实体做通用写回

至少这些还没有作为稳定公开工具被文档承诺。([Autodesk Help][4])

### 限制二：目前官方支持的 AI Client 只有 Autodesk Assistant

这个 MCP 虽然在本地通过 HTTP 运行，但 Autodesk 文档当前列出的支持客户端只有 Assistant，而不像 Fusion 和 Revit MCP 那样明确支持 Claude Desktop、Cursor 或任意 MCP Client。([Autodesk Help][4])

所以不建议现在就把晓量生产架构依赖在其本地 HTTP 地址上。即使技术上能连，也属于未正式承诺的接入方式，接口和权限可能随技术预览变化。

### 限制三：它是对象查询服务，不是完整 DWG 数据库导出 SDK

它可以：

* 动态发现对象类型
* 分页查询
* 返回 Handle
* 返回被公开的嵌套属性
* 聚合统计

但官方没有公开承诺以下内容能全量、无损拿到：

* 所有底层 DXF Group Codes
* 任意 XData
* Extension Dictionary
* XRecord
* Persistent Reactor
* 自定义 ObjectARX 对象
* Proxy Object 的完整专有数据
* 所有约束和关联关系
* 原始 B-Rep/ACIS 数据
* 完整块定义、动态块状态与底层行为
* 可用于无损重建 DWG 的全部数据库内容

因此它更像：

> **面向 Agent 的高层 Query API**

而不是：

> **RealDWG/ObjectARX/ODA/MLight 那种完整文件解析和数据库访问能力**

对于“用户问一个具体问题，只提取相关对象”很好；对于“建立独立于 AutoCAD 的 Drawing IR，并确保全量可重放”还不够。

### 限制四：只工作于本机打开的 AutoCAD/Civil 3D 会话

它要求：

* Windows
* AutoCAD 或 Civil 3D 正在运行
* 图纸已打开
* Assistant Tech Preview 已开启

服务作用于当前实时会话，默认查询范围甚至是用户当前选择，只有显式要求时才切换到整张图。([Autodesk Help][4])

它没有直接解决你们需要的：

* 服务端无头解析
* 多任务并行
* 不占用用户 AutoCAD
* Linux/macOS
* 批量处理大量 DWG
* AutoCAD 未安装环境
* 私有算力集群处理
* Web 端实时解析

这正是 MLight、ODA、独立 Drawing IR 路线仍然重要的原因。

### 限制五：没有视觉理解工具

AutoCAD MCP 的画布工具是：

* 选中
* 缩放
* 导航

并不是：

* 截图
* 多尺度视觉识别
* 图框分割
* 局部图纸精读
* 图元和像素对齐
* 图例、符号、复杂表格视觉理解

因此晓量的“实体抽取 + Plot + 视觉模型 + 局部证据”目前仍然明显领先于官方 AutoCAD MCP 的公开能力。

---

# 三、Revit：当前已经比 AutoCAD 更接近真正的工程 Agent

Revit 需要分成两个产品看：

## 1. 对外开放的 Revit Public MCP

目前是七个只读工具：

1. 获取运行中的 Revit 实例
2. 查询模型
3. 获取元素详细数据
4. 选择元素
5. 缩放到元素
6. 打开指定 View
7. 导出视图、图像、PDF 或 Schedule CSV

查询支持：

* Category
* Family
* Element Name
* Level
* Bounding Box
* 参数值
* 当前视图、指定视图或整个模型
* Equals、Contains、Starts With、Greater Than 等条件

可以直接取得：

* Element ID
* Family/Type
* Level
* Bounding Box
* Instance Parameters
* Type Parameters
* 分类统计

但 Autodesk 明确把当前公共 MCP 定义为**只读基础层**，并计划未来通过独立 Write Server 开放创建和修改元素。([Autodesk][6])

## 2. 内置 Revit Assistant

内置 Assistant 的能力比公共 MCP 更强，因为它运行在 Autodesk 控制的权限和执行环境里。

当前公开示例已经包括：

* 创建按楼层排序的门明细表
* 创建指定楼层平面图并命名
* 查询某层结构柱数量
* 统计门窗标记
* 检查图纸视图是否使用 View Template
* 创建二层平面图
* 应用视图模板
* 自动标注房间
* 将相同流程复用到三层、四层
* 创建、命名和排版图纸
* 最终导出 PDF

官方将当前工作流归类为：

* Model Query
* Export
* Sheet Management & Documentation
* Room Management
* Schedules & Data Management
* Element Operations & Manipulation

不过 Autodesk 同时明确说明，目前只支持**一组聚焦的工作流，而不是所有 Revit 任务**。([Autodesk][7])

### 对晓量的影响

如果晓量以后进入 Revit/BIM，以下能力不能再作为核心差异化：

* 自然语言查询 Revit 元素
* 数门窗、柱、房间
* 查参数
* 生成基础明细表
* 批量创建标准视图
* 自动组织图纸
* 基础 PDF 导出

但下面这些仍然有空间：

* 中国建筑规范实质审查
* 建筑、结构、机电跨专业模型关联
* 图模不一致检查
* Revit + DWG + PDF + 计算书联合审查
* 企业自己的审图规则
* 工程量计算规则
* 设计变更影响分析
* 证据定位和审计报告
* 非标准、脏模型和历史项目
* 多软件、多格式共同推理

---

# 四、Fusion：对晓量机械方向的威胁比 AutoCAD 更大

Fusion MCP 是当前官方体系中最成熟、写入能力最强的一个。

它：

* 本机运行
* 连接当前 Fusion 会话
* 支持动态工具发现
* 可以被 Claude Desktop、Cursor 和其他 MCP Client 使用
* 可以读取当前设计
* 截取指定视角图像
* 运行 Fusion Python 脚本
* 修改几何与参数
* 调用与普通 Fusion Script/Add-in 相同的 API

Autodesk 对当前最佳使用场景的总结非常务实：

* 自动生成设计报告
* 获取 Bounding Box、质量、体积、重心
* 获取材料、时间线特征、草图、Joint、参数
* 批量重命名零部件
* 批量替换材料
* 修改用户参数
* 修改倒角或圆角
* 根据规格生成简单参数化零件
* 批量导出 STL、STEP、F3D
* 自动设置视角并截图

官方示例甚至包括：

* 支架
* 安装板
* 齿轮
* 紧固件阵列
* 简单外壳
* 挤出、孔、圆角、Shell、Pattern

不过 Autodesk 自己也承认，目前还不适合：

* 从零可靠生成复杂生产级 CAD
* 大型复杂装配
* 高精度无人监督设计
* 替代工程判断和验证工作流

([Autodesk][8])

## 这对你们机械版晓量很关键

你们计划中的：

* 自然语言生成单个参数化零件
* 修改零件尺寸
* 输出 STEP/DXF
* 做质量、体积、尺寸检查
* 通过 Agent 调用 CAD 内部能力

与 Fusion MCP 已经高度重叠。

因此机械方向不能只讲：

> “用户描述一个支架，Agent 自动建出来。”

因为 Fusion 官方已经能做。

更有壁垒的产品定义应该是：

> 根据工程图、PDF、图片、设计要求、企业标准和制造约束，恢复设计意图，生成可编辑参数模型，并进行尺寸、材料、强度前置规则、可制造性和图模一致性验证，最后输出带证据的 STEP/DXF/报告。

也就是从“Vibe CAD”升级为：

> **Engineering-Spec-to-Verified-CAD**

---

# 五、Product Help MCP：会覆盖通用 CAD 知识问答

Product Help MCP 当前已经能够实时检索 110 多个 Autodesk 产品、多个版本和语言的官方资料，主要场景包括：

* 安装与升级
* 授权和登录
* 报错排查
* 功能使用方法
* 系统需求
* 产品版本差异
* API 和操作指导

它是公开远程 MCP，无需 Autodesk 账号即可访问公共文档，并已提供给 Claude、Cursor、HTTP MCP Client 等使用。([Autodesk Help][9])

这意味着晓量没有必要再把以下内容当作壁垒：

* AutoCAD 某命令怎么用
* Revit 某功能在哪
* Fusion 某 API 如何调用
* Autodesk 安装报错怎么处理
* 软件使用教程问答

这些应该直接接官方 Product Help MCP，晓量只保留：

* 自己的产品帮助
* 企业专有流程
* 工程规范与标准
* 项目知识
* 任务执行规则
* 失败恢复经验

---

# 六、与晓量逐项对照

| 能力                | Autodesk 当前覆盖                                        | 对晓量的影响                |
| ----------------- | ---------------------------------------------------- | --------------------- |
| 当前图纸对象查询          | 很强，Schema、Handle、字段、过滤、分页都已具备 ([Autodesk Help][3])   | 不再是核心壁垒               |
| 数量与统计             | 很强，支持 Count、Sum、Avg、Min、Max 和分组 ([Autodesk Help][3]) | 简单数量问答会被覆盖            |
| 选择、缩放、定位          | 很强，已有 `showme` 等画布操作 ([Autodesk Help][3])            | “指哪打哪”不再足够差异化         |
| 图层、文字、块属性         | AutoCAD Assistant 已原生支持 ([Autodesk Help][5])         | 基础读图能力被商品化            |
| CAD 制图标准检查        | 已支持模板对比                                              | 企业图层、颜色、线型检查会被覆盖      |
| 实质性工程规范审查         | 公开能力很弱                                               | 晓量的重要空间               |
| 通用 AutoCAD 写图     | 当前仍弱，主要只读                                            | 晓量仍有窗口期               |
| Civil 3D 原生操作     | 对 Civil 对象和样式较强                                      | 若进入市政道路领域需警惕          |
| Revit 模型查询        | 很强                                                   | BIM 基础问答不构成壁垒         |
| Revit 文档自动化       | 已能创建视图、明细表、图纸和导出 ([Autodesk][7])                     | Revit 出图类 Agent 竞争激烈  |
| Fusion 参数化建模      | 较强                                                   | 对机械单零件方向威胁最高          |
| 完整 DWG 底层数据       | 未公开承诺全量无损                                            | MLight/ODA/独立 IR 仍有价值 |
| PDF、图片、扫描图识别      | MCP 公开能力弱                                            | 晓图/晓量视觉能力仍是差异         |
| 图元与视觉证据融合         | 未公开形成完整能力                                            | 晓量应重点强化               |
| 跨图纸、平立剖关联         | 未见成熟公共能力                                             | 晓量应重点强化               |
| 跨专业审查             | 未见成熟公共闭环                                             | 晓量应重点强化               |
| 算量规则与计价           | 未见完整公共能力                                             | 晓量核心空间                |
| 结果来源与计算链追溯        | 官方有工具调用治理，但未见工程算量级证据链                                | 晓量可建立强壁垒              |
| Agent 任务验证与重放     | 未见面向具体工程结果的完整产品                                      | 晓量可建立强壁垒              |
| 无 AutoCAD、服务端和批处理 | 本地 MCP 依赖桌面产品                                        | 晓量独立引擎有价值             |
| 多 CAD、多格式中立性      | Autodesk 以自身生态为核心                                    | 晓量可做跨生态层              |
| 中国规范、本地企业规则       | 非官方重点                                                | 晓量明显优势                |
| 私有化部署             | 官方本地工具不等于完整私有模型部署                                    | 晓量仍有企业市场空间            |

---

# 七、最危险的不是当前能力，而是 Autodesk 下一步

## 1. 原生数据壁垒正在下降

Autodesk 的 AEC Data Model API 已经能在云端提供颗粒化的 Revit：

* Geometry
* Properties
* Relationships
* 项目与模型结构

不再一定需要用户自己写 Revit 插件逐对象抽取。([Autodesk Platform Services][10])

制造侧的 Manufacturing Data Model API 也能在不启动桌面 CAD 的情况下查询：

* Component Hierarchy
* Physical Properties
* Relationships
* 产品设计数据

([Autodesk Platform Services][11])

这意味着：

> “我能从 Autodesk 文件里拿到结构化数据”

本身会越来越难成为壁垒。

真正的壁垒必须转向：

> “我知道拿到这些数据之后，如何完成具体工程任务，并证明结果是对的。”

## 2. 云端执行即将补齐

Autodesk 已宣布 Fusion Automation MCP，目标是在不安装本地 Fusion 的情况下，让 Agent 在云端使用完整设计和制造工具集；目前官方页面标为 Coming Soon，较早的开发者公告称其处于私有 Beta。([Autodesk][12])

这表明其路线很明确：

```text
本地 MCP
→ 云端 Automation MCP
→ 批处理
→ 多 Agent 调度
→ 企业级权限和计费
```

所以晓量不能把“我们能够在后台调用 CAD 软件”当成长久壁垒。

## 3. Assistant 会调用第三方 MCP

Autodesk 已经推出 Design and Make Marketplace，并明确表示：

* 第三方可以提交 MCP
* MCP 需要声明工具、外部连接、使用的 Autodesk API 和 AI Provider
* 通过认证的第三方 MCP，未来可以被 Autodesk Assistant 直接发现和调用
* Assistant 将作为跨 Fusion、Revit 等产品的 AI 编排层

([Autodesk Platform Services][10])

这既是威胁，也是晓量最重要的机会。

Autodesk 很可能不会自己开发：

* 中国医院建筑审图
* 中国钢结构算量
* 变压器工程图理解
* 北京地区企业标准检查
* 中国定额计价
* 某设计院内部规则
* 某检测机构业务流程

它更可能提供底座，再让垂直产品通过 MCP 补充。

---

# 八、晓量真正会被覆盖的部分

下面这些建议直接停止作为核心宣传点：

## 1. “能够和 AutoCAD 对话”

官方已经有。

## 2. “能够数图纸里的对象”

官方已经有，而且原生聚合通常会比 LLM 自己遍历实体更快、更稳定。

## 3. “能够查询图层、块、文字和属性”

官方已经有。

## 4. “能够选中并定位到对象”

官方已经有。

## 5. “能够检查图层、颜色、线型是否符合模板”

官方已经有。

## 6. “能够根据自然语言生成简单参数化零件”

Fusion 已经可以做到相当程度。

## 7. “能够创建 Revit 视图、明细表和图纸”

Revit Assistant 已经开始覆盖。

这些可以继续作为晓量功能，但不能再作为融资、科研或产品竞争力的核心表述。

---

# 九、晓量没有被覆盖、也应该重点占领的部分

## 1. 跨格式工程理解

```text
DWG + DXF + PDF + 图片 + Office + 计算书 + 规范 + BIM
```

Autodesk Assistant 当前以正在运行的单个 Autodesk 产品和当前模型上下文为中心。

晓量应该以**项目**为中心，而不是以某个 CAD 会话为中心。

## 2. 实体与视觉融合

同一个结论同时绑定：

* DWG Handle
* 几何坐标
* 图层和块
* 局部截图
* OCR/视觉识别结果
* 对应图纸编号
* 对应设计说明
* 对应规范条款
* 计算过程

这是你们数形结合路线中最重要的资产。

## 3. Drawing IR 与工程语义图

官方 MCP 给的是某个产品的对象。

晓量需要形成跨产品统一表达：

```text
Source Entity
  ↓
Drawing IR
  ↓
Geometry / Topology Graph
  ↓
Engineering Semantic Graph
  ↓
Task-specific DesignSpec
```

例如 AutoCAD 的几个 Polyline 和 Text，经过晓量处理后应变成：

```text
建筑房间
├── 边界
├── 面积
├── 使用功能
├── 所属防火分区
├── 门
├── 疏散方向
├── 相邻空间
├── 图纸来源
└── 证据置信度
```

这不是 AutoCAD 原生实体查询能直接给出的。

## 4. 跨图纸关系

包括：

* 平面与立面对应
* 平面与剖面对应
* 构件编号与详图对应
* 图纸与设计说明对应
* 构件与材料表对应
* 图纸与计算书对应
* 不同专业间的空间冲突
* 设计变更前后影响范围

官方当前公开能力仍以单一当前模型或图纸为主。

## 5. 工程算法算子

例如：

* 面积边界闭合与净面积
* 扣除规则
* 构件合并拆分
* 多边形拓扑
* 孔洞识别
* 体积计算
* 重叠和碰撞
* 图纸比例恢复
* 尺寸链校验
* 数量归并
* 构件分类
* 定额映射
* 材料和成本计算

这些应成为可测试、可复用、确定性的 Tool，而不是让 LLM 临时计算。

## 6. 工程结果验证

每个结果要带：

* 输入实体
* 规则版本
* 算法版本
* 计算公式
* 中间结果
* 截图证据
* 置信度
* 异常项
* 人工复核状态
* 可重放日志

官方 MCP 解决的是“怎么操作 Autodesk”，晓量应该解决的是：

> “这个工程结论为什么可信。”

## 7. 中国专业规范与企业知识

例如：

* 建筑防火
* 医院建筑
* 无障碍
* 结构构造
* 机电设计
* 钢结构加工
* 工程量计算规则
* 定额清单
* 企业图层和出图标准
* 设计院审图要点

这一层既需要知识，也需要把规范转成**可执行检查器**。

---

# 十、晓量应该重新定义为哪一层

建议以后统一用下面这个定位：

> **晓量不是另一个 Autodesk Assistant，而是面向工程任务的专业执行与验证层。**

或者更技术化地说：

> **晓量是 Engineering Task Compiler + Domain Runtime + Verification System。**

三层关系可以这样表达：

```text
第一层：Autodesk 原生数据与执行
AutoCAD / Revit / Fusion / APS / 官方 MCP

第二层：晓量工程中间层
Drawing IR / BIM IR / Part IR
拓扑图 / 语义图 / 证据图
中国规范 / 企业规则 / 工程算子

第三层：晓量任务产品
算量 / 审图 / 设计修改 / 翻模
会审 / 清单 / 报量 / 变更 / 交付
```

一句容易对外解释的话：

> **Autodesk Assistant 负责操作软件，晓量负责完成工程。**

---

# 十一、建议立即调整的技术架构

## 1. 把 AutoCAD、Revit、Fusion 都降级为 Provider

不要让晓量核心逻辑绑定 COM 命令或某个软件。

统一抽象：

```text
query_entities
aggregate_entities
get_properties
select_entities
zoom_to_entities
capture_view
export_view
modify_properties
create_geometry
check_template
save_document
```

Provider 可以分别是：

```text
AutoCAD MCP Provider
AutoCAD COM Provider
MLight Provider
ODA/RealDWG Provider
Revit MCP Provider
Revit API Provider
Fusion MCP Provider
APS Data Model Provider
PDF/Image Provider
```

Agent 只声明所需能力，不关心最终由谁执行。

## 2. AutoCAD MCP 的合理定位

当前不应替代 MLight 和 COM，而应该作为：

* 当前选择上下文读取
* 快速属性查询
* 快速计数
* 原生定位与选择
* 模板标准检查
* 原生对象 Schema 发现

MLight/独立解析负责：

* 全量抽取
* 后台并行
* 无 AutoCAD 环境
* Web 预览
* Drawing IR 建立
* 批量任务

COM/ObjectARX 继续负责：

* 尚未被官方 MCP 开放的写入
* Plot
* 命令调用
* 自定义插件操作
* 特殊对象处理

## 3. 不要直接围绕官方七个工具重写业务

七个工具处于 Tech Preview，工具名称、字段和权限边界仍可能变化。

应该增加一层 Capability Adapter：

```text
晓量任务
  ↓
标准能力接口
  ↓
能力路由器
  ├── Official MCP
  ├── COM
  ├── MLight
  ├── APS
  └── 自研算法
```

这样将来官方 MCP 变强，晓量就减少自研调用；官方 MCP 不可用时，仍可切回自己的实现。

---

# 十二、建议把晓量发布成什么样的 MCP

将来进入 Autodesk Marketplace 时，不要发布“查询图层”这种官方已有能力，而应发布专业工具，例如：

```text
analyze_building_drawing_set
resolve_cross_sheet_reference
extract_room_and_boundary_graph
calculate_quantity_with_evidence
review_against_chinese_building_code
check_hospital_design_requirements
detect_plan_section_inconsistency
validate_transformer_component_dimensions
generate_quantity_audit_package
evaluate_design_change_impact
verify_generated_cad_model
```

用户在 Autodesk Assistant 中说：

> 检查这个医院项目的疏散与防火分区问题，并给出图纸位置和规范依据。

Assistant 可以：

1. 用官方 Revit/AutoCAD MCP 取得模型对象
2. 调用晓量 MCP 做中国医院建筑专业分析
3. 晓量返回问题、证据、坐标、规范和修改建议
4. Assistant 再调用官方能力选中对象或修改模型

此时 Autodesk 不再只是竞争对手，也会成为晓量的分发渠道。

---

# 十三、应立即用 EBB-AEC-100 做一次官方能力穿透测试

建议把现有 100 道题重新标记成四组。

## A 组：官方原生层，20 题

例如：

* 查询指定图层对象
* 块数量统计
* 文字内容检索
* 闭合多段线查询
* 按属性筛选
* 定位对象
* 图层标准检查

这组很可能 Autodesk Assistant 占优。

## B 组：工程语义层，25 题

例如：

* 哪些线组成房间边界
* 某编号对应哪个构件
* 某区域是什么功能
* 某构件属于哪个系统
* 图例与实例的对应关系

这组用来证明晓量的语义优势。

## C 组：跨图与多模态层，25 题

例如：

* 平面、剖面、详图之间的关联
* 设计说明与图纸冲突
* PDF 与 DWG 数据对应
* 图元数据与局部截图联合判断
* 多张图纸上的同一构件追踪

这组是官方当前最弱的位置。

## D 组：工程结果层，30 题

例如：

* 面积与工程量计算
* 审图问题识别
* 修改方案生成
* 执行修改
* 修改后验证
* 证据报告生成
* 数值复算与误差检查

最终不能只比较“回答像不像”，而要比较：

* 任务成功率
* 实体召回率和准确率
* 数值误差
* 工具调用成本
* 完成时间
* 是否有证据
* 是否可重放
* 是否能验证
* 是否输出可用交付物

跑完以后，你们会得到一个非常有价值的结论：

> 哪些能力直接采用官方，哪些能力继续自研，哪些能力才是晓量真正的护城河。

---

# 十四、最后的战略判断

## 当前

**Autodesk 已经基本覆盖“AI 操作 CAD 的通用交互层”，尚未覆盖“跨图纸、跨格式、跨专业的工程任务闭环”。**

## 中期

Autodesk 会快速补齐：

* 更多对象类型
* AutoCAD 写入
* Revit Write MCP
* 云端 Automation
* 数据模型 API
* Agent 编排
* 第三方 MCP 调用

这一方向已经由 Revit Write Server 规划、Fusion Automation MCP、AEC Data Model 和 Marketplace 公开路线共同体现。([Autodesk][6])

## 对晓量真正的生死线

不是看 Autodesk 会不会增加“算面积”按钮，而是看晓量能否尽快从：

> CAD 工具调用器

升级成：

> 工程语义、工程算法、专业规则、任务验证和结果交付系统。

最准确的一句话是：

> **Autodesk 正在覆盖晓量的“手和脚”，但还没有覆盖晓量应该成为的“工程大脑、专业技能和质检体系”；假如晓量继续停留在手和脚，就一定会被覆盖。**

[1]: https://help.autodesk.com/view/ADSKMCP/ENU/ "https://help.autodesk.com/view/ADSKMCP/ENU/"
[2]: https://www.autodesk.com/solutions/autodesk-ai/autodesk-assistant "https://www.autodesk.com/solutions/autodesk-ai/autodesk-assistant"
[3]: https://help.autodesk.com/view/ADSKMCP/ENU/?guid=autocadcivil3dmcp_tools "https://help.autodesk.com/view/ADSKMCP/ENU/?guid=autocadcivil3dmcp_tools"
[4]: https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_AutoCADCivil3DMcp_autodesk_autocad_civil_3d_mcp_html "https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_AutoCADCivil3DMcp_autodesk_autocad_civil_3d_mcp_html"
[5]: https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-WhatsNew/files/GUID-0BBFEE0C-6FBF-4067-B8C0-3CD67D9CEAE3.htm "https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-WhatsNew/files/GUID-0BBFEE0C-6FBF-4067-B8C0-3CD67D9CEAE3.htm"
[6]: https://www.autodesk.com/blogs/aec/2026/06/17/revit-public-mcp-server/ "https://www.autodesk.com/blogs/aec/2026/06/17/revit-public-mcp-server/"
[7]: https://www.autodesk.com/blogs/aec/2026/04/22/autodesk-assistant-in-revit-tech-preview/ "https://www.autodesk.com/blogs/aec/2026/04/22/autodesk-assistant-in-revit-tech-preview/"
[8]: https://www.autodesk.com/products/fusion-360/blog/how-to-improve-your-fusion-workflow-with-the-claude-desktop-connector/ "https://www.autodesk.com/products/fusion-360/blog/how-to-improve-your-fusion-workflow-with-the-claude-desktop-connector/"
[9]: https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_KnowledgeMcp_autodesk_product_help_mcp_server_html "https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_KnowledgeMcp_autodesk_product_help_mcp_server_html"
[10]: https://aps.autodesk.com/blog/building-agentic-ai-whats-new-autodesk-platform-services "https://aps.autodesk.com/blog/building-agentic-ai-whats-new-autodesk-platform-services"
[11]: https://aps.autodesk.com/developer/overview/manufacturing-data-model-api "https://aps.autodesk.com/developer/overview/manufacturing-data-model-api"
[12]: https://www.autodesk.com/solutions/autodesk-ai/autodesk-mcp-servers "https://www.autodesk.com/solutions/autodesk-ai/autodesk-mcp-servers"
