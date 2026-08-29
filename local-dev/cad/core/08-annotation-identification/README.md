# 08 · 全图标注识别

`AnnotationIdentifier.cs` 是宿主无关 Core；THCAD 实体只在 Adapter 中转换为普通类型、文字、包围盒、二维点和句柄，Core 不引用 Teigha/BricsCAD。

## 与 04、07 的边界

- 04 从机械明细表出发，回答“某行物料对应哪些 `TH_XuHaoEntity` 序号标注”，用于 Agent 取表格知识、定位序号指向端和局部出图。
- 07 从中心线文字与 `CENTER*` 样式出发，回答“哪些基础几何是中心线/中心几何”。
- 08 从全图标注出发，回答“有哪些标注、显示什么、几何定义在哪里、由哪些实体组成，以及以后成组去标注要处理哪些句柄”。

三者允许保留同一实体。例如 `器身中心线` 的 `TH_DimLeaderUA` 同时是 07 的中心线证据和 08 的文字引线；`TH_XuHaoEntity` 同时进入 04 的明细表关系和 08 的全图序号清单，不做互斥去重。

## 当前识别口径

确定性实体类型：

- `Dimension` 子类归为 `dimension`，保留测量值、文字覆盖、样式、文字位置和定义点；当前适配 Rotated、Aligned、Diametric、Radial、RadialLarge、LineAngularDimension2、Ordinate。
- `TH_DimLeaderUA` 归为 `text_leader`，通过只读 `Explode` 取得可见纯文字，中心线说明不排除。
- 普通 `Leader`、未来的 `MLeader` 分别归为 `leader/text_leader`、`multileader`；能读取关联文字时保留文字，读不到时仍保留引线实体与顶点。
- `TH_XuHaoEntity` 归为 `serial_balloon`，保留可取得时的序号、指向侧和序号侧坐标；这里不要求它必须能关联到 04 的明细行。
- `TH_DimRough*`、`TH_ParaBasePntUA`、`TH_CVArrowLine` 分别归为粗糙度符号、基准参考符号和符号箭头。前两类当前只能确定实体类别，粗糙度值和基准字母仍不可解码，输出不得臆造。

普通实体组合：

- 字母方向标记由同一坐标空间、同一图层和颜色的 `Line + Solid` 先组成带填充三角箭头，再关联邻近的单个大写字母 `DBText/MText`。
- 箭头方向取“线段外端 → 与 Solid 接触端”的单位向量，文字只作为标签，不从 P、Q、A、B 等字母推断业务含义。
- 组合记录保留三个源句柄和三个成组移除候选句柄；块定义内组合会标为共享块定义候选，不能直接当成模型空间孤立对象删除。

截图对应的 P/Q 已由既有抽取数据核实：P 为 `3EF2C Line + 3EF2D Solid + 3EF2E Text`，方向向左；Q 为 `3EF2F Line + 3EF30 Solid + 3EF31 Text`，方向向右。它们不是 `TH_CVArrowLine`，当前只命名为 `direction_marker`，`meaning_status=business_meaning_unresolved`。

## 输出

整图抽取新增：

- `annotation-identification.json`：分类、显示文字、测量值、尺寸定义点、方向、所属空间、证据、置信度、源句柄与成组移除候选句柄；
- `annotation-identification.md`：面向人和 LLM 的分类摘要与口径说明；
- `semantic-objects.json.annotations` 与 `extraction-report.json` 的标注统计。

`removal_candidate_handles` 只是后续“在副本中去标注”的输入清单。本能力没有 `Erase`、没有保存 DWG，也不把共享块定义中的候选标成可直接删除。正式去标注应另做有状态 THCAD Adapter 工具，默认复制源图、按组合删除、重开校验，并生成删除前后句柄审计。

## 验证

七张现有抽取样本回归：

- 确定性标注 1,203 条：743 个尺寸、178 个序号、177 个天河文字引线、10 个普通 Leader、6 个粗糙度符号、87 个基准参考符号、2 个 `TH_CVArrowLine`；
- 另由普通实体组成 7 个字母方向标记，包括样图 P/Q 和同类 A/B/C/D；
- 29 个含“中心线”的文字引线仍完整进入 08，证明没有因 07 的既有用途而排除。

2026-08-28 在当前 THCAD 活动图 `5TBC.384.A110050.2_1.DWG` 上只读执行 `SHBEXTRACT`：3,570 个实体、0 失败、168 条标注；首个 `AcDbRotatedDimension` 同时取得测量值 575 及 `xline1/xline2/dimension_line` 定义点。图纸执行前后均保持未保存状态，输出明确记录 `recognition_only_no_entities_modified`。因为该图当时有未保存改动，THCAD 的 `WorkingDatabase.Filename` 指向自动保存 `SV$`，派生输出目录因此带临时后缀；这不改变识别数据，也不能把临时文件名当正式图纸 ID。

## 当前不纳入

不把所有散落 `DBText/MText` 都当标注。未绑定箭头、引线、尺寸或专用标注实体的文字可能属于标题栏、明细表、技术要求或图形正文；在没有结构证据时全收会直接破坏后续“去标注”的安全性。新型块标注、剖切符号、焊接符号或其他组合出现后，应先保留样例句柄和几何证据，再增加独立分类器。

