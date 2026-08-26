# 002 — DDD 与 Ontology 领域模型

## 1. 建模原则

沈变 Ontology 从业务决策和受控动作出发。首期只覆盖两个问题：

1. 某个图纸版本能否安全生成生产 DXF？
2. 某个铁芯图纸版本是否与参数明细一致？

CAD 图元是工程证据，不等同于全部业务对象。直线、圆弧、文字等高体量事实保存在 Data Layer；只有具备稳定身份、业务含义、生命周期或可执行动作的内容进入运营对象层。

## 2. 限界上下文

### 2.1 Data Asset Registry

管理客户原文、抽取快照、知识文件和派生产物的身份、哈希、来源、敏感级别及存储位置。

核心聚合：`DataAsset`、`ExtractionSnapshot`。

### 2.2 Drawing Intelligence

管理图纸业务身份、版本、视图和工程特征。负责把 Data Layer 的图元事实提升为主制造区域、轮廓、孔位、标注和专业对象等可审查特征。

核心聚合：`Drawing`，聚合内含 `DrawingRevision`；`EngineeringFeature` 以抽取快照为事实来源。

### 2.3 Knowledge and Rules

管理标准、企业规定和校验规则的适用范围、版本、公差、证据要求与发布状态。

核心聚合：`RuleVersion`。规则版本一经用于正式校验即不可原地修改，修订生成新版本。

### 2.4 Review Operations

管理审查任务、每次执行、候选发现、人工确认、豁免、复核和报告发布。

核心聚合：`ReviewTask`；一次具体执行为 `CheckRun`。算法输出先形成 `Finding`，经确认后才成为业务 `Issue`。

### 2.5 Artifact Delivery

管理 DWG 工作副本、DXF、差异叠加、证据包和校审报告。每个产物必须追溯到输入版本、校验运行和规则版本。

核心聚合：`Artifact`、`Approval`。

## 3. 首期 Object

### `ProductProject`

沈变产品项目或设计任务上下文。首轮允许信息不完整，但需保留正式项目号的扩展位置。

### `DataAsset`

文件或数据集的不可变身份。关键属性包括资产 ID、内容哈希、媒体类型、来源、敏感级别和存储引用。

### `Drawing`

稳定图纸身份，通常由受控图号识别。文件名不直接等同于图纸身份。

### `DrawingRevision`

某张图纸在一个时间点的具体版本。关键属性包括版本、源资产、CAD 格式、图签信息和发布状态。

### `ExtractionSnapshot`

某个图纸版本经指定宿主、抽取器和 schema 生成的不可变事实快照。相同图纸版本可以有多次不同抽取快照。

### `EngineeringFeature`

从图元事实提升出的工程特征。首期类型包括制造区域、外轮廓、内轮廓、孔、标注、标题栏、明细行和天河专业标注。

### `ParameterSet`

参数明细在指定版本下的结构化集合。铁芯场景中保存级次、轮廓和孔位重建所需字段及单位。

### `RuleVersion`

可执行规则的冻结版本，包含来源条款、适用范围、公差、严重度和证据要求。

### `ReviewTask`

围绕一个或多个图纸版本发起的业务任务，任务类型首期为 `dxf_purification` 或 `lamination_consistency`。

### `CheckRun`

一次确定的执行记录，冻结输入资产、快照、规则包、算法版本和执行环境。

### `Finding`

系统产生的候选发现，包含状态、置信度、位置和证据。Finding 尚未代表正式缺陷结论。

### `Issue`

经规则或人工流程确认的业务问题，具有责任人、严重度、处置和关闭状态。

### `Evidence`

支撑 Finding 或 Issue 的原值、期望值、公差、图元句柄、坐标、截图或差异几何。

### `Artifact`

处理生成的工作副本、DXF、报告或证据包。Artifact 必须保留派生链和校验状态。

### `Approval`

对高风险动作、人工豁免或正式发布的批准记录。

## 4. 关键 Link

- `Drawing BELONGS_TO ProductProject`
- `DrawingRevision REVISION_OF Drawing`
- `DrawingRevision BACKED_BY DataAsset`
- `ExtractionSnapshot EXTRACTED_FROM DrawingRevision`
- `EngineeringFeature OBSERVED_IN ExtractionSnapshot`
- `ParameterSet DESCRIBES DrawingRevision`
- `ReviewTask USES DrawingRevision`
- `CheckRun EXECUTES ReviewTask`
- `CheckRun APPLIES RuleVersion`
- `Finding PRODUCED_BY CheckRun`
- `Finding TARGETS EngineeringFeature`
- `Finding SUPPORTED_BY Evidence`
- `Issue CONFIRMED_FROM Finding`
- `Artifact DERIVED_FROM DrawingRevision`
- `Artifact VALIDATED_BY CheckRun`
- `Approval AUTHORIZES Artifact` 或高风险 Action

## 5. Action 设计

Action 是有业务含义的命令，不向 Agent 直接暴露任意 SQL、任意文件写入或低层 `delete_entity`。

### DXF 图纸净化

- `create_dxf_purification_task`
- `confirm_manufacturing_region`
- `preview_dxf_purification`
- `generate_dwg_working_copy`
- `validate_manufacturing_geometry`
- `export_production_dxf`
- `submit_artifact_for_review`

### 铁芯叠片一致性校验

- `create_lamination_review_task`
- `pair_drawing_and_parameter_versions`
- `reconstruct_expected_lamination`
- `align_lamination_views`
- `run_lamination_consistency_check`
- `disposition_finding`
- `rerun_review_task`
- `publish_review_report`

### Action 公共契约

每个动作必须声明：

- 输入对象类型和输出对象类型；
- 前置条件和业务不变量；
- 风险级别：只读、可逆写入、外部副作用；
- 允许角色和是否需要人工批准；
- 幂等键和重复提交语义；
- 审计事件和证据要求；
- 失败后的回滚或补偿动作。

## 6. 第一条聚合不变量

1. `DrawingRevision` 一经被正式 `CheckRun` 使用，源资产和内容哈希不得修改。
2. `CheckRun` 必须冻结输入快照、规则版本和算法版本。
3. `Finding` 与正式 `Issue` 分离，模型或算法不能绕过确认策略直接关闭问题。
4. `Artifact` 必须派生自工作副本；原始 `DataAsset` 永远只读。
5. `export_production_dxf` 只有在制造几何校验通过后才允许执行。
6. 外部副作用 Action 必须具备审批、幂等和完整审计记录。

