# THCAD V24 .NET 公开能力盘点

> 生成日期：2026-08-27  
> 实测安装目录：`D:\THSOFT\THCAD V24_Mechanical2D\THCAD`  
> 生成器：`dev-test/visualstudionetframework/probes/ExportThcadDotNetApiInventory.ps1`

## 0. 结论和口径

本机 THCAD V24 安装目录中可识别出 **7 个托管程序集、1647 个公开类型、5601 个公开方法重载、5087 个公开属性、222 个公开事件、1196 个公开构造器、7885 个公开字段**。字段总数包含枚举常量；完整成员索引不展开枚举值。本盘点没有排除写入、创建、修改、删除、变换、保存、事务、编辑器交互等能力。

这里盘的是 **公开 .NET API 能力面**，与 `docs/thcad-extract-fields/` 的 **JSON 键级库存** 是两条不同维度：字段库存回答「当前抽取器已经保存了什么」，本篇回答「本机程序集还公开了哪些可调用入口」。`ExplodeGeometry` 正是后一个维度中的方法，旧字段库存不会自动出现它的计算结果。

附录按程序集、命名空间、类型列出全部公开声明成员。为保持可读性：方法重载合并为同一个名字并用 `×N` 标出数量；属性标明 `get` / `set`；构造器只记数量；枚举类型全部列出但不展开每个枚举值；继承成员只在声明它的基类列一次。不存在「只读白名单」。

边界也要说清：这是安装目录中 **公开托管 .NET 程序集** 的完整元数据盘点。其他能力面已经分别落文档：[`COM Automation`](2026-08-27-THCAD-V24-COM-Automation能力盘点.md)、[`LISP 与命令`](2026-08-27-THCAD-V24-LISP与命令能力盘点.md)、[`原生 BRX/ARX 与 PE 导出`](2026-08-27-THCAD-V24-原生BRX-ARX与PE导出能力盘点.md)；统一入口见 [`THCAD V24 能力面总索引`](2026-08-27-THCAD-V24-能力面总索引.md)。天河未公开的私有实现可以继续做运行时和二进制研究，但不能假装由一次公开元数据扫描完整覆盖。

API 被列出不等于每个天河专业对象都实现了相同行为。例如 `TH_XuHaoEntity` 的 `Entity.Explode` 返回 `eNotApplicable`，但 `Entity.ExplodeGeometry` 成功。是否对具体 `runtime_class` 有效，需要另做运行时支持矩阵；这不影响它作为公开能力被完整登记。

## 1. 程序集规模

| 程序集 | 版本 | 公开类型 | 方法重载 / 方法名 | 属性 | 事件 | 构造器 | 字段 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `BrxMgd` | 23.2.4.0 | 544 | 1330 / 684 | 1060 | 122 | 390 | 4653 |
| `TA_Mgd` | 23.9.0.0 | 32 | 27 / 18 | 47 | 0 | 20 | 40 |
| `TA_MgdArch` | 0.0.0.0 | 30 | 39 / 21 | 50 | 0 | 26 | 37 |
| `TA_MgdStructure` | 0.0.0.0 | 13 | 27 / 18 | 32 | 0 | 10 | 22 |
| `TD_Mgd` | 23.9.0.0 | 940 | 3982 / 1722 | 3736 | 100 | 697 | 3057 |
| `TD_MgdBrep` | 0.0.0.0 | 57 | 64 / 27 | 81 | 0 | 19 | 42 |
| `TD_MgdDbConstraints` | 0.0.0.0 | 31 | 132 / 123 | 81 | 0 | 34 | 34 |

程序集 SHA-256：

- `BrxMgd.dll`：`681409b6f5f4027d8b49a85a483ebf8bab0629f2f8276e6924a14df93f6f5197`
- `TA_Mgd.dll`：`cee01b43173e7b85772c2c275646e5b81b2a30cea70b5cb31788fb10301b6f87`
- `TA_MgdArch.dll`：`9899e1e9026f5fa05cbdc744e3a1a60965a120222eaae9a93a343d71dacfeb6e`
- `TA_MgdStructure.dll`：`1db117991751dab0c05348b18b7ac7b6638459b24a8756919c139af23689504b`
- `TD_Mgd.dll`：`d43b49106390a7d709f05e6b677d7a37610dd9e8b69007be2b3e192d5c92102f`
- `TD_MgdBrep.dll`：`209f5155f6f6b80ab9896cefb7e5234f26049337cf9d94cda4c513a6238eed81`
- `TD_MgdDbConstraints.dll`：`dc2820875817c259882d16b351b7ab6c6aafa28cbb04a94c15f359a0431e2608`

## 2. 能力总览（包含读取与写入）

下面只做导航，完整方法名在附录。

### 2.1 DWG / DXF / 数据库生命周期

`Database` 公开了 `ReadDwgFile`、`ReadDwgFileFromMemory`、`Save`、`SaveAs`、`DxfIn`、`DxfOut`、`Wblock`、`Insert`、`AttachXref`、`OverlayXref`、`BindXrefs`、`DetachXref`、`ReloadXrefs`、`UnloadXrefs`、`Audit`、`Purge`、`Undo`、`Redo`、`AddDBObject`、`DeepCloneObjects`、`WblockCloneObjects` 等。也就是说文件读取、写回、另存、导入导出、外参、清理、审计、克隆和撤销并未从盘点中排除。

### 2.2 对象生命周期、事务与持久化

`DBObject` / `Transaction` / `TransactionManager` 包含 `GetObject`、`AddNewlyCreatedDBObject`、`Commit`、`Abort`、`UpgradeOpen`、`DowngradeOpen`、`Erase`、`DeepClone`、`WblockClone`、`HandOverTo`、`SwapIdWith`、`SetField`、`RemoveField`、`CreateExtensionDictionary`、`ReleaseExtensionDictionary`、`DwgIn` / `DwgOut`、`DxfIn` / `DxfOut`、XData 和 reactor 操作。

### 2.3 实体几何、计算、分解和直接修改

`Entity` 同时公开 `GeometricExtents`、`Explode`、`ExplodeGeometry`、`ExplodeGeometryToBlock`、`ExplodeGeometryToOwnerSpace`、`GetGripPoints`、`MoveGripPointsAt`、`GetStretchPoints`、`MoveStretchPointsAt`、`GetObjectSnapPoints`、`IntersectWith`、`BoundingBoxIntersectWith`、`JoinEntity` / `JoinEntities`、`TransformBy`、`GetTransformedCopy`、`SetPropertiesFrom`、`SetDatabaseDefaults`、高亮、拖拽和子实体路径操作。这里既有计算，也有明确的修改能力。

### 2.4 曲线计算与编辑

`Curve` 公开最近点、点↔参数↔距离互算、一二阶导数、投影、正交投影、偏移、分割、延伸、反向及 `SetFromGeCurve`：`GetClosestPointTo`、`GetPointAtParameter`、`GetPointAtDist`、`GetParameterAtPoint`、`GetParameterAtDistance`、`GetDistanceAtParameter`、`GetDistAtPoint`、`GetFirstDerivative`、`GetSecondDerivative`、`GetProjectedCurve`、`GetOrthoProjectedCurve`、`GetOffsetCurves`、`GetSplitCurves`、`Extend`、`ReverseCurve`。

### 2.5 块、属性、图层、字典和表

包含 `BlockTableRecord.AppendEntity`、`AssumeOwnershipOf`、`BlockReference.ExplodeToOwnerSpace`、`ConvertToStaticBlock`、`ResetBlock`、动态块属性集合、Attribute / AttributeDefinition、Layer / Linetype / TextStyle / DimStyle 等符号表、`DBDictionary` / `Xrecord`、Group、Layout、DataLink 和表格对象的增删改查入口。

### 2.6 二维图元、文字、标注、填充和打印

Line、Polyline、Arc、Circle、Ellipse、Spline、Region、Hatch、DBText、MText、Dimension、Leader、MLeader、Table、Viewport、PlotSettings 等类型均在完整索引中。`Hatch` 例如同时提供 `AppendLoop`、`InsertLoopAt`、`RemoveLoopAt`、`EvaluateHatch`、`SetHatchPattern`、`SetGradient` 以及边界和图案读取。

### 2.7 三维实体、曲面、网格和 B-Rep

`Solid3d` 具备布尔运算、拉伸、旋转、放样、扫掠、倒角、圆角、抽壳、切片、干涉检查、投影、面/边复制与材料修改；`Surface` 具备布尔、偏移、修剪、加厚、切片、投影和 NURBS 转换；`TD_MgdBrep` 另外公开 B-Rep 拓扑遍历类型。创建和修改能力均已登记。

### 2.8 参数与几何约束

`TD_MgdDbConstraints` 公开几何约束、尺寸约束、约束组、变量和值依赖相关类型与方法。它不仅能查询，也包含添加、删除、求值和更新类入口；完整名称见该程序集附录。

### 2.9 编辑器、选择、命令与交互

`Bricscad.EditorInput.Editor` 公开 `Command` / `CommandAsync`、各种 `Get*` 输入、`GetSelection`、`SelectAll`、窗口/交叉/围栏/多边形选择、`SetImpliedSelection`、`Drag`、`Snap`、`TraceBoundary`、视图切换、重生成和屏幕更新。`Document` / `DocumentCollection` 还提供打开、创建、关闭保存、关闭丢弃、锁文档和应用上下文执行。

### 2.10 应用、事件、图形系统和插件入口

`BrxMgd` 包含 Application / Document / Window / Runtime / EditorInput / GraphicsSystem / PlottingServices 等命名空间，既有命令注册与事件，也有文档、视图、绘制、打印和宿主交互能力。122 个公开事件已完整计数并在类型索引中列名。

### 2.11 TA 建筑与结构扩展

`TA_Mgd`、`TA_MgdArch`、`TA_MgdStructure` 共公开 75 个类型，覆盖 AEC / 建筑 / 结构相关对象接口。它们与天河机械 `TH_*` 私有业务对象不是同一层，但属于本机 THCAD 安装公开的托管能力，因此没有删除。

## 3. 已经实测过的方法能力

- `Entity.Explode`：普通部分专业对象可用；`TH_XuHaoEntity` 实测 `eNotApplicable`。
- `Entity.ExplodeGeometry`：`TH_XuHaoEntity` 可用；七图 178 个对象全部取得序号圆中心，162 个有真实指向端，16 个对象只有序号圆和文字。
- `Entity.GetGripPoints`（旧重载）：当前序号对象取得 6 个夹点。
- `Entity.GetStretchPoints`：当前序号对象取得同一组 6 个拉伸点。
- `Entity.GetObjectSnapPoints`：当前序号对象取得端点和圆心捕捉点。
- `Entity.GeometricExtents` 属性：当前序号对象读取时返回 `eInvalidExtents`，说明成员存在但该对象实现不可用。

### 3.1 2026-08-30 V4 产品桥新增实测

- `CommandFlags.Session`：`SHBTHCADAGENTV4APP` 已在运行中的 THCAD V24 热加载并成功执行文档生命周期作业；Modal/Session 两个命令能按 request operation 分开认领同一 pending 队列。
- `DocumentCollection.Open(path, readOnly)`：成功只读打开另一张客户 DWG，`Document.IsReadOnly=true`；该 V24 会话打开后 DBMOD 可立即为 4，因此产品仍把非零视为 dirty，不据此猜测“没有变化”。
- `DocumentCollection.MdiActiveDocument{set}`：成功在测试图与原活动图之间切换。
- `Document.CloseAndDiscard()`：在显式 discard 后成功关闭测试图并恢复原活动图；产品不会用 `CloseAndSave` 代替用户决策。
- `Database.ReadDwgFile(path, FileOpenMode.OpenForReadAndAllShare, false, "")`：V4 `scan_texts` 用 side database 一次扫描七张样图，7/7 成功、5,543 条文字/BOM/标题栏记录，活动图与 DBMOD 不变。
- `Database.SaveAs`：对工作区新目标的实测成功；简单重载和显式 `bBakAndRename=false` 重载都会让 `Database.Filename` 指向副本，而实测 `Document.Name` / `Document` 路径仍保持源图。产品桥将此作为显式 `from_session` 能力并回传前后路径事实，不把它描述为无状态的 side-DB 复制。
- `Database.Save()`：对 `DocumentManager.Open` 的活动工作区图实测返回 `eCantOpenFile`；同一图的 `Document.AcadDocument.Save` 成功并把 DBMOD 从 5 清为 0，因此当前产品桥保存已打开工作区图使用后一个已验证入口。这个结果只说明当前 V24/调用上下文，不否定 `Database.Save` 在其他数据库生命周期中的公开能力。

实现、路径守卫与复现结果见 [`2026-08-30-Pi-THCAD-图纸会话与项目文字检索.md`](2026-08-30-Pi-THCAD-图纸会话与项目文字检索.md)。

## 4. 命名空间索引

| 程序集 | 命名空间 | 公开类型数 |
| --- | --- | ---: |
| `BrxMgd` | `(global)` | 2 |
| `BrxMgd` | `Bricscad.ApplicationServices` | 50 |
| `BrxMgd` | `Bricscad.ApplicationServices.Core` | 2 |
| `BrxMgd` | `Bricscad.Bim` | 33 |
| `BrxMgd` | `Bricscad.Civil` | 82 |
| `BrxMgd` | `Bricscad.CivilExtensions` | 1 |
| `BrxMgd` | `Bricscad.DirectModeling` | 7 |
| `BrxMgd` | `Bricscad.EditorInput` | 120 |
| `BrxMgd` | `Bricscad.Global` | 2 |
| `BrxMgd` | `Bricscad.GraphicsSystem` | 9 |
| `BrxMgd` | `Bricscad.Ifc` | 24 |
| `BrxMgd` | `Bricscad.Internal` | 8 |
| `BrxMgd` | `Bricscad.Licensing` | 8 |
| `BrxMgd` | `Bricscad.MechanicalComponents` | 5 |
| `BrxMgd` | `Bricscad.Parametric` | 16 |
| `BrxMgd` | `Bricscad.PlottingServices` | 43 |
| `BrxMgd` | `Bricscad.Private.Windows` | 3 |
| `BrxMgd` | `Bricscad.Publishing` | 32 |
| `BrxMgd` | `Bricscad.Quad` | 8 |
| `BrxMgd` | `Bricscad.Rhino` | 1 |
| `BrxMgd` | `Bricscad.Ribbon` | 2 |
| `BrxMgd` | `Bricscad.Runtime` | 5 |
| `BrxMgd` | `Bricscad.Windows` | 79 |
| `BrxMgd` | `Microsoft.VisualC.MFC` | 2 |
| `TA_Mgd` | `Teigha.Aec` | 1 |
| `TA_Mgd` | `Teigha.Aec.DatabaseServices` | 22 |
| `TA_Mgd` | `Teigha.Aec.Geometry` | 6 |
| `TA_Mgd` | `Teigha.Aec.Modeler` | 2 |
| `TA_Mgd` | `Teigha.Runtime` | 1 |
| `TA_MgdArch` | `Teigha.Aec.Arch.DatabaseServices` | 26 |
| `TA_MgdArch` | `Teigha.Aec.Arch.Geometry` | 3 |
| `TA_MgdArch` | `Teigha.Runtime` | 1 |
| `TA_MgdStructure` | `Teigha.Aec.Structural.DatabaseServices` | 13 |
| `TD_Mgd` | `Teigha.Colors` | 9 |
| `TD_Mgd` | `Teigha.DatabaseServices` | 569 |
| `TD_Mgd` | `Teigha.DatabaseServices.Filters` | 10 |
| `TD_Mgd` | `Teigha.Export_Import` | 19 |
| `TD_Mgd` | `Teigha.Geometry` | 113 |
| `TD_Mgd` | `Teigha.GraphicsInterface` | 135 |
| `TD_Mgd` | `Teigha.GraphicsSystem` | 28 |
| `TD_Mgd` | `Teigha.Internal.DatabaseServices` | 1 |
| `TD_Mgd` | `Teigha.LayerManager` | 8 |
| `TD_Mgd` | `Teigha.ModelerGeometry` | 2 |
| `TD_Mgd` | `Teigha.Runtime` | 46 |
| `TD_MgdBrep` | `Teigha.BoundaryRepresentation` | 57 |
| `TD_MgdDbConstraints` | `Teigha.DatabaseServices` | 31 |

## 5. 完整公开类型与成员名索引

下面是本次元数据扫描的完整索引。方法只合并重载，不按主观用途删减；属性的 `set` 能直接暴露写入面。枚举值本身不展开。

### BrxMgd

#### `(global)`

- `HostPanelHelper` — class；构造器：1；方法：`clearData`, `hostPanel`, `OnAutoResized`, `OnDisposed`
- `QtHostPanelHelper` — class；构造器：1；方法：`hostPanel`, `OnAutoResized`

#### `Bricscad.ApplicationServices`

- `Bricscad.ApplicationServices.Application` — class；构造器：0；方法：`AddDefaultContextMenuExtension`, `AddObjectContextMenuExtension`, `DoDragDrop`, `GetSystemVariable`, `InvokeHelp`, `IsMenuGroupLoaded`, `LoadPartialMenu`, `Quit`, `RemoveDefaultContextMenuExtension`, `RemoveObjectContextMenuExtension`, `SetSystemVariable`, `ShowAlertDialog`, `ShowModalDialog`×3, `ShowModalWindow`×5, `ShowModelessDialog`×3, `ShowModelessWindow`×5, `ToSystemDrawingPoint`, `ToSystemDrawingSize`, `ToSystemWindowsPoint`, `ToSystemWindowsSize`, `UnloadPartialMenu`, `UpdateScreen`；属性：`AcadApplication{get}`, `DisplayTextScreen{get/set}`, `DocumentManager{get}`, `MainWindow{get}`, `Publisher{get}`, `StatusBar{get}`, `UserConfigurationManager{get}`, `Version{get}`；事件：`BeginDoubleClick`, `BeginQuit`, `Idle`, `PreTranslateMessage`, `QuitAborted`, `QuitWillStart`, `SystemVariableChanged`, `SystemVariableChanging`
- `Bricscad.ApplicationServices.BeginDoubleClickEventArgs` — class；构造器：0；属性：`Location{get}`
- `Bricscad.ApplicationServices.BeginDoubleClickEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.CommandEventArgs` — class；构造器：1；属性：`GlobalCommandName{get}`
- `Bricscad.ApplicationServices.CommandEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.ConfigurationSectionNameAttribute` — class；构造器：1；属性：`Name{get}`
- `Bricscad.ApplicationServices.Document` — class；构造器：0；方法：`CloseAndDiscard`, `CloseAndSave`, `DowngradeDocOpen`, `LockDocument`×2, `LockMode`×2, `SendStringToExecute`, `UpgradeDocOpen`；属性：`AcadDocument{get}`, `CommandInProgress{get}`, `Database{get}`, `Editor{get}`, `GraphicsManager{get}`, `IsActive{get}`, `IsNamedDrawing{get}`, `IsReadOnly{get}`, `Name{get}`, `TransactionManager{get}`, `UserData{get}`, `Window{get}`；事件：`BeginDocumentClose`, `CloseAborted`, `CloseWillStart`, `CommandCancelled`, `CommandEnded`, `CommandFailed`, `CommandWillStart`, `ImpliedSelectionChanged`, `LayoutSwitched`, `LayoutSwitching`, `LispCancelled`, `LispEnded`, `LispWillStart`, `UnknownCommand`, `ViewChanged`
- `Bricscad.ApplicationServices.DocumentActivationChangedEventArgs` — class；构造器：0；属性：`NewValue{get}`
- `Bricscad.ApplicationServices.DocumentActivationChangedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.DocumentBeginCloseEventArgs` — class；构造器：1；方法：`Veto`；属性：`IsVetoed{get}`
- `Bricscad.ApplicationServices.DocumentBeginCloseEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.DocumentCollection` — class；构造器：0；方法：`Add`, `CloseAll`, `ExecuteInApplicationContext`, `GetDocument`, `GetEnumerator`, `Open`×3；属性：`Count{get}`, `CurrentDocument{get/set}`, `DocumentActivationEnabled{get/set}`, `MdiActiveDocument{get/set}`；事件：`DocumentActivated`, `DocumentActivationChanged`, `DocumentBecameCurrent`, `DocumentCreated`, `DocumentCreateStarted`, `DocumentCreationCanceled`, `DocumentDestroyed`, `DocumentLockModeChanged`, `DocumentLockModeChangeVetoed`, `DocumentLockModeWillChange`, `DocumentToBeActivated`, `DocumentToBeDeactivated`, `DocumentToBeDestroyed`
- `Bricscad.ApplicationServices.DocumentCollectionEventArgs` — class；构造器：0；属性：`Document{get}`
- `Bricscad.ApplicationServices.DocumentCollectionEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.DocumentDestroyedEventArgs` — class；构造器：0；属性：`FileName{get}`
- `Bricscad.ApplicationServices.DocumentDestroyedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.DocumentIterator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Bricscad.ApplicationServices.DocumentLock` — class；构造器：0；方法：`Dispose`
- `Bricscad.ApplicationServices.DocumentLockMode` — enum；枚举值：7
- `Bricscad.ApplicationServices.DocumentLockModeChangedEventArgs` — class；构造器：0；方法：`Veto`；属性：`CurrentMode{get}`, `Document{get}`, `GlobalCommandName{get}`, `IsVetoed{get}`, `MyCurrentMode{get}`, `MyPreviousMode{get}`
- `Bricscad.ApplicationServices.DocumentLockModeChangedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.DocumentLockModeChangeVetoedEventArgs` — class；构造器：0；属性：`Document{get}`, `GlobalCommandName{get}`
- `Bricscad.ApplicationServices.DocumentLockModeChangeVetoedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.DocumentLockModeWillChangeEventArgs` — class；构造器：0；属性：`CurrentMode{get}`, `Document{get}`, `GlobalCommandName{get}`, `MyCurrentMode{get}`, `MyNewMode{get}`
- `Bricscad.ApplicationServices.DocumentLockModeWillChangeEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.ExecuteInApplicationContextCallback` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.IConfigurationSection` — interface；构造器：0；方法：`Close`, `Contains`, `ContainsSubsection`, `CreateSubsection`, `Delete`, `DeleteSubsection`, `OpenSubsection`, `ReadProperty`, `WriteProperty`；属性：`IsReadOnly{get}`
- `Bricscad.ApplicationServices.InplaceTextEditor` — class；构造器：0；方法：`Invoke`×2；属性：`Current{get}`
- `Bricscad.ApplicationServices.InplaceTextEditor+TextUndoType` — enum；枚举值：61
- `Bricscad.ApplicationServices.InplaceTextEditorSettings` — class；构造器：1；属性：`DefinedHeight{get/set}`, `Flags{get/set}`, `SimpleMText{get/set}`, `TabSupported{get/set}`, `Type{get/set}`
- `Bricscad.ApplicationServices.InplaceTextEditorSettings+EditFlags` — enum；枚举值：3
- `Bricscad.ApplicationServices.InplaceTextEditorSettings+EntityType` — enum；枚举值：3
- `Bricscad.ApplicationServices.LayoutSwitchedEventArgs` — class；构造器：0；属性：`NewLayout{get/set}`
- `Bricscad.ApplicationServices.LayoutSwitchedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.LayoutSwitchingEventArgs` — class；构造器：0；属性：`NewLayout{get/set}`, `OldLayout{get/set}`
- `Bricscad.ApplicationServices.LayoutSwitchingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.LispWillStartEventArgs` — class；构造器：0；属性：`FirstLine{get}`
- `Bricscad.ApplicationServices.LispWillStartEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.PreTranslateMessageEventArgs` — class；构造器：1；属性：`Handled{get/set}`, `Message{get/set}`
- `Bricscad.ApplicationServices.PreTranslateMessageEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.Settings` — class；构造器：1；方法：`Get`, `Register`, `Set`, `Unregister`
- `Bricscad.ApplicationServices.SystemVariableChangedEventArgs` — class；构造器：0；属性：`Changed{get}`, `Name{get}`
- `Bricscad.ApplicationServices.SystemVariableChangedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.SystemVariableChangingEventArgs` — class；构造器：0；属性：`Name{get}`
- `Bricscad.ApplicationServices.SystemVariableChangingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.TransactionManager` — class；构造器：0；方法：`EnableGraphicsFlush`, `FlushGraphics`, `QueueForGraphicsFlush`, `StartTransaction`；属性：`TopTransaction{get}`
- `Bricscad.ApplicationServices.UnknownCommandEventArgs` — class；构造器：1；属性：`GlobalCommandName{get}`
- `Bricscad.ApplicationServices.UnknownCommandEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.ApplicationServices.UserConfigurationManager` — class；构造器：0；方法：`OpenCurrentProfile`, `OpenDialogSection`, `OpenGlobalSection`
- `Bricscad.ApplicationServices.XrefFileLock` — class；构造器：0；方法：`GetXloadCtlType`, `LockFile`, `ReleaseFile`×2；属性：`XloadCtlType{get}`

#### `Bricscad.ApplicationServices.Core`

- `Bricscad.ApplicationServices.Core.Application` — abstract class；构造器：1
- `Bricscad.ApplicationServices.Core.POINT` — struct；构造器：1；字段：`x`, `y`

#### `Bricscad.Bim`

- `Bricscad.Bim.BIMAssets` — class；构造器：1；方法：`IsNull`, `SetNull`；属性：`DefaultFunction{get/set}`, `HasVariableThickness{get/set}`, `Layer{get/set}`, `ThicknessValues{get/set}`, `UnionSection{get/set}`
- `Bricscad.Bim.BIMBuilding` — class；构造器：2；方法：`AllObjectBuildings`, `AllObjectStories`×2, `AllStringBuildings`, `AllStringStories`×2, `AssignedBuilding`, `AssignToEntity`, `Cast`, `CreateBuilding`×2, `CreateStory`, `DeleteBuilding`×2, `DeleteStory`×2, `GetAssignedObjects`, `GetBuilding`, `GetStory`, `IsNull`, `op_Equality`, `op_Inequality`, `SetNull`；属性：`Description{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Name{get/set}`
- `Bricscad.Bim.BimCategory` — enum；枚举值：8
- `Bricscad.Bim.BIMClassification` — class；构造器：1；方法：`ClassifyAs`×2, `GetAllClassificationNames`, `GetAllClassified`, `GetAllClassifiedAs`×2, `GetAllUnclassified`, `GetAllUsedClassificationNames`, `GetAllUsedClassifications`, `GetClassification`, `GetClassificationName`, `GetDescription`, `GetName`, `GetPropertiesMap`, `GetPropertiesString`, `GetProperty`, `HasProperty`, `IsClassifiedAs`×2, `IsClassifiedAsAnyBuildingElement`, `IsUnclassified`, `SetDescription`, `SetName`, `SetProperty`, `UnClassify`
- `Bricscad.Bim.BIMComposition` — class；构造器：3；方法：`AddMaterialsAndCompositionsFromXML`, `AllObjectCompositions`, `AllStringCompositions`, `AssignToEntity`×2, `AvailableObjectCompositions`, `AvailableStringCompositions`, `Cast`, `DeleteComposition`×2, `DeleteMaterial`, `GetAssignedCompositionName`, `GetAssignedCompositionObject`, `GetAssignedObjects`, `GetComposition`, `GetPlyAt`, `HasComposition`, `IsNull`, `NumberOfPlies`, `op_Equality`, `op_Inequality`, `RemoveCompositionFrom`, `SaveComposition`×2, `SetNull`, `SetPlyAt`, `VariablePlyThickness`；属性：`Comments{get/set}`, `Description{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Layer{get/set}`, `Name{get/set}`, `Type{get/set}`, `VariablePlyIndex{get/set}`
- `Bricscad.Bim.BIMDialogs` — class；构造器：1；方法：`ShowBuildingsManagerDialog`, `ShowCompositionsDialog`, `ShowMaterialsDialog`, `ShowProjectDialog`
- `Bricscad.Bim.BIMInformationalAssets` — class；构造器：1；方法：`IsNull`, `SetNull`；属性：`Classification{get/set}`, `Cost{get/set}`, `Keynote{get/set}`, `Label{get/set}`, `Manufacturer{get/set}`, `Mark{get/set}`, `Model{get/set}`, `UniqueCode{get/set}`, `Url{get/set}`
- `Bricscad.Bim.BIMLibraryInfo` — struct；构造器：0；字段：`m_GUID`, `m_isNew`, `m_isPrimary`, `m_isReadOnly`, `m_Locale`, `m_Path`, `m_Region`, `m_Unit`
- `Bricscad.Bim.BIMLinearGeometry` — class；构造器：3；方法：`GetAssignedProfile`, `GetAxis`, `GetClippingFaces`, `GetEndPoint`, `GetExtrusionPath`, `GetId`, `GetProfile`, `GetSideFaces`, `GetStartPoint`, `IsValid`, `SetId`
- `Bricscad.Bim.BIMMaterial` — class；构造器：3；方法：`AllObjectsMaterials`, `AllStringMaterials`, `AvailableObjectsMaterials`, `AvailableStringMaterials`, `Cast`, `DeleteMaterial`×2, `GetBimAssets`, `GetInformationAssets`, `GetMaterial`, `GetPhysicalAssets`, `HasMaterial`, `IsNull`, `op_Equality`, `op_Inequality`, `SaveMaterial`×2, `SetNull`；属性：`Appearance{get/set}`, `Comments{get/set}`, `CutPattern{get/set}`, `Description{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Name{get/set}`, `SurfacePattern{get/set}`
- `Bricscad.Bim.BIMObject` — abstract class；构造器：0；方法：`IsNull`, `SetNull`；属性：`Description{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Name{get/set}`
- `Bricscad.Bim.BIMPhysicalAssets` — class；构造器：1；方法：`ClearDensity`, `ClearSpecificHeat`, `ClearThermalConductivity`, `HasDensity`, `HasSpecificHeat`, `HasThermalConductivity`, `IsNull`, `SetNull`；属性：`Density{get/set}`, `SpecificHeat{get/set}`, `ThermalConductivity{get/set}`
- `Bricscad.Bim.BIMPly` — class；构造器：3；方法：`Cast`, `IsNull`, `SetNull`；属性：`Description{get/set}`, `Function{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Material{get/set}`, `Name{get/set}`, `Thickness{get/set}`
- `Bricscad.Bim.BIMPolicies` — class；构造器：1
- `Bricscad.Bim.BIMProfile` — class；构造器：3；方法：`AddProfileFromXML`, `ApplyProfileTo`×2, `GetAllAssignedObjects`, `GetAllLibraryProfiles`, `GetAllProfileNames`, `GetAllProfiles`, `GetAllProfileSizes`, `GetAllProfileStandards`, `GetAssignedProfile`, `GetDescriptionProfile`, `GetNameProfile`, `GetProfile`, `GetProfileCurves`×2, `GetShapeProfile`, `GetStandardProfile`, `IsValid`×2, `RemoveProfileFrom`, `SaveProfile`×2, `SetFromId`；属性：`GetDescription{get}`, `GetName{get}`, `GetShape{get}`, `GetStandard{get}`
- `Bricscad.Bim.BimResStatus` — enum；枚举值：45
- `Bricscad.Bim.BIMRoom` — class；构造器：3；方法：`AssignToBuilding`×2, `AssignToStory`×2, `BuildNonAssociativeRoom`, `CreateAssociativeRoom`, `CreateNonAssociativeRoom`, `GetAllRooms`×3, `GetAssignedBuilding`, `GetAssignedLocation`, `GetAssignedStory`, `GetBoundingElements`, `GetOpenings`, `GetRoomArea`, `GetRoomDepartment`, `GetRoomDescription`, `GetRoomIdent`, `GetRoomName`, `GetRoomNumber`, `GetRoomRepresentation`, `IsAssociativeRoom`×2, `IsNull`, `op_Equality`, `op_Inequality`, `SetNull`, `SetRoomDepartment`, `SetRoomDescription`, `SetRoomName`, `SetRoomNumber`, `SetRoomRepresentation`, `UnassignLocation`×2, `UpdateAssociativeRoom`；属性：`Description{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Name{get/set}`, `ObjId{get/set}`, `RoomArea{get}`, `RoomDepartment{get/set}`, `RoomIdent{get}`, `RoomName{get/set}`, `RoomNumber{get/set}`, `RoomRepresentation{get/set}`
- `Bricscad.Bim.BIMSpatialLocation` — class；构造器：4；方法：`AssignedSpatialLocation`, `AssignToEntity`, `Cast`, `GetAssignedObjects`, `HasBuilding`, `HasStory`, `IsBuilding`, `IsNull`, `IsStory`, `op_Equality`, `op_Inequality`, `RemoveSpatialLocationFrom`, `SetNull`；属性：`Description{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Name{get/set}`
- `Bricscad.Bim.BIMStory` — class；构造器：2；方法：`AllObjectStories`, `AllStringStories`, `AssignedStory`, `AssignToEntity`, `Cast`, `CreateStory`×2, `DeleteStory`×2, `GetAssignedObjects`, `GetBuilding`, `GetStory`, `IsNull`, `op_Equality`, `op_Inequality`, `SetNull`；属性：`Description{get/set}`, `Elevation{get/set}`, `GetTypeDesc{get}`, `GetTypeName{get}`, `Name{get/set}`
- `Bricscad.Bim.BimTypeElement` — enum；枚举值：55
- `Bricscad.Bim.BimTypeObject` — enum；枚举值：8
- `Bricscad.Bim.BimUtilityFunctions` — static class；构造器：0；方法：`CheckBimStatus`, `GetLibraryInfo`, `IsBimAvailable`
- `Bricscad.Bim.Blockify` — class；构造器：1；方法：`FindMatchingBlockDefinition`, `FindSimilar3dSolids`, `FindSimilarGeometry`, `IsSimilarGeometry`, `MatchEntitiesToBlockDefinitions`, `ReplaceGeometryByBlocks`
- `Bricscad.Bim.CompositionType` — enum；枚举值：5
- `Bricscad.Bim.GeometrySet` — class；构造器：0；属性：`ObjectIDs{get}`, `Transform{get}`
- `Bricscad.Bim.HatchPatternMgd` — struct；构造器：2；字段：`m_Angle`, `m_Cross`, `m_Name`, `m_ScaleOrSpacing`, `m_Type`
- `Bricscad.Bim.HatchType` — enum；枚举值：4
- `Bricscad.Bim.LibraryUnit` — enum；枚举值：2
- `Bricscad.Bim.MatchingGeometrySets` — class；构造器：0；属性：`InsertionPoint{get}`, `ListGeometryIds{get}`
- `Bricscad.Bim.MaterialFunction` — enum；枚举值：7
- `Bricscad.Bim.PolicyOptions` — enum；枚举值：2
- `Bricscad.Bim.ProfileType` — enum；枚举值：6
- `Bricscad.Bim.ProjectTab` — enum；枚举值：4

#### `Bricscad.Civil`

- `Bricscad.Civil.Alignment3d` — class；构造器：1；属性：`BaseHorizontalAlignment{get/set}`, `Length{get}`, `Points{get}`, `VerticalAlignment{get/set}`
- `Bricscad.Civil.AlignmentCurve` — abstract class；构造器：0；属性：`Description{get/set}`, `Name{get/set}`
- `Bricscad.Civil.AlignmentHorizontal` — class；构造器：1；方法：`AddArcAuto`, `AddArcBetween`×3, `AddArcFixed`×2, `AddArcFrom`×4, `AddArcTo`×4, `AddCSSTo`, `AddCSTo`×2, `AddLineBetween`, `AddLineFixed`×2, `AddLineFrom`×2, `AddLineTo`×2, `AddSCFrom`×2, `AddSCSAuto`, `AddSCSBetween`, `AddSpiralBetween`, `AddSpiralFrom`, `AddSpiralTo`, `AddSSBetween`, `AddSSCFrom`, `AddSTFrom`×2, `AddSTSBetween`, `AddTSTo`×2, `DeleteHAElement`, `GetCurveAtPI`, `GetElementId`, `GetHAElementAtStation`, `GetLineElementAfter`, `GetLineElementBefore`, `GetPointAtStation`, `GetRadiusAt`, `GetStationOffsetAtPoint`, `GetStationOffsetInRangeAtPoint`, `InsertLineFixed`, `Update`；属性：`Alignment3d{get}`, `Alignment3dCount{get}`, `CurveElementColor{get/set}`, `ElementExtensionColor{get/set}`, `FirstHAElementId{get}`, `FirstLineElementId{get}`, `HAElement{get}`, `HAElementCount{get}`, `HorizontalPIs{get}`, `LastHAElementId{get}`, `Length{get}`, `LineElementColor{get/set}`, `SpiralElementColor{get/set}`, `StationEquations{get/set}`, `Style{get/set}`, `TangentExtensionColor{get/set}`, `UnorderedElementIds{get}`, `VerticalAlignment{get}`, `VerticalAlignmentCount{get}`, `VerticalAlignmentView{get}`, `VerticalAlignmentViewCount{get}`
- `Bricscad.Civil.AlignmentHorizontalArc` — class；构造器：1；属性：`Center{get/set}`, `Direction{get/set}`, `GreaterThan180{get/set}`, `IsCompound{get/set}`, `LengthParam{get/set}`, `Radius{get/set}`, `ThroughPoint1{get/set}`, `ThroughPoint2{get/set}`, `ThroughPoint3{get/set}`
- `Bricscad.Civil.AlignmentHorizontalCurve` — abstract class；构造器：0；属性：`EndPoint{get}`, `EndStation{get}`, `Length{get}`, `StartPoint{get}`, `StartStation{get}`
- `Bricscad.Civil.AlignmentHorizontalElement` — class；构造器：0；属性：`ElementId{get}`, `ElementType{get}`, `IsSubEntity{get}`, `NextElementId{get/set}`, `ParameterConstraint{get/set}`, `PreviousElementId{get/set}`, `TangencyConstraint{get/set}`
- `Bricscad.Civil.AlignmentHorizontalLine` — class；构造器：1；属性：`LengthParam{get/set}`, `ThroughPoint1{get/set}`, `ThroughPoint2{get/set}`
- `Bricscad.Civil.AlignmentHorizontalPI` — class；构造器：1；属性：`Location{get}`
- `Bricscad.Civil.AlignmentHorizontalSCS` — class；构造器：1；属性：`Arc{get}`, `SpiralIn{get}`, `SpiralOut{get}`
- `Bricscad.Civil.AlignmentHorizontalSpiral` — class；构造器：1；属性：`DefinitionType{get/set}`, `Direction{get/set}`, `EndDirection{get/set}`, `IsClockwise{get/set}`, `IsCompound{get/set}`, `ParameterA{get/set}`, `RadiusIn{get/set}`, `RadiusOut{get/set}`, `SpiralCurveType{get/set}`, `SpiralLength{get/set}`, `StartDirection{get/set}`
- `Bricscad.Civil.AlignmentHorizontalSSCSS` — class；构造器：1；属性：`Arc{get}`, `Spiral1{get}`, `Spiral2{get}`, `Spiral3{get}`, `Spiral4{get}`
- `Bricscad.Civil.AlignmentHorizontalSTS` — class；构造器：1；属性：`Line{get}`, `SpiralIn{get}`, `SpiralOut{get}`, `SpiralRatio{get/set}`
- `Bricscad.Civil.AlignmentVertical` — class；构造器：1；方法：`AddArcAuto`, `AddArcBetween`, `AddParabolaAuto`, `AddParabolaBetween`, `AddTangentFixed`, `DeleteVAElement`, `GetCurveAtPVI`, `GetElementId`, `GetElevationAt`, `GetPVIAtCurve`, `GetRadiusAt`, `GetTangentElementAfter`, `GetTangentElementBefore`, `InsertTangentFixed`, `Update`；属性：`BaseHorizontalAlignment{get/set}`, `BaseSurface{get/set}`, `CurveElementColor{get/set}`, `ElevationPoints{get}`, `FirstTangentElementId{get}`, `FirstVAElementId{get}`, `LastVAElementId{get}`, `Length{get}`, `LineElementColor{get/set}`, `MaximumElevation{get}`, `MinimumElevation{get}`, `Style{get/set}`, `TangentExtensionColor{get/set}`, `Type{get/set}`, `UnorderedElementIds{get}`, `VAElement{get}`, `VAElementCount{get}`, `VerticalPVIs{get}`
- `Bricscad.Civil.AlignmentVerticalArc` — class；构造器：1；属性：`Center{get/set}`, `Direction{get/set}`, `GradeIn{get}`, `GradeOut{get}`, `Radius{get/set}`
- `Bricscad.Civil.AlignmentVerticalCurve` — abstract class；构造器：0；属性：`EndPoint{get}`, `Length{get}`, `StartPoint{get}`
- `Bricscad.Civil.AlignmentVerticalElement` — class；构造器：0；属性：`ElementId{get}`, `ElementType{get}`, `NextElementId{get/set}`, `ParameterConstraint{get/set}`, `PreviousElementId{get/set}`, `TangencyConstraint{get/set}`
- `Bricscad.Civil.AlignmentVerticalParabola` — class；构造器：1；属性：`GradeIn{get}`, `GradeOut{get}`, `Radius{get/set}`
- `Bricscad.Civil.AlignmentVerticalPVI` — class；构造器：1；属性：`Location{get}`
- `Bricscad.Civil.AlignmentVerticalTangent` — class；构造器：1；属性：`ThroughPoint1{get/set}`, `ThroughPoint2{get/set}`
- `Bricscad.Civil.AlignmentView` — class；构造器：1；方法：`AddGraph`, `ConvertViewToWCS`, `ConvertWCSToView`, `RemoveGraph`；属性：`BaseElevation{get/set}`, `BaseHorizontalAlignment{get/set}`, `Description{get/set}`, `Graph{get}`, `GraphCount{get}`, `Height{get/set}`, `HorizontalScale{get/set}`, `Length{get/set}`, `Name{get/set}`, `Origin{get/set}`, `VerticalScale{get/set}`
- `Bricscad.Civil.AlignmentViewVertical` — class；构造器：1
- `Bricscad.Civil.ArcDirection` — enum；枚举值：2
- `Bricscad.Civil.ArcParameterType` — enum；枚举值：9
- `Bricscad.Civil.ArcType` — enum；枚举值：2
- `Bricscad.Civil.Civil3DConversion` — class；构造器：0；属性：`Result{get}`, `Source{get}`
- `Bricscad.Civil.Civil3DConversionOptions` — enum；枚举值：6
- `Bricscad.Civil.Civil3DConverter` — class；构造器：3；方法：`Convert`；属性：`ConversionOptions{get/set}`
- `Bricscad.Civil.Civil3DObject` — class；构造器：0；属性：`Description{get}`, `Id{get}`, `Name{get}`, `Relatives{get}`
- `Bricscad.Civil.Entity` — abstract class；构造器：0；属性：`Description{get/set}`, `Name{get/set}`
- `Bricscad.Civil.GeneralSurfaceProperties` — class；构造器：2；属性：`MaxElevation{get}`, `MinElevation{get}`, `NumberOfPoints{get}`, `Points{get}`, `Surface{get}`
- `Bricscad.Civil.Grading` — class；构造器：1；方法：`SetInputData`×2, `Update`；属性：`CalculationCurve{get}`, `CalculationMethod{get/set}`, `InputEntityId{get}`, `IsAssociative{get/set}`, `IsClosed{get}`, `IsDrawInfill{get/set}`, `MidOrdinateDist{get/set}`, `RegionEnd{get/set}`, `RegionStart{get/set}`, `ResultDayLight{get}`, `Rule{get/set}`, `SegmentMaxAngle{get/set}`, `SegmentMaxLength{get/set}`, `TargetSurface{get}`, `VisualStyle{get/set}`
- `Bricscad.Civil.GradingCalculationMethod` — enum；枚举值：2
- `Bricscad.Civil.GradingFormat` — enum；枚举值：5
- `Bricscad.Civil.GradingOffsetRule` — class；构造器：3；属性：`Offset{get/set}`, `Slope{get/set}`
- `Bricscad.Civil.GradingRule` — class；构造器：2；方法：`ConvertRadToSlope`, `ConvertSlopeToRad`；属性：`IsNull{get}`, `Side{get/set}`, `SlopeFormat{get/set}`, `Type{get}`
- `Bricscad.Civil.GradingSide` — enum；枚举值：3
- `Bricscad.Civil.GradingStatus` — enum；枚举值：14
- `Bricscad.Civil.GradingSurfaceRule` — class；构造器：3；属性：`CutSlope{get/set}`, `FillSlope{get/set}`, `SurfaceId{get/set}`
- `Bricscad.Civil.GradingType` — enum；枚举值：3
- `Bricscad.Civil.GradingVisualStyle` — enum；枚举值：4
- `Bricscad.Civil.HAElementType` — enum；枚举值：21
- `Bricscad.Civil.HAParameterConstraint` — enum；枚举值：43
- `Bricscad.Civil.HATangencyConstraint` — enum；枚举值：5
- `Bricscad.Civil.HAVisualStyle` — enum；枚举值：5
- `Bricscad.Civil.SpiralCurveType` — enum；枚举值：2
- `Bricscad.Civil.SpiralDefinitionType` — enum；枚举值：2
- `Bricscad.Civil.SpiralDirection` — enum；枚举值：2
- `Bricscad.Civil.SpiralParameterType` — enum；枚举值：2
- `Bricscad.Civil.StationEquation` — class；构造器：3；属性：`EquationType{get/set}`, `IsNull{get}`, `RawStation{get/set}`, `StationForward{get/set}`
- `Bricscad.Civil.StationEquationCollection` — class；构造器：3；方法：`AddEquation`, `ClearEquations`, `GetLengthAtRawStation`, `GetRawStationAtLength`, `GetRawStationsAtStation`, `GetStationAt`, `GetStationBack`, `RemoveEquation`, `Update`；属性：`Count{get}`, `Equation{get}`, `RefRawStartingStation{get/set}`, `RefStartingLength{get/set}`, `StartingStation{get}`
- `Bricscad.Civil.StationEquationType` — enum；枚举值：2
- `Bricscad.Civil.Surface` — abstract class；构造器：0；方法：`GetGeneralProperties`, `GetPoints`；属性：`GeneralProperties{get}`
- `Bricscad.Civil.TerrainSurfaceProperties` — class；构造器：2；属性：`SurfaceArea2d{get}`, `SurfaceArea3d{get}`
- `Bricscad.Civil.TinBoundaryType` — enum；枚举值：3
- `Bricscad.Civil.TinBreaklineType` — enum；枚举值：2
- `Bricscad.Civil.TinConstraintType` — enum；枚举值：3
- `Bricscad.Civil.TinIntersectionElevation` — enum；枚举值：4
- `Bricscad.Civil.TinSurface` — class；构造器：2；方法：`AddConstraint`, `AddConstraints`, `AddPoint`, `AddPoints`, `ChangePointsElevations`, `EraseConstraint`×2, `Merge`×2, `MovePoint`, `MovePoints`, `RaiseSurface`, `RemovePoint`, `RemovePoints`, `SetSurfaceElevation`, `SwapEdge`, `UpdateConstraint`, `UpdateObjectData`；属性：`IsAssociative{get/set}`
- `Bricscad.Civil.TinSurfaceBoundary` — class；构造器：2；属性：`BoundaryType{get}`
- `Bricscad.Civil.TinSurfaceBreakline` — class；构造器：2；属性：`BreaklineType{get}`, `IntersectionElevation{get/set}`
- `Bricscad.Civil.TinSurfaceConstraint` — abstract class；构造器：0；方法：`SetData`×2；属性：`ConstraintId{get}`, `ConstraintType{get}`, `Data{get}`, `IsDbResident{get}`, `MidOrdinateDistance{get/set}`
- `Bricscad.Civil.TinSurfaceEdge` — class；构造器：0；方法：`CompareTo`, `Equals`, `GetHashCode`；属性：`IsValid{get}`, `Triangle1{get}`, `Triangle2{get}`, `Vertex1{get}`, `Vertex2{get}`
- `Bricscad.Civil.TinSurfaceExtractType` — enum；枚举值：3
- `Bricscad.Civil.TinSurfaceIntersectType` — enum；枚举值：2
- `Bricscad.Civil.TinSurfaceObject` — abstract class；构造器：0；属性：`Surface{get}`
- `Bricscad.Civil.TinSurfaceProperties` — class；构造器：2；属性：`NumberOfTriangles{get}`
- `Bricscad.Civil.TinSurfaceStatic` — abstract class；构造器：0；方法：`Contains`, `Drape`, `GetClosestPointTo`, `GetConstraint`×2, `GetContoursAt`, `GetElevationAtPoint`, `GetIntersectionsWithLine`, `GetMesh`×2, `GetPointsInsidePolygon`, `GetSolid`×2, `GetTerrainProperties`, `GetTinProperties`, `GetTriangles`, `GetTrianglesAt`, `GetVertexAt`；属性：`Borders{get}`, `BoundingBox{get}`, `Constraints{get}`, `IsAssociative{get}`, `MajorContours{get}`, `MajorContoursColor{get/set}`, `MajorContoursInterval{get/set}`, `MinorContours{get}`, `MinorContoursColor{get/set}`, `MinorContoursInterval{get/set}`, `Style{get/set}`, `SurfaceMesh{get}`, `TerrainProperties{get}`, `TinProperties{get}`, `Triangles{get}`, `Vertices{get}`
- `Bricscad.Civil.TinSurfaceStyle` — enum；枚举值：6
- `Bricscad.Civil.TinSurfaceTriangle` — class；构造器：0；方法：`CompareTo`, `Equals`, `GetHashCode`；属性：`Edge1{get}`, `Edge2{get}`, `Edge3{get}`, `IsValid{get}`, `Vertex1{get}`, `Vertex2{get}`, `Vertex3{get}`
- `Bricscad.Civil.TinSurfaceVertex` — class；构造器：0；方法：`CompareTo`, `Equals`, `GetHashCode`；属性：`Edges{get}`, `IsValid{get}`, `Location{get}`, `Triangles{get}`, `Vertices{get}`
- `Bricscad.Civil.TinSurfaceWall` — class；构造器：2；属性：`Height{get/set}`, `WallSide{get/set}`, `WallType{get}`
- `Bricscad.Civil.TinVolumeSurface` — class；构造器：5；属性：`Type{get}`, `VolumeProperties{get}`
- `Bricscad.Civil.TinVolumeSurfaceType` — enum；枚举值：3
- `Bricscad.Civil.TinWallSide` — enum；枚举值：2
- `Bricscad.Civil.TinWallType` — enum；枚举值：2
- `Bricscad.Civil.VAElementType` — enum；枚举值：5
- `Bricscad.Civil.VAParameterConstraint` — enum；枚举值：7
- `Bricscad.Civil.VATangencyConstraint` — enum；枚举值：5
- `Bricscad.Civil.VAType` — enum；枚举值：4
- `Bricscad.Civil.VAVisualStyle` — enum；枚举值：4
- `Bricscad.Civil.VerticalArcDirection` — enum；枚举值：2
- `Bricscad.Civil.VolumeSurfaceProperties` — class；构造器：1；属性：`BaseSurface{get}`, `BoundingPolygon{get}`, `ComparisonSurface{get}`, `CutVolume{get}`, `DepthElevation{get}`, `FillVolume{get}`, `SurfaceBoundary{get}`

#### `Bricscad.CivilExtensions`

- `Bricscad.CivilExtensions.Civil3DConversionExtensions` — static class；构造器：0；方法：`ExportCivil3DToNative`

#### `Bricscad.DirectModeling`

- `Bricscad.DirectModeling.AuditFlaw` — class；构造器：0；属性：`Description{get}`, `Message{get}`, `Severity{get}`, `Subents{get}`
- `Bricscad.DirectModeling.AuditOperation` — class；构造器：1；方法：`Add`×2, `Run`；属性：`Options{get/set}`
- `Bricscad.DirectModeling.AuditOptions` — class；构造器：1；属性：`FixFlaws{get/set}`, `Level{get/set}`, `MultiThreadedMode{get/set}`, `TreatConcidentFaces{get/set}`, `TreatDynamicRangeErrors{get/set}`, `TreatSliverFaces{get/set}`
- `Bricscad.DirectModeling.AuditReport` — class；构造器：0；方法：`GetFlawCountBeforeFix`×2, `GetFlaws`×2, `IsFixed`×2, `IsSkipped`×2；属性：`FlawCount{get}`, `IsFixMode{get}`, `Level{get}`, `TotalChecked{get}`, `TotalFixed{get}`, `TotalSkipped{get}`
- `Bricscad.DirectModeling.AuditSeverity` — enum；枚举值：5
- `Bricscad.DirectModeling.AuditValidationLevel` — enum；枚举值：3
- `Bricscad.DirectModeling.ModelerThreadLock` — class；构造器：1

#### `Bricscad.EditorInput`

- `Bricscad.EditorInput.CommandResult` — class；构造器：0；方法：`GetAwaiter`, `GetResult`, `OnCompleted`；属性：`IsCompleted{get}`
- `Bricscad.EditorInput.CrossingOrWindowSelectedObject` — class；构造器：2；方法：`GetPickPoints`, `ToString`×2
- `Bricscad.EditorInput.CrossingOrWindowSelectedSubObject` — class；构造器：2；方法：`GetPickPoints`, `SetPickPoints`, `ToString`×2
- `Bricscad.EditorInput.CursorType` — enum；枚举值：13
- `Bricscad.EditorInput.DragCallback` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.DragCursor` — enum；枚举值：0
- `Bricscad.EditorInput.DraggingEndedEventArgs` — class；构造器：0；属性：`Offset{get}`, `PickPoint{get}`, `Status{get}`
- `Bricscad.EditorInput.DraggingEndedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.DraggingEventArgs` — class；构造器：1；属性：`Prompt{get}`
- `Bricscad.EditorInput.DraggingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.DrawJig` — abstract class；构造器：0
- `Bricscad.EditorInput.Editor` — class；构造器：0；方法：`Command`, `CommandAsync`, `Dispose`, `DoPrompt`, `Drag`×3, `DrawVector`, `DrawVectors`, `GetAngle`×2, `GetCorner`×2, `GetCurrentView`, `GetDistance`×2, `GetDouble`×2, `GetEntity`×2, `GetFileNameForOpen`×2, `GetFileNameForSave`×2, `GetInteger`×2, `GetKeywords`×2, `GetNestedEntity`×2, `GetPoint`×2, `GetSelection`×4, `GetString`×2, `GetViewportNumber`, `PointToScreen`, `PointToWorld`×2, `Regen`, `SelectAll`×2, `SelectCrossingPolygon`×2, `SelectCrossingWindow`×2, `SelectFence`×2, `SelectImplied`, `SelectLast`, `SelectPrevious`, `SelectWindow`×2, `SelectWindowPolygon`×2, `SetCurrentView`, `SetImpliedSelection`×2, `Snap`, `StartUserInteraction`×3, `SwitchToModelSpace`, `SwitchToPaperSpace`, `TraceBoundary`×2, `TurnForcedPickOff`, `TurnForcedPickOn`, `UpdateScreen`, `UpdateTiledViewportsFromDatabase`, `UpdateTiledViewportsInDatabase`, `WriteMessage`×2；属性：`ActiveViewportId{get}`, `CurrentUserCoordinateSystem{get/set}`, `CurrentViewportObjectId{get}`, `Document{get}`, `IsDragging{get}`, `IsQuiescent{get}`, `MouseHasMoved{get}`；事件：`Dragging`, `DraggingEnded`, `EnteringQuiescentState`, `LeavingQuiescentState`, `PointFilter`, `PointMonitor`, `PromptedForAngle`, `PromptedForCorner`, `PromptedForDistance`, `PromptedForDouble`, `PromptedForEntity`, `PromptedForInteger`, `PromptedForKeyword`, `PromptedForNestedEntity`, `PromptedForPoint`, `PromptedForSelection`, `PromptedForString`, `PromptForEntityEnding`, `PromptForSelectionEnding`, `PromptingForAngle`, `PromptingForCorner`, `PromptingForDistance`, `PromptingForDouble`, `PromptingForEntity`, `PromptingForInteger`, `PromptingForKeyword`, `PromptingForNestedEntity`, `PromptingForPoint`, `PromptingForSelection`, `PromptingForString`, `SelectionAdded`, `SelectionRemoved`；字段：`PauseToken`
- `Bricscad.EditorInput.EditorUserInteraction` — class；构造器：0；方法：`Dispose`, `End`
- `Bricscad.EditorInput.EntityJig` — abstract class；构造器：0
- `Bricscad.EditorInput.FenceSelectedObject` — class；构造器：2；方法：`GetIntersectionPoints`, `ToString`×2
- `Bricscad.EditorInput.FenceSelectedSubObject` — class；构造器：2；方法：`GetIntersectionPoints`, `ToString`×2
- `Bricscad.EditorInput.InputPointContext` — class；构造器：0；方法：`Dispose`, `GetAlignmentPaths`, `GetCustomObjectSnapOverrides`, `GetKeyPointEntities`, `GetPickedEntities`；属性：`CartesianSnappedPoint{get}`, `ComputedPoint{get}`, `Document{get}`, `DrawContext{get}`, `GrippedPoint{get}`, `History{get}`, `LastPoint{get}`, `ObjectSnapMask{get}`, `ObjectSnapOverrides{get}`, `ObjectSnappedPoint{get}`, `PointComputed{get}`, `RawPoint{get}`, `ToolTipText{get}`
- `Bricscad.EditorInput.IslandDetectionDepth` — enum；枚举值：3
- `Bricscad.EditorInput.Jig` — abstract class；构造器：0
- `Bricscad.EditorInput.JigPromptAngleOptions` — class；构造器：3；属性：`DefaultValue{get/set}`
- `Bricscad.EditorInput.JigPromptDistanceOptions` — class；构造器：3；属性：`DefaultValue{get/set}`
- `Bricscad.EditorInput.JigPromptGeometryOptions` — abstract class；构造器：3；属性：`BasePoint{get/set}`, `UseBasePoint{get/set}`
- `Bricscad.EditorInput.JigPromptOptions` — abstract class；构造器：0；属性：`Cursor{get/set}`, `UserInputControls{get/set}`
- `Bricscad.EditorInput.JigPromptPointOptions` — class；构造器：3；属性：`DefaultValue{get/set}`
- `Bricscad.EditorInput.JigPrompts` — class；构造器：0；方法：`AcquireAngle`×4, `AcquireDistance`×4, `AcquirePoint`×4, `AcquireString`×4
- `Bricscad.EditorInput.JigPromptStringOptions` — class；构造器：3；属性：`DefaultValue{get/set}`, `Defaultvalue{get/set}`
- `Bricscad.EditorInput.Keyword` — class；构造器：0；属性：`DisplayName{get/set}`, `Enabled{get/set}`, `GlobalName{get/set}`, `IsReadOnly{get/set}`, `LocalName{get}`, `Visible{get/set}`
- `Bricscad.EditorInput.KeywordCollection` — class；构造器：1；方法：`Add`×4, `Clear`, `CopyTo`×2, `GetDisplayString`, `GetEnumerator`；属性：`Count{get}`, `Default{get/set}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get}`, `SyncRoot{get}`
- `Bricscad.EditorInput.ObjectSnapMasks` — enum；枚举值：18
- `Bricscad.EditorInput.PickPointDescriptor` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Direction{get}`, `Kind{get}`, `PointOnLine{get}`
- `Bricscad.EditorInput.PickPointKind` — enum；枚举值：4
- `Bricscad.EditorInput.PickPointSelectedObject` — class；构造器：2；方法：`ToString`×2；属性：`PickPoint{get}`
- `Bricscad.EditorInput.PickPointSelectedSubObject` — class；构造器：2；方法：`ToString`×2；属性：`PickPoint{get}`
- `Bricscad.EditorInput.PointFilterEventArgs` — class；构造器：0；方法：`Dispose`；属性：`CallNext{get/set}`, `Context{get}`, `Result{get}`
- `Bricscad.EditorInput.PointFilterEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PointFilterResult` — class；构造器：1；方法：`Dispose`；属性：`DisplayObjectSnapGlyph{get/set}`, `NewPoint{get/set}`, `Retry{get/set}`, `ToolTipText{get/set}`
- `Bricscad.EditorInput.PointHistoryBits` — enum；枚举值：23
- `Bricscad.EditorInput.PointMonitorEventArgs` — class；构造器：0；方法：`AppendToolTipText`, `Dispose`；属性：`Context{get}`
- `Bricscad.EditorInput.PointMonitorEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptAngleOptions` — class；构造器：2；属性：`AllowArbitraryInput{get/set}`, `AllowNone{get/set}`, `AllowZero{get/set}`, `BasePoint{get/set}`, `DefaultValue{get/set}`, `UseAngleBase{get/set}`, `UseBasePoint{get/set}`, `UseDashedLine{get/set}`, `UseDefaultValue{get/set}`
- `Bricscad.EditorInput.PromptAngleOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptAngleOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptCornerOptions` — class；构造器：2；属性：`AllowArbitraryInput{get/set}`, `AllowNone{get/set}`, `BasePoint{get/set}`, `LimitsChecked{get/set}`, `UseDashedLine{get/set}`
- `Bricscad.EditorInput.PromptDistanceOptions` — class；构造器：2；属性：`BasePoint{get/set}`, `DefaultValue{get/set}`, `Only2d{get/set}`, `UseBasePoint{get/set}`, `UseDashedLine{get/set}`
- `Bricscad.EditorInput.PromptDistanceOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptDistanceOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptDoubleOptions` — class；构造器：1；属性：`DefaultValue{get/set}`
- `Bricscad.EditorInput.PromptDoubleOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptDoubleOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptDoubleResult` — class；构造器：0；方法：`ToString`×2；属性：`Value{get}`
- `Bricscad.EditorInput.PromptDoubleResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptDoubleResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptDragOptions` — class；构造器：2；属性：`AllowArbitraryInput{get/set}`, `AllowNone{get/set}`, `Callback{get/set}`, `Cursor{get/set}`, `Selection{get/set}`
- `Bricscad.EditorInput.PromptEditorOptions` — abstract class；构造器：1
- `Bricscad.EditorInput.PromptEntityOptions` — class；构造器：2；方法：`AddAllowedClass`, `RemoveAllowedClass`, `SetRejectMessage`；属性：`AllowNone{get/set}`, `AllowObjectOnLockedLayer{get/set}`
- `Bricscad.EditorInput.PromptEntityOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptEntityOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptEntityResult` — class；构造器：0；方法：`ToString`×2；属性：`ObjectId{get}`, `PickedPoint{get}`
- `Bricscad.EditorInput.PromptEntityResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptEntityResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptFileNameResult` — class；构造器：0；属性：`ReadOnly{get}`
- `Bricscad.EditorInput.PromptFileOptions` — abstract class；构造器：0；属性：`AllowUrls{get/set}`, `DialogCaption{get/set}`, `DialogName{get/set}`, `Filter{get/set}`, `InitialDirectory{get/set}`, `InitialFileName{get/set}`
- `Bricscad.EditorInput.PromptForEntityEndingEventArgs` — class；构造器：0；方法：`RemoveSelectedObject`, `ReplaceSelectedObject`；属性：`Result{get}`
- `Bricscad.EditorInput.PromptForEntityEndingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptForSelectionEndingEventArgs` — class；构造器：0；方法：`Add`, `AddSubEntity`, `Remove`, `RemoveSubEntity`；属性：`Flags{get}`, `Selection{get}`
- `Bricscad.EditorInput.PromptForSelectionEndingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptIntegerOptions` — class；构造器：3；属性：`DefaultValue{get/set}`, `LowerLimit{get/set}`, `UpperLimit{get/set}`
- `Bricscad.EditorInput.PromptIntegerOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptIntegerOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptIntegerResult` — class；构造器：0；方法：`ToString`×2；属性：`Value{get}`
- `Bricscad.EditorInput.PromptIntegerResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptIntegerResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptKeywordOptions` — class；构造器：2；属性：`AllowArbitraryInput{get/set}`, `AllowNone{get/set}`
- `Bricscad.EditorInput.PromptKeywordOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptKeywordOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptNestedEntityOptions` — class；构造器：2；属性：`AllowNone{get/set}`, `NonInteractivePickPoint{get/set}`, `UseNonInteractivePickPoint{get/set}`
- `Bricscad.EditorInput.PromptNestedEntityOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptNestedEntityOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptNestedEntityResult` — class；构造器：0；方法：`GetContainers`, `ToString`×2；属性：`Transform{get}`
- `Bricscad.EditorInput.PromptNestedEntityResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptNestedEntityResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptNumericalOptions` — class；构造器：0；属性：`AllowArbitraryInput{get/set}`, `AllowNegative{get/set}`, `AllowNone{get/set}`, `AllowZero{get/set}`, `UseDefaultValue{get/set}`
- `Bricscad.EditorInput.PromptOpenFileOptions` — class；构造器：1；属性：`SearchPathW{get/set}`, `TransferRemoteFiles{get/set}`
- `Bricscad.EditorInput.PromptOptions` — abstract class；构造器：1；方法：`SetMessageAndKeywords`；属性：`AppendKeywordsToMessage{get/set}`, `IsReadOnly{get}`, `Keywords{get}`, `Message{get/set}`
- `Bricscad.EditorInput.PromptParser` — class；构造器：1
- `Bricscad.EditorInput.PromptPointOptions` — class；构造器：2；属性：`UseBasePoint{get/set}`
- `Bricscad.EditorInput.PromptPointOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptPointOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptPointResult` — class；构造器：0；方法：`ToString`×2；属性：`Value{get}`
- `Bricscad.EditorInput.PromptPointResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptPointResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptResult` — class；构造器：0；方法：`ToString`×2；属性：`Status{get}`, `StringResult{get}`
- `Bricscad.EditorInput.PromptSaveFileOptions` — class；构造器：1
- `Bricscad.EditorInput.PromptSelectionOptions` — class；构造器：1；方法：`SetKeywords`；属性：`AllowDuplicates{get/set}`, `AllowSubSelections{get/set}`, `ForceSubSelections{get/set}`, `Keywords{get}`, `MessageForAdding{get/set}`, `MessageForRemoval{get/set}`, `PrepareOptionalDetails{get/set}`, `RejectObjectsFromNonCurrentSpace{get/set}`, `RejectObjectsOnLockedLayers{get/set}`, `RejectPaperspaceViewPort{get/set}`, `SelectEverythingInAperture{get/set}`, `SingleOnly{get/set}`, `SinglePickInSpace{get/set}`；事件：`KeywordInput`, `UnknownInput`
- `Bricscad.EditorInput.PromptSelectionOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptSelectionOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptSelectionResult` — class；构造器：0；方法：`ToString`×2；属性：`Status{get}`, `Value{get}`
- `Bricscad.EditorInput.PromptSelectionResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptSelectionResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptStatus` — enum；枚举值：7
- `Bricscad.EditorInput.PromptStringOptions` — class；构造器：1；属性：`AllowSpaces{get/set}`, `DefaultValue{get/set}`, `UseDefaultValue{get/set}`
- `Bricscad.EditorInput.PromptStringOptionsEventArgs` — class；构造器：0；属性：`Options{get}`
- `Bricscad.EditorInput.PromptStringOptionsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.PromptStringResultEventArgs` — class；构造器：0；属性：`Result{get}`
- `Bricscad.EditorInput.PromptStringResultEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.SamplerStatus` — enum；枚举值：3
- `Bricscad.EditorInput.SelectedObject` — class；构造器：4；方法：`GetSubentities`, `ToString`×2；属性：`GraphicsSystemMarker{get}`, `GraphicsSystemMarkerPtr{get}`, `ObjectId{get}`, `OptionalDetails{get/set}`, `SelectionMethod{get}`, `SelectionMethods{get}`
- `Bricscad.EditorInput.SelectedSubObject` — class；构造器：2；方法：`ToString`×2；属性：`FullSubentityPath{get}`, `GraphicsSystemMarker{get}`, `GraphicsSystemMarkerPtr{get}`, `OptionalDetails{get}`, `SelectionMethod{get}`
- `Bricscad.EditorInput.SelectionAddedEventArgs` — class；构造器：0；方法：`Add`, `AddSubEntity`, `Dispose`, `Highlight`, `Remove`, `RemoveSubEntity`；属性：`AddedObjects{get}`, `Flags{get}`, `Selection{get}`
- `Bricscad.EditorInput.SelectionAddedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.SelectionDetails` — class；构造器：0；方法：`GetContainers`, `ToString`×2；属性：`Transform{get}`
- `Bricscad.EditorInput.SelectionFilter` — class；构造器：1；方法：`GetFilter`
- `Bricscad.EditorInput.SelectionFlags` — enum；枚举值：9
- `Bricscad.EditorInput.SelectionMethod` — enum；枚举值：7
- `Bricscad.EditorInput.SelectionRemovedEventArgs` — class；构造器：0；方法：`Dispose`, `RemoveSubentity`；属性：`Flags{get}`, `RemovedObjects{get}`, `Selection{get}`
- `Bricscad.EditorInput.SelectionRemovedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.SelectionSet` — abstract class；构造器：0；方法：`CopyTo`×2, `FromObjectIds`, `GetEnumerator`, `GetObjectIds`, `ToString`×2；属性：`Count{get}`, `IsSynchronized{get}`, `Item{get}`, `SyncRoot{get}`
- `Bricscad.EditorInput.SelectionTextInputEventArgs` — class；构造器：0；方法：`AddObjects`, `SetErrorMessage`；属性：`Input{get}`
- `Bricscad.EditorInput.SelectionTextInputEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.EditorInput.UserInputControls` — enum；枚举值：16

#### `Bricscad.Global`

- `Bricscad.Global.Database` — static class；构造器：0；方法：`EntGet`, `EntMake`, `EntMakeX`, `EntMod`, `IsClipDisplayInPsVportOn`, `IsClipDisplayOn`, `SetClipDisplayInPsVport`, `SetClipDisplayOn`, `SetUseClipDisplayLids`, `UseClipDisplayLids`
- `Bricscad.Global.Editor` — static class；构造器：0；方法：`Command`, `GetLispSymbol`, `Invoke`, `SetLispSymbol`, `Translate`

#### `Bricscad.GraphicsSystem`

- `Bricscad.GraphicsSystem.ConfigWasModifiedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.GraphicsSystem.GsToBeUnloadedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.GraphicsSystem.Manager` — class；构造器：0；方法：`CreateAutoCADDevice`, `CreateAutoCADModel`, `CreateAutoCADOffScreenDevice`, `CreateAutoCADView`, `CreateAutoCADViewport`, `GetDBModel`, `GetGsView`, `GetGUIDevice`, `SetViewFromViewport`, `SetViewportFromView`×2；属性：`DisplaySize{get}`；事件：`ConfigWasModified`, `GsToBeUnloaded`, `ViewToBeDestroyed`, `ViewToBeUpdated`, `ViewWasCreated`, `ViewWasUpdated`
- `Bricscad.GraphicsSystem.ViewEventArgs` — class；构造器：1；属性：`View{get/set}`
- `Bricscad.GraphicsSystem.ViewToBeDestroyedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.GraphicsSystem.ViewToBeUpdatedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.GraphicsSystem.ViewUpdateEventArgs` — class；构造器：1；属性：`View{get/set}`, `ViewUpdateFlags{get/set}`
- `Bricscad.GraphicsSystem.ViewWasCreatedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.GraphicsSystem.ViewWasUpdatedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`

#### `Bricscad.Ifc`

- `Bricscad.Ifc.ExportContext` — class；构造器：0；方法：`GetAxis2Placement2D`, `GetAxis2Placement3D`, `GetCartesianPoint2D`, `GetCartesianPoint3D`, `GetDatabase`, `GetDirection2D`, `GetDirection3D`, `GetIfcModel`, `GetProduct`×2, `SetIfcRootData`, `SetLocationRelToAssignedSpatialLocation`, `SetLocationRelToBuilding`, `SetLocationRelToStory`, `SetLocationRelToWCS`, `SetMaterialToAssignedComposition`, `SetMaterialToComposition`, `SetRepresentationAsBrep`, `SetRepresentationAsClippedExtrudedAreaSolid`, `SetRepresentationAsExtrudedAreaSolid`
- `Bricscad.Ifc.IfcAttribute` — static class；构造器：0；字段：`AccessState`, `AcidityConcentration`, `ActingRole`, `ActionID`, `ActionSource`, `ActionType`, `Actor`, `ActualDate`, `ActualDuration`, `ActualFinish`, `ActualStart`, `ActualUsage`, `ActualWork`, `AdditionalConditions`, `Addresses`, `AddressLines`, `AdmixturesDescription`, `AgreementFlag`, `AlkalinityConcentration`, `AlongHorizontal`, `AmbientIntensity`, `AmountOfSubstanceExponent`, `AnchorageSlip`, `Angle`, `AnnotatedCurve`, `ApplicableDate`, `ApplicableDates`, `ApplicableEntity`, `ApplicableOccurrence`, `ApplicableValueRatio`, `ApplicationDeveloper`, `ApplicationFullName`, `ApplicationIdentifier`, `AppliedCondition`, `AppliedLoad`, `AppliedValue`, `Approval`, `ApprovalDateTime`, `ApprovalLevel`, `ApprovalQualifier`, `ApprovalStatus`, `ApprovedProperties`, `AreaValue`, `ArithmeticOperator`, `AssemblyPlace`, `AssetID`, `AssignedItems`, `AssociatedGeometry`, `AttributeIdentifier`, `Axis`, `Axis1`, `Axis2`, `Axis3`, `AxisCurve`, `AxisPosition`, `AxisTag`, `BackgroundColour`, `BarCount`, `BarLength`, `BarRole`, `BarSurface`, `BaseCosts`, `BaseDepth1`, `BaseDepth2`, `BaseDepth3`, `BaseQuantity`, `BaseSurface`, `BaseWidth2`, `BaseWidth4`, `BasisCurve`, `BasisSurface`, `BeamWidthAngle`, `Benchmark`, `BenchmarkValues`, `BendingParameters`, `BendingShapeCode`, `Blue`, `BoilingPoint`, `BottomFlangeEdgeRadius`, `BottomFlangeFilletRadius`, `BottomFlangeSlope`, `BottomFlangeThickness`, `BottomFlangeWidth`, `BottomRadius`, `BottomXDim`, `Bound`, `Boundaries`, `Bounds`, `BoxAlignment`, `BoxHeight`, `BoxRotateAngle`, `BoxSlantAngle`, `BoxWidth`, `BuildingAddress`, `CapacityByNumber`, `CapacityByWeight`, `CarbonContent`, `CardinalEndPoint`, `CardinalPoint`, `CartesianPosition`, `CasingDepth`, `CasingThickness`, `Category`, `CausedBy`, `CentreOfGravityInX`, `CentreOfGravityInY`, `CfsFaces`, `ChangeAction`, `CharacterSpacing`, `ClassifiedConstraint`, `ClassifiedMaterial`, `Closed`, `ClosedCurve`, `CO2Content`, `COContent`, `Coefficient`, `Colour`, `ColourAppearance`, `ColourComponents`, `ColourIndex`, `ColourList`, `Colours`, `ColourTemperature`, `Columns`, `CombustionTemperature`, `Completion`, `ComponentOfTotal`, `Components`, `CompositeProfile`, `CompositionType`, `CompressionFailureX`, `CompressionFailureY`, `CompressionFailureZ`, `CompressiveStrength`, `ConcentrationExponent`, `Condition`, `ConditionCoordinateSystem`, `Confidentiality`, `ConnectionConstraint`, `ConnectionGeometry`, `ConnectionType`, `ConstantAttenuation`, `ConstraintGrade`, `ConstraintSource`, `ConstructionType`, `Contents`, `ContextIdentifier`, `ContextOfItems`, `ContextType`, `ControlElementId`, `ControlPointsList`, `ConversionFactor`, `ConversionOffset`, `Coordinates`, `CoordinateSpaceDimension`, `CoordIndex`, `CoordList`, `Corner`, `CorrespondingBoundary`, `CostQuantities`, `CostType`, `CostValues`, `Country`, `CountValue`, `CreatingActor`, `CreationDate`, `CreationTime`, `Creators`, `Criterion`, `CriterionDateTime`, `CrossSectionArea`, `CrossSectionPositions`, `CrossSectionReinforcementDefinitions`, `CrossSections`, `Currency`, `CurrentValue`, `Curve`, `Curve3D`, `CurveColour`, `CurveFont`, `CurveFontScaling`, `CurveForm`, `CurveGeometry`, `CurveInterpolation`, `CurveOnRelatedElement`, `CurveOnRelatingElement`, `CurveWidth`, `DailyInteraction`, `DataOrigin`, `DataValue`, `DateComponent`, `DayComponent`, `DaylightSavingOffset`, `DefinedUnit`, `DefinedValues`, `DefiningUnit`, `DefiningValues`, `Definition`, `DefinitionType`, `Degree`, `DeltaT_Constant`, `DeltaT_Y`, `DeltaT_Z`, `DeltaTConstant`, `DeltaTY`, `DeltaTZ`, `DependantProperty`, `DependingProperty`, `DepreciatedValue`, `Depth`, `Description`, `DestabilizingLoad`, `DiffuseColour`, `DiffuseReflectionColour`, `DiffuseTransmissionColour`, `Dimensions`, `Dir`, `Direction`, `DirectionRatios`, `DirectionSense`, `Directrix`, `Discrimination`, `DispersionFactor`, `DisplacementX`, `DisplacementY`, `DisplacementZ`, `DissolvedSolidsContent`, `Distance`, `DistanceAlong`, `DistanceAttenuation`, `Distortion`, `DistributionData`, `DistributionPointFunction`, `DocumentId`, `DocumentOwner`, `DocumentReferences`, `Duration`, `DurationType`, `DynamicViscosity`, `EarlyDate`, `EarlyFinish`, `EarlyStart`, `Eastings`, `EccentricityInX`, `EccentricityInY`, `EccentricityInZ`, `EdgeElement`, `EdgeEnd`, `EdgeGeometry`, `EdgeList`, `EdgeRadius`, `EdgeStart`, `Edition`, `EditionDate`, `Editors`, `EffectiveDepth`, `ElectricCurrentExponent`, `ElectricCurrentType`, `ElectronicFormat`, `ElectronicMailAddresses`, `Elements`, `ElementType`, `Elevation`, `ElevationOfRefHeight`, `ElevationOfTerrain`, `ElevationWithFlooring`, `Enclosure`, `EndParam`, `EndProfile`, `EndRadius`, `EndSweptArea`, `EndTag`, `EndTime`, `EnergySequence`, `EnumerationReference`, `EnumerationValues`, `Enumerators`, `EventOccurenceTime`, `EventTriggerType`, `ExceptionTimes`, `ExchangeRate`, `Exponent`, `Expression`, `ExtendedProperties`, `Extent`, `ExtrudedDirection`, `Faces`, `FaceSurface`, `FacsimileNumbers`, `Factor`, `FamilyName`, `FbsmFaces`, `FeatureLength`, `FileExtension`, `FilletRadius`, `FillStyles`, `FillStyleTarget`, `Finish`, `FinishFloat`, `FinishTime`, `FirstMullionOffset`, `FirstOperand`, `FirstTransomOffset`, `FixedAxisVertical`, `FixedReference`, `FixedUntilDate`, `Flags`, `FlangeEdgeRadius`, `FlangeSlope`, `FlangeThickness`, `FlangeWidth`, `FlowConditionSingleValue`, `FlowConditionTimeSeries`, `FlowDirection`, `FlowrateSingleValue`, `FlowrateTimeSeries`, `Fluid`, `FontFamily`, `FontSize`, `FontStyle`, `FontVariant`, `FontWeight`, `ForceX`, `ForceY`, `ForceZ`, `ForLayerSet`, `Formula`, `ForProfileEndSet`, `ForProfileSet`, `Fraction`, `FrameDepth`, `FrameThickness`, `FreeFloat`, `FreezingPoint`, `Frequency`, `FrictionCoefficient`, `FullLoadCurrent`, `GeodeticDatum`, `Girth`, `GivenName`, `GivingApproval`, `GlobalId`, `GlobalOrLocal`, `Green`, `HardeningModule`, `Hardness`, `HasProperties`, `HasPropertySets`, `HasPropertyTemplates`, `HasQuantities`, `HasResults`, `HatchLineAngle`, `HatchLineAppearance`, `HeadDepth2`, `HeadDepth3`, `HeadWidth`, `Height`, `HigherHeatingValue`, `Horizontal`, `HorizontalLength`, `HourComponent`, `HourOffset`, `Id`, `ID`, `Identification`, `Identifier`, `ImpactType`, `ImplicitOuter`, `ImpliedOrder`, `ImportanceRating`, `ImpuritiesContent`, `IncorporationDate`, `InitialStress`, `InnerBoundaries`, `InnerCoordIndices`, `InnerCurves`, `InnerFilletRadius`, `InnerRadius`, `InnerReference`, `InputFrequency`, `InputPhase`, `InputVoltage`, `InstanceName`, `IntendedUse`, `Intensity`, `Intent`, `InterferenceGeometry`, `InterferenceType`, `InteriorOrExteriorSpace`, `InternalFilletRadius`, `InternalLocation`, `InternalOrExternalBoundary`, `IntersectingAxes`, `Interval`, `InventoryType`, `InvisibleSegmentLength`, `IsAttenuating`, `IsCCW`, `IsConvex`, `IsCritical`, `IsEndRadiusCCW`, `IsHeading`, `IsLinear`, `IsMilestone`, `IsothermalMoistureCapacity`, `IsOverAllocated`, `IsPotable`, `IsStartRadiusCCW`, `IsVentilated`, `Item`, `ItemOf`, `ItemReference`, `Items`, `JobDescription`, `Jurisdiction`, `KnotMultiplicities`, `Knots`, `KnotSpec`, `Label`, `LagValue`, `LandTitleNumber`, `Language`, `LastModifiedDate`, `LastModifyingApplication`, `LastModifyingUser`, `LastRevisionTime`, `LastUpdateDate`, `LateDate`, `LateFinish`, `LateralAxisDirection`, `LateStart`, `LayerBlocked`, `LayerFrozen`, `LayerOn`, `LayerSetDirection`, `LayerSetName`, `LayerStyles`, `LayerThickness`, `LegSlope`, `LengthExponent`, `LengthValue`, `LetterSpacing`, `Level`, `LevelingDelay`, `LibraryReference`, `LifeCyclePhase`, `LightColour`, `LightDistributionCurve`, `LightDistributionDataSource`, `LightEmissionSource`, `LinearForceX`, `LinearForceY`, `LinearForceZ`, `LinearMomentX`, `LinearMomentY`, `LinearMomentZ`, `LinearStiffnessByAreaX`, `LinearStiffnessByAreaY`, `LinearStiffnessByAreaZ`, `LinearStiffnessByLengthX`, `LinearStiffnessByLengthY`, `LinearStiffnessByLengthZ`, `LinearStiffnessX`, `LinearStiffnessY`, `LinearStiffnessZ`, `LineHeight`, `LiningDepth`, `LiningOffset`, `LiningThickness`, `LiningToPanelOffsetX`, `LiningToPanelOffsetY`, `ListPositions`, `ListValues`, `Literal`, `LoadedBy`, `LocalOrigin`, `Location`, `LocationAtRelatedElement`, `LocationAtRelatingElement`, `LocationOfInteraction`, `Locations`, `LogicalAggregator`, `LongDescription`, `LongitudinalBarCrossSectionArea`, `LongitudinalBarNominalDiameter`, `LongitudinalBarSpacing`, `LongitudinalEndPosition`, `LongitudinalStartPosition`, `LongName`, `LoopVertex`, `LowerBoundValue`, `LowerHeatingValue`, `LowerValue`, `LowerVaporResistanceFactor`, `LuminousFlux`, `LuminousIntensity`, `LuminousIntensityExponent`, `Magnitude`, `MainPlaneAngle`, `MajorRadius`, `MappedRepresentation`, `MappedTo`, `MappingOrigin`, `MappingSource`, `MappingTarget`, `MapProjection`, `Maps`, `MapUnit`, `MapZone`, `MassDensity`, `MassExponent`, `MasterRepresentation`, `Material`, `MaterialClassifications`, `MaterialConstituents`, `MaterialLayers`, `MaterialProfiles`, `Materials`, `MaxAggregateSize`, `MaximumPlateThickness`, `MaximumPowerInput`, `MaximumSectionModulusY`, `MaximumSectionModulusZ`, `MaximumValue`, `MaxRequiredArea`, `MeshLength`, `MeshWidth`, `MessagingIDs`, `MethodOfMeasurement`, `MiddleNames`, `MimeContentType`, `MimeSubtype`, `MinCurvatureRadius`, `MinimumCircuitCurrent`, `MinimumPlateThickness`, `MinimumSectionModulusY`, `MinimumSectionModulusZ`, `MinimumValue`, `MinorRadius`, `MinRequiredArea`, `MinuteComponent`, `MinuteOffset`, `Mode`, `ModelorDraughting`, `ModelOrDraughting`, `MoistureDiffusivity`, `MolecularWeight`, `MomentOfInertiaY`, `MomentOfInertiaYZ`, `MomentOfInertiaZ`, `MomentX`, `MomentY`, `MomentZ`, `MonthComponent`, `MostUsedValue`, `MoveFrom`, `MoveTo`, `MullionThickness`, `N20Content`, `Name`, `NominalBarDiameter`, `NominalDiameter`, `NominalLength`, `NominalValue`, `Normals`, `Northings`, `Notation`, `NotationFacets`, `NotationValue`, `NumberOfRiser`, `NumberOfRisers`, `NumberOfTreads`, `ObjectiveQualifier`, `ObjectPlacement`, `ObjectType`, `Occurrences`, `OffsetDirection`, `OffsetDistances`, `OffsetFromReferenceLine`, `OffsetLateral`, `OffsetLongitudinal`, `OffsetValues`, `OffsetVertical`, `Opacity`, `OperationType`, `Operator`, `Orientation`, `OrientationOf2DPlane`, `OriginalValue`, `OrthogonalHeight`, `Outer`, `OuterBoundary`, `OuterCurve`, `OuterFilletRadius`, `OverallDepth`, `OverallHeight`, `OverallWidth`, `OverridingProperties`, `Owner`, `OwnerHistory`, `OwningApplication`, `OwningUser`, `PagerNumber`, `PanelDepth`, `PanelOperation`, `PanelPosition`, `PanelWidth`, `ParabolaConstant`, `Parameter`, `ParameterTakesPrecedence`, `ParamLength`, `ParentBoundary`, `ParentContext`, `ParentCurve`, `ParentEdge`, `ParentProfile`, `PartitioningType`, `PartOfProductDefinitionShape`, `Path`, `PatternList`, `PatternStart`, `Perimeter`, `PermitID`, `Phase`, `PHLevel`, `PhysicalOrVirtualBoundary`, `PhysicalWeight`, `Pixel`, `Placement`, `PlacementLocation`, `PlacementRefDirection`, `PlacementRelTo`, `PlanarForceX`, `PlanarForceY`, `PlanarForceZ`, `PlasticShapeFactorY`, `PlasticShapeFactorZ`, `PlasticStrain`, `PnIndex`, `Pnt`, `PointOfReferenceHatchLine`, `PointOnRelatedElement`, `PointOnRelatingElement`, `PointParameter`, `PointParameterU`, `PointParameterV`, `Points`, `PoissonRatio`, `Polygon`, `PolygonalBoundary`, `Porosity`, `Position`, `PostalBox`, `PostalCode`, `Precision`, `PredefinedType`, `Prefix`, `PrefixTitles`, `PreparedBy`, `PressureSingleValue`, `PressureTimeSeries`, `PreStress`, `PrimaryMeasureType`, `PrimaryUnit`, `Priority`, `ProcedureID`, `ProcedureType`, `ProcessType`, `ProductDefinitional`, `Profile`, `ProfileDefinition`, `ProfileName`, `ProfileOfPort`, `ProfileOrientation`, `Profiles`, `ProfileSectionLocation`, `ProfileType`, `ProjectedOrTrue`, `Properties`, `PropertyReference`, `PropertySource`, `ProportionalStress`, `ProtectivePoreRatio`, `ProxyType`, `Publisher`, `PunchList`, `Purpose`, `QuadricAttenuation`, `Qualifier`, `Quality`, `Quantities`, `QuantityInProcess`, `Radius`, `RasterCode`, `RasterFormat`, `RateDateTime`, `RatedPowerInput`, `RateSource`, `RealizingElement`, `RealizingElements`, `Records`, `Recurrence`, `RecurrencePattern`, `RecurrenceType`, `Red`, `RefDirection`, `RefElevation`, `ReferenceCurve`, `ReferencedDocument`, `ReferencedLibrary`, `ReferencedSource`, `ReferencedTimeSeries`, `ReferenceExtent`, `ReferencePath`, `ReferenceSurface`, `ReferenceTokens`, `ReferencingValues`, `RefLatitude`, `ReflectanceColour`, `ReflectanceMethod`, `ReflectionColour`, `RefLongitude`, `RefractionIndex`, `Region`, `ReinforcementRole`, `ReinforcementSectionDefinitions`, `RelatedApproval`, `RelatedApprovals`, `RelatedBuildingElement`, `RelatedBuildings`, `RelatedClassifications`, `RelatedConnectionType`, `RelatedConstraints`, `RelatedControlElements`, `RelatedCoverings`, `RelatedDefinitions`, `RelatedDocuments`, `RelatedDraughtingCallout`, `RelatedElement`, `RelatedElements`, `RelatedFeatureElement`, `RelatedItems`, `RelatedMaterials`, `RelatedMonetaryUnit`, `RelatedObjects`, `RelatedObjectsType`, `RelatedOpeningElement`, `RelatedOrganizations`, `RelatedPort`, `RelatedPriorities`, `RelatedProcess`, `RelatedProperties`, `RelatedPropertySets`, `RelatedResourceObjects`, `RelatedSpace`, `RelatedSpaceProgram`, `RelatedStructuralActivity`, `RelatedStructuralConnection`, `RelatedStructuralMember`, `RelatingActor`, `RelatingAppliedValue`, `RelatingApproval`, `RelatingBuildingElement`, `RelatingClassification`, `RelatingConnectionType`, `RelatingConstraint`, `RelatingContext`, `RelatingControl`, `RelatingDocument`, `RelatingDraughtingCallout`, `RelatingElement`, `RelatingFlowElement`, `RelatingGroup`, `RelatingItem`, `RelatingLibrary`, `RelatingMaterial`, `RelatingMonetaryUnit`, `RelatingObject`, `RelatingOpeningElement`, `RelatingOrganization`, `RelatingPort`, `RelatingPriorities`, `RelatingProcess`, `RelatingProduct`, `RelatingProfileProperties`, `RelatingPropertyDefinition`, `RelatingReference`, `RelatingResource`, `RelatingSpace`, `RelatingSpaceProgram`, `RelatingStructuralMember`, `RelatingStructure`, `RelatingSystem`, `RelatingTemplate`, `RelatingType`, `RelationshipType`, `RelativePlacement`, `Relaxations`, `RelaxationValue`, `RemainingTime`, `RemainingUsage`, `RemainingWork`, `RepeatFactor`, `RepeatS`, `RepeatT`, `Representation`, `RepresentationContexts`, `RepresentationIdentifier`, `RepresentationMaps`, `Representations`, `RepresentationType`, `RepresentedMaterial`, `RequestedLocation`, `RequestID`, `RequestingApproval`, `ResourceConsumption`, `ResourceGroup`, `ResourceIdentifier`, `ResourceType`, `ResponsiblePerson`, `ResponsiblePersons`, `RestartDistance`, `ResultForLoadGroup`, `ResultValues`, `Revision`, `RibHeight`, `RibSpacing`, `RibWidth`, `RiserHeight`, `Role`, `Roles`, `RotationalDisplacementRX`, `RotationalDisplacementRY`, `RotationalDisplacementRZ`, `RotationalStiffnessByLengthX`, `RotationalStiffnessByLengthY`, `RotationalStiffnessByLengthZ`, `RotationalStiffnessX`, `RotationalStiffnessY`, `RotationalStiffnessZ`, `RoundingRadius`, `RowCells`, `Rows`, `SameSense`, `SbsmBoundary`, `Scale`, `Scale2`, `Scale3`, `ScheduleContour`, `ScheduleDate`, `ScheduleDuration`, `ScheduleFinish`, `ScheduleStart`, `ScheduleUsage`, `ScheduleWork`, `Scope`, `SecondaryMeasureType`, `SecondaryPlaneAngle`, `SecondaryUnit`, `SecondComponent`, `SecondMullionOffset`, `SecondOperand`, `SecondRepeatFactor`, `SecondTransomOffset`, `SectionDefinition`, `SectionType`, `SegmentLength`, `Segments`, `SelfIntersect`, `SelfWeightCoefficients`, `SemiAxis1`, `SemiAxis2`, `Sense`, `SenseAgreement`, `SequenceType`, `ServiceLifeDuration`, `ServiceLifeType`, `SetPointValue`, `ShapeAspectStyle`, `ShapeRepresentations`, `ShapeType`, `SharedPlacement`, `ShearAreaY`, `ShearAreaZ`, `ShearCentreY`, `ShearCentreZ`, `ShearDeformationAreaY`, `ShearDeformationAreaZ`, `ShearModulus`, `ShearReinforcement`, `SheathDiameter`, `Side`, `SiteAddress`, `Sizeable`, `SizeInX`, `SizeInY`, `SkillSet`, `SlippageX`, `SlippageY`, `SlippageZ`, `SolarReflectanceBack`, `SolarReflectanceFront`, `SolarTransmittance`, `Sort`, `SoundLevelSingleValue`, `SoundLevelTimeSeries`, `SoundScale`, `SoundValues`, `Source`, `SourceCRS`, `SourceDescription`, `SpaceProgramIdentifier`, `SpecificHeatCapacity`, `SpecularColour`, `SpecularHighlight`, `SpineCurve`, `SpreadAngle`, `StandardRequiredArea`, `Start`, `StartDirection`, `StartDistAlong`, `StartFloat`, `StartGradient`, `StartHeight`, `StartOfNextHatchLine`, `StartParam`, `StartPoint`, `StartProfile`, `StartRadius`, `StartTag`, `StartTime`, `State`, `Status`, `StatusTime`, `SteelGrade`, `StyleOfSymbol`, `Styles`, `SubContractor`, `SubmittedBy`, `SubmittedOn`, `SubsequentAppliedLoads`, `SubsequentThickness`, `SuffixTitles`, `Suppliers`, `SupportedLength`, `SurfaceColour`, `SurfaceForm`, `SurfaceOnRelatedElement`, `SurfaceOnRelatingElement`, `SurfaceReinforcement1`, `SurfaceReinforcement2`, `SweptArea`, `SweptCurve`, `Symbol`, `SystemType`, `Tag`, `TagList`, `TangentialContinuity`, `Target`, `TargetCRS`, `TargetScale`, `TargetUsers`, `TargetView`, `TaskId`, `TaskTime`, `TelephoneNumbers`, `TemperatureSingleValue`, `TemperatureTimeSeries`, `TemplateType`, `TensionFailureX`, `TensionFailureY`, `TensionFailureZ`, `TensionForce`, `TexCoordIndex`, `TexCoords`, `TexCoordsList`, `TextAlign`, `TextCharacterAppearance`, `TextDecoration`, `TextFontStyle`, `TextIndent`, `TextStyle`, `TextTransform`, `TextureCoordinates`, `TextureMaps`, `TexturePoints`, `Textures`, `TextureTransform`, `TextureType`, `TextureVertices`, `TheActor`, `TheOrganization`, `TheoryType`, `ThePerson`, `ThermalConductivity`, `ThermalExpansionCoefficient`, `ThermalIrEmissivityBack`, `ThermalIrEmissivityFront`, `ThermalIrTransmittance`, `ThermalLoadSource`, `ThermalLoadTimeSeriesValues`, `ThermalLoadType`, `ThermodynamicTemperatureExponent`, `Thickness`, `ThresholdDepth`, `ThresholdOffset`, `ThresholdThickness`, `Tiles`, `TilingPattern`, `TilingScale`, `TimeComponent`, `TimeExponent`, `TimeForTask`, `TimeLag`, `TimeOfApproval`, `TimePeriods`, `TimeSeries`, `TimeSeriesDataType`, `TimeSeriesReferences`, `TimeSeriesScheduleType`, `TimeStamp`, `TimeStep`, `TimeValue`, `Title`, `TopFlangeEdgeRadius`, `TopFlangeFilletRadius`, `TopFlangeSlope`, `TopFlangeThickness`, `TopFlangeWidth`, `TopXDim`, `TopXOffset`, `TorsionalConstantX`, `TorsionalSectionModulus`, `TotalCrossSectionArea`, `TotalFloat`, `TotalReplacementCost`, `Town`, `Transition`, `TransitionCurveType`, `TranslationalStiffnessByAreaX`, `TranslationalStiffnessByAreaY`, `TranslationalStiffnessByAreaZ`, `TranslationalStiffnessByLengthX`, `TranslationalStiffnessByLengthY`, `TranslationalStiffnessByLengthZ`, `TranslationalStiffnessX`, `TranslationalStiffnessY`, `TranslationalStiffnessZ`, `TransmissionColour`, `TransomOffset`, `TransomThickness`, `Transparency`, `TransverseBarCrossSectionArea`, `TransverseBarNominalDiameter`, `TransverseBarSpacing`, `TransversePosition`, `TreadLength`, `TreeRootExpression`, `Trim1`, `Trim2`, `TrueNorth`, `TypeIdentifier`, `U1`, `U2`, `UAxes`, `UClosed`, `UDegree`, `UKnots`, `UltimateStrain`, `UltimateStress`, `UMultiplicities`, `Unit`, `UnitBasis`, `UnitComponent`, `Units`, `UnitsInContext`, `UnitType`, `UpdateDate`, `UpperBoundValue`, `UpperValue`, `UpperVaporResistanceFactor`, `UrlReference`, `URLReference`, `Usage`, `UsageName`, `UsageRatio`, `Usense`, `User`, `UserDefinedCategory`, `UserDefinedControlType`, `UserDefinedDataOrigin`, `UserDefinedEnergySequence`, `UserDefinedEventTriggerType`, `UserDefinedFunction`, `UserDefinedGrade`, `UserDefinedOperationType`, `UserDefinedPartitioningType`, `UserDefinedProcedureType`, `UserDefinedPropertySource`, `UserDefinedPurpose`, `UserDefinedQualifier`, `UserDefinedRole`, `UserDefinedSequenceType`, `UserDefinedTargetView`, `UserDefinedThermalLoadSource`, `UserDefinedType`, `V1`, `V2`, `ValidFrom`, `ValidUntil`, `ValueComponent`, `Values`, `ValueSource`, `VaporPermeability`, `VaryingAppliedLoadLocation`, `VaryingThicknessLocation`, `VAxes`, `VClosed`, `VDegree`, `VelocitySingleValue`, `VelocityTimeSeries`, `Version`, `VersionDate`, `VertexGeometry`, `Vertical`, `VerticalAxisDirection`, `VerticalDatum`, `Vertices`, `VisibleReflectanceBack`, `VisibleReflectanceFront`, `VisibleSegmentLength`, `VisibleTransmittance`, `VKnots`, `VMultiplicities`, `Voids`, `VolumeOnRelatedElement`, `VolumeOnRelatingElement`, `VolumeValue`, `Vsense`, `WallThickness`, `WarpingConstant`, `WarpingMoment`, `WarpingStiffness`, `WaterImpermeability`, `WAxes`, `WebEdgeRadius`, `WebSlope`, `WebThickness`, `WeekdayComponent`, `WeightsData`, `WeightValue`, `WetBulbTemperatureSingleValue`, `WetBulbTemperatureTimeSeries`, `Width`, `WordSpacing`, `Workability`, `WorkControlType`, `WorkingTimes`, `WorkMethod`, `WorldCoordinateSystem`, `WWWHomePageURL`, `XAxisAbscissa`, `XAxisOrdinate`, `XDim`, `XLength`, `YDim`, `YearComponent`, `YieldStress`, `YLength`, `YoungModulus`, `ZDim`, `ZLength`, `Zone`
- `Bricscad.Ifc.IfcBinary` — class；构造器：2；方法：`Clear`, `GetBit`, `GetEncodedString`, `Reset`, `Resize`；属性：`IsEmpty{get}`, `NumBits{get}`
- `Bricscad.Ifc.IfcEntity` — class；构造器：2；方法：`Create`, `GetAttribute`, `GetInverseRefs`, `IsKindOf`, `SetAttribute`；属性：`IfcId{get}`, `IsA{get}`, `IsNull{get}`
- `Bricscad.Ifc.IfcEntityDesc` — class；构造器：0；方法：`IsDerivedFrom`, `op_Equality`, `op_Inequality`；属性：`Name{get}`；字段：`Ifc2DCompositeCurve`, `IfcActionRequest`, `IfcActor`, `IfcActorRole`, `IfcActuator`, `IfcActuatorType`, `IfcAddress`, `IfcAdvancedBrep`, `IfcAdvancedBrepWithVoids`, `IfcAdvancedFace`, `IfcAirTerminal`, `IfcAirTerminalBox`, `IfcAirTerminalBoxType`, `IfcAirTerminalType`, `IfcAirToAirHeatRecovery`, `IfcAirToAirHeatRecoveryType`, `IfcAlarm`, `IfcAlarmType`, `IfcAlignment`, `IfcAlignment2DHorizontal`, `IfcAlignment2DHorizontalSegment`, `IfcAlignment2DSegment`, `IfcAlignment2DVerSegCircularArc`, `IfcAlignment2DVerSegLine`, `IfcAlignment2DVerSegParabolicArc`, `IfcAlignment2DVertical`, `IfcAlignment2DVerticalSegment`, `IfcAlignmentCurve`, `IfcAngularDimension`, `IfcAnnotation`, `IfcAnnotationCurveOccurrence`, `IfcAnnotationFillArea`, `IfcAnnotationFillAreaOccurrence`, `IfcAnnotationOccurrence`, `IfcAnnotationSurface`, `IfcAnnotationSurfaceOccurrence`, `IfcAnnotationSymbolOccurrence`, `IfcAnnotationTextOccurrence`, `IfcApplication`, `IfcAppliedValue`, `IfcAppliedValueRelationship`, `IfcApproval`, `IfcApprovalActorRelationship`, `IfcApprovalPropertyRelationship`, `IfcApprovalRelationship`, `IfcArbitraryClosedProfileDef`, `IfcArbitraryOpenProfileDef`, `IfcArbitraryProfileDefWithVoids`, `IfcAsset`, `IfcAsymmetricIShapeProfileDef`, `IfcAudioVisualAppliance`, `IfcAudioVisualApplianceType`, `IfcAxis1Placement`, `IfcAxis2Placement2D`, `IfcAxis2Placement3D`, `IfcBeam`, `IfcBeamStandardCase`, `IfcBeamType`, `IfcBezierCurve`, `IfcBlobTexture`, `IfcBlock`, `IfcBoiler`, `IfcBoilerType`, `IfcBooleanClippingResult`, `IfcBooleanResult`, `IfcBoundaryCondition`, `IfcBoundaryCurve`, `IfcBoundaryEdgeCondition`, `IfcBoundaryFaceCondition`, `IfcBoundaryNodeCondition`, `IfcBoundaryNodeConditionWarping`, `IfcBoundedCurve`, `IfcBoundedSurface`, `IfcBoundingBox`, `IfcBoxedHalfSpace`, `IfcBSplineCurve`, `IfcBSplineCurveWithKnots`, `IfcBSplineSurface`, `IfcBSplineSurfaceWithKnots`, `IfcBuilding`, `IfcBuildingElement`, `IfcBuildingElementComponent`, `IfcBuildingElementPart`, `IfcBuildingElementPartType`, `IfcBuildingElementProxy`, `IfcBuildingElementProxyType`, `IfcBuildingElementType`, `IfcBuildingStorey`, `IfcBuildingSystem`, `IfcBurner`, `IfcBurnerType`, `IfcCableCarrierFitting`, `IfcCableCarrierFittingType`, `IfcCableCarrierSegment`, `IfcCableCarrierSegmentType`, `IfcCableFitting`, `IfcCableFittingType`, `IfcCableSegment`, `IfcCableSegmentType`, `IfcCalendarDate`, `IfcCartesianPoint`, `IfcCartesianPointList`, `IfcCartesianPointList2D`, `IfcCartesianPointList3D`, `IfcCartesianTransformationOperator`, `IfcCartesianTransformationOperator2D`, `IfcCartesianTransformationOperator2DnonUniform`, `IfcCartesianTransformationOperator3D`, `IfcCartesianTransformationOperator3DnonUniform`, `IfcCenterLineProfileDef`, `IfcChamferEdgeFeature`, `IfcChiller`, `IfcChillerType`, `IfcChimney`, `IfcChimneyType`, `IfcCircle`, `IfcCircleHollowProfileDef`, `IfcCircleProfileDef`, `IfcCircularArcSegment2D`, `IfcCivilElement`, `IfcCivilElementType`, `IfcClassification`, `IfcClassificationItem`, `IfcClassificationItemRelationship`, `IfcClassificationNotation`, `IfcClassificationNotationFacet`, `IfcClassificationReference`, `IfcClosedShell`, `IfcCoil`, `IfcCoilType`, `IfcColourRgb`, `IfcColourRgbList`, `IfcColourSpecification`, `IfcColumn`, `IfcColumnStandardCase`, `IfcColumnType`, `IfcCommunicationsAppliance`, `IfcCommunicationsApplianceType`, `IfcComplexProperty`, `IfcComplexPropertyTemplate`, `IfcCompositeCurve`, `IfcCompositeCurveOnSurface`, `IfcCompositeCurveSegment`, `IfcCompositeProfileDef`, `IfcCompressor`, `IfcCompressorType`, `IfcCondenser`, `IfcCondenserType`, `IfcCondition`, `IfcConditionCriterion`, `IfcConic`, `IfcConnectedFaceSet`, `IfcConnectionCurveGeometry`, `IfcConnectionGeometry`, `IfcConnectionPointEccentricity`, `IfcConnectionPointGeometry`, `IfcConnectionPortGeometry`, `IfcConnectionSurfaceGeometry`, `IfcConnectionVolumeGeometry`, `IfcConstraint`, `IfcConstraintAggregationRelationship`, `IfcConstraintClassificationRelationship`, `IfcConstraintRelationship`, `IfcConstructionEquipmentResource`, `IfcConstructionEquipmentResourceType`, `IfcConstructionMaterialResource`, `IfcConstructionMaterialResourceType`, `IfcConstructionProductResource`, `IfcConstructionProductResourceType`, `IfcConstructionResource`, `IfcConstructionResourceType`, `IfcContext`, `IfcContextDependentUnit`, `IfcControl`, `IfcController`, `IfcControllerType`, `IfcConversionBasedUnit`, `IfcConversionBasedUnitWithOffset`, `IfcCooledBeam`, `IfcCooledBeamType`, `IfcCoolingTower`, `IfcCoolingTowerType`, `IfcCoordinatedUniversalTimeOffset`, `IfcCoordinateOperation`, `IfcCoordinateReferenceSystem`, `IfcCostItem`, `IfcCostSchedule`, `IfcCostValue`, `IfcCovering`, `IfcCoveringType`, `IfcCraneRailAShapeProfileDef`, `IfcCraneRailFShapeProfileDef`, `IfcCrewResource`, `IfcCrewResourceType`, `IfcCsgPrimitive3D`, `IfcCsgSolid`, `IfcCShapeProfileDef`, `IfcCurrencyRelationship`, `IfcCurtainWall`, `IfcCurtainWallType`, `IfcCurve`, `IfcCurveBoundedPlane`, `IfcCurveBoundedSurface`, `IfcCurveSegment2D`, `IfcCurveStyle`, `IfcCurveStyleFont`, `IfcCurveStyleFontAndScaling`, `IfcCurveStyleFontPattern`, `IfcCylindricalSurface`, `IfcDamper`, `IfcDamperType`, `IfcDateAndTime`, `IfcDefinedSymbol`, `IfcDerivedProfileDef`, `IfcDerivedUnit`, `IfcDerivedUnitElement`, `IfcDiameterDimension`, `IfcDimensionalExponents`, `IfcDimensionCalloutRelationship`, `IfcDimensionCurve`, `IfcDimensionCurveDirectedCallout`, `IfcDimensionCurveTerminator`, `IfcDimensionPair`, `IfcDirection`, `IfcDiscreteAccessory`, `IfcDiscreteAccessoryType`, `IfcDistanceExpression`, `IfcDistributionChamberElement`, `IfcDistributionChamberElementType`, `IfcDistributionCircuit`, `IfcDistributionControlElement`, `IfcDistributionControlElementType`, `IfcDistributionElement`, `IfcDistributionElementType`, `IfcDistributionFlowElement`, `IfcDistributionFlowElementType`, `IfcDistributionPort`, `IfcDistributionSystem`, `IfcDocumentElectronicFormat`, `IfcDocumentInformation`, `IfcDocumentInformationRelationship`, `IfcDocumentReference`, `IfcDoor`, `IfcDoorLiningProperties`, `IfcDoorPanelProperties`, `IfcDoorStandardCase`, `IfcDoorStyle`, `IfcDoorType`, `IfcDraughtingCallout`, `IfcDraughtingCalloutRelationship`, `IfcDraughtingPreDefinedColour`, `IfcDraughtingPreDefinedCurveFont`, `IfcDraughtingPreDefinedTextFont`, `IfcDuctFitting`, `IfcDuctFittingType`, `IfcDuctSegment`, `IfcDuctSegmentType`, `IfcDuctSilencer`, `IfcDuctSilencerType`, `IfcEdge`, `IfcEdgeCurve`, `IfcEdgeFeature`, `IfcEdgeLoop`, `IfcElectricalBaseProperties`, `IfcElectricalCircuit`, `IfcElectricalElement`, `IfcElectricAppliance`, `IfcElectricApplianceType`, `IfcElectricDistributionBoard`, `IfcElectricDistributionBoardType`, `IfcElectricDistributionPoint`, `IfcElectricFlowStorageDevice`, `IfcElectricFlowStorageDeviceType`, `IfcElectricGenerator`, `IfcElectricGeneratorType`, `IfcElectricHeaterType`, `IfcElectricMotor`, `IfcElectricMotorType`, `IfcElectricTimeControl`, `IfcElectricTimeControlType`, `IfcElement`, `IfcElementarySurface`, `IfcElementAssembly`, `IfcElementAssemblyType`, `IfcElementComponent`, `IfcElementComponentType`, `IfcElementQuantity`, `IfcElementType`, `IfcEllipse`, `IfcEllipseProfileDef`, `IfcEnergyConversionDevice`, `IfcEnergyConversionDeviceType`, `IfcEnergyProperties`, `IfcEngine`, `IfcEngineType`, `IfcEnvironmentalImpactValue`, `IfcEquipmentElement`, `IfcEquipmentStandard`, `IfcEvaporativeCooler`, `IfcEvaporativeCoolerType`, `IfcEvaporator`, `IfcEvaporatorType`, `IfcEvent`, `IfcEventTime`, `IfcEventType`, `IfcExtendedMaterialProperties`, `IfcExtendedProperties`, `IfcExternalInformation`, `IfcExternallyDefinedHatchStyle`, `IfcExternallyDefinedSurfaceStyle`, `IfcExternallyDefinedSymbol`, `IfcExternallyDefinedTextFont`, `IfcExternalReference`, `IfcExternalReferenceRelationship`, `IfcExternalSpatialElement`, `IfcExternalSpatialStructureElement`, `IfcExtrudedAreaSolid`, `IfcExtrudedAreaSolidTapered`, `IfcFace`, `IfcFaceBasedSurfaceModel`, `IfcFaceBound`, `IfcFaceOuterBound`, `IfcFaceSurface`, `IfcFacetedBrep`, `IfcFacetedBrepWithVoids`, `IfcFailureConnectionCondition`, `IfcFan`, `IfcFanType`, `IfcFastener`, `IfcFastenerType`, `IfcFeatureElement`, `IfcFeatureElementAddition`, `IfcFeatureElementSubtraction`, `IfcFillAreaStyle`, `IfcFillAreaStyleHatching`, `IfcFillAreaStyleTiles`, `IfcFillAreaStyleTileSymbolWithStyle`, `IfcFilter`, `IfcFilterType`, `IfcFireSuppressionTerminal`, `IfcFireSuppressionTerminalType`, `IfcFixedReferenceSweptAreaSolid`, `IfcFlowController`, `IfcFlowControllerType`, `IfcFlowFitting`, `IfcFlowFittingType`, `IfcFlowInstrument`, `IfcFlowInstrumentType`, `IfcFlowMeter`, `IfcFlowMeterType`, `IfcFlowMovingDevice`, `IfcFlowMovingDeviceType`, `IfcFlowSegment`, `IfcFlowSegmentType`, `IfcFlowStorageDevice`, `IfcFlowStorageDeviceType`, `IfcFlowTerminal`, `IfcFlowTerminalType`, `IfcFlowTreatmentDevice`, `IfcFlowTreatmentDeviceType`, `IfcFluidFlowProperties`, `IfcFooting`, `IfcFootingType`, `IfcFuelProperties`, `IfcFurnishingElement`, `IfcFurnishingElementType`, `IfcFurniture`, `IfcFurnitureStandard`, `IfcFurnitureType`, `IfcGasTerminalType`, `IfcGeneralMaterialProperties`, `IfcGeneralProfileProperties`, `IfcGeographicElement`, `IfcGeographicElementType`, `IfcGeometricCurveSet`, `IfcGeometricRepresentationContext`, `IfcGeometricRepresentationItem`, `IfcGeometricRepresentationSubContext`, `IfcGeometricSet`, `IfcGrid`, `IfcGridAxis`, `IfcGridPlacement`, `IfcGroup`, `IfcHalfSpaceSolid`, `IfcHeatExchanger`, `IfcHeatExchangerType`, `IfcHumidifier`, `IfcHumidifierType`, `IfcHygroscopicMaterialProperties`, `IfcImageTexture`, `IfcIndexedColourMap`, `IfcIndexedPolyCurve`, `IfcIndexedPolygonalFace`, `IfcIndexedPolygonalFaceWithVoids`, `IfcIndexedTextureMap`, `IfcIndexedTriangleTextureMap`, `IfcInterceptor`, `IfcInterceptorType`, `IfcIntersectionCurve`, `IfcInventory`, `IfcIrregularTimeSeries`, `IfcIrregularTimeSeriesValue`, `IfcIShapeProfileDef`, `IfcJunctionBox`, `IfcJunctionBoxType`, `IfcLaborResource`, `IfcLaborResourceType`, `IfcLagTime`, `IfcLamp`, `IfcLampType`, `IfcLibraryInformation`, `IfcLibraryReference`, `IfcLightDistributionData`, `IfcLightFixture`, `IfcLightFixtureType`, `IfcLightIntensityDistribution`, `IfcLightSource`, `IfcLightSourceAmbient`, `IfcLightSourceDirectional`, `IfcLightSourceGoniometric`, `IfcLightSourcePositional`, `IfcLightSourceSpot`, `IfcLine`, `IfcLinearDimension`, `IfcLinearPlacement`, `IfcLinearPositioningElement`, `IfcLineSegment2D`, `IfcLocalPlacement`, `IfcLocalTime`, `IfcLoop`, `IfcLShapeProfileDef`, `IfcManifoldSolidBrep`, `IfcMapConversion`, `IfcMappedItem`, `IfcMaterial`, `IfcMaterialClassificationRelationship`, `IfcMaterialConstituent`, `IfcMaterialConstituentSet`, `IfcMaterialDefinition`, `IfcMaterialDefinitionRepresentation`, `IfcMaterialLayer`, `IfcMaterialLayerSet`, `IfcMaterialLayerSetUsage`, `IfcMaterialLayerWithOffsets`, `IfcMaterialList`, `IfcMaterialProfile`, `IfcMaterialProfileSet`, `IfcMaterialProfileSetUsage`, `IfcMaterialProfileSetUsageTapering`, `IfcMaterialProfileWithOffsets`, `IfcMaterialProperties`, `IfcMaterialRelationship`, `IfcMaterialUsageDefinition`, `IfcMeasureWithUnit`, `IfcMechanicalConcreteMaterialProperties`, `IfcMechanicalFastener`, `IfcMechanicalFastenerType`, `IfcMechanicalMaterialProperties`, `IfcMechanicalSteelMaterialProperties`, `IfcMedicalDevice`, `IfcMedicalDeviceType`, `IfcMember`, `IfcMemberStandardCase`, `IfcMemberType`, `IfcMetric`, `IfcMirroredProfileDef`, `IfcMonetaryUnit`, `IfcMotorConnection`, `IfcMotorConnectionType`, `IfcMove`, `IfcNamedUnit`, `IfcObject`, `IfcObjectDefinition`, `IfcObjective`, `IfcObjectPlacement`, `IfcOccupant`, `IfcOffsetCurve`, `IfcOffsetCurve2D`, `IfcOffsetCurve3D`, `IfcOffsetCurveByDistances`, `IfcOneDirectionRepeatFactor`, `IfcOpeningElement`, `IfcOpeningStandardCase`, `IfcOpenShell`, `IfcOpticalMaterialProperties`, `IfcOrderAction`, `IfcOrganization`, `IfcOrganizationRelationship`, `IfcOrientationExpression`, `IfcOrientedEdge`, `IfcOuterBoundaryCurve`, `IfcOutlet`, `IfcOutletType`, `IfcOwnerHistory`, `IfcParameterizedProfileDef`, `IfcPath`, `IfcPcurve`, `IfcPerformanceHistory`, `IfcPermeableCoveringProperties`, `IfcPermit`, `IfcPerson`, `IfcPersonAndOrganization`, `IfcPhysicalComplexQuantity`, `IfcPhysicalQuantity`, `IfcPhysicalSimpleQuantity`, `IfcPile`, `IfcPileType`, `IfcPipeFitting`, `IfcPipeFittingType`, `IfcPipeSegment`, `IfcPipeSegmentType`, `IfcPixelTexture`, `IfcPlacement`, `IfcPlanarBox`, `IfcPlanarExtent`, `IfcPlane`, `IfcPlate`, `IfcPlateStandardCase`, `IfcPlateType`, `IfcPoint`, `IfcPointOnCurve`, `IfcPointOnSurface`, `IfcPolygonalBoundedHalfSpace`, `IfcPolygonalFaceSet`, `IfcPolyline`, `IfcPolyLoop`, `IfcPort`, `IfcPositioningElement`, `IfcPostalAddress`, `IfcPreDefinedColour`, `IfcPreDefinedCurveFont`, `IfcPreDefinedDimensionSymbol`, `IfcPreDefinedItem`, `IfcPreDefinedPointMarkerSymbol`, `IfcPreDefinedProperties`, `IfcPreDefinedPropertySet`, `IfcPreDefinedSymbol`, `IfcPreDefinedTerminatorSymbol`, `IfcPreDefinedTextFont`, `IfcPresentationItem`, `IfcPresentationLayerAssignment`, `IfcPresentationLayerWithStyle`, `IfcPresentationStyle`, `IfcPresentationStyleAssignment`, `IfcProcedure`, `IfcProcedureType`, `IfcProcess`, `IfcProduct`, `IfcProductDefinitionShape`, `IfcProductRepresentation`, `IfcProductsOfCombustionProperties`, `IfcProfileDef`, `IfcProfileProperties`, `IfcProject`, `IfcProjectedCRS`, `IfcProjectionCurve`, `IfcProjectionElement`, `IfcProjectLibrary`, `IfcProjectOrder`, `IfcProjectOrderRecord`, `IfcProperty`, `IfcPropertyAbstraction`, `IfcPropertyBoundedValue`, `IfcPropertyConstraintRelationship`, `IfcPropertyDefinition`, `IfcPropertyDependencyRelationship`, `IfcPropertyEnumeratedValue`, `IfcPropertyEnumeration`, `IfcPropertyListValue`, `IfcPropertyReferenceValue`, `IfcPropertySet`, `IfcPropertySetDefinition`, `IfcPropertySetTemplate`, `IfcPropertySingleValue`, `IfcPropertyTableValue`, `IfcPropertyTemplate`, `IfcPropertyTemplateDefinition`, `IfcProtectiveDevice`, `IfcProtectiveDeviceTrippingUnit`, `IfcProtectiveDeviceTrippingUnitType`, `IfcProtectiveDeviceType`, `IfcProxy`, `IfcPump`, `IfcPumpType`, `IfcQuantityArea`, `IfcQuantityCount`, `IfcQuantityLength`, `IfcQuantitySet`, `IfcQuantityTime`, `IfcQuantityVolume`, `IfcQuantityWeight`, `IfcRadiusDimension`, `IfcRailing`, `IfcRailingType`, `IfcRamp`, `IfcRampFlight`, `IfcRampFlightType`, `IfcRampType`, `IfcRationalBezierCurve`, `IfcRationalBSplineCurveWithKnots`, `IfcRationalBSplineSurfaceWithKnots`, `IfcRectangleHollowProfileDef`, `IfcRectangleProfileDef`, `IfcRectangularPyramid`, `IfcRectangularTrimmedSurface`, `IfcRecurrencePattern`, `IfcReference`, `IfcReferencesValueDocument`, `IfcReferent`, `IfcRegularTimeSeries`, `IfcReinforcementBarProperties`, `IfcReinforcementDefinitionProperties`, `IfcReinforcingBar`, `IfcReinforcingBarType`, `IfcReinforcingElement`, `IfcReinforcingElementType`, `IfcReinforcingMesh`, `IfcReinforcingMeshType`, `IfcRelAggregates`, `IfcRelAssigns`, `IfcRelAssignsTasks`, `IfcRelAssignsToActor`, `IfcRelAssignsToControl`, `IfcRelAssignsToGroup`, `IfcRelAssignsToGroupByFactor`, `IfcRelAssignsToProcess`, `IfcRelAssignsToProduct`, `IfcRelAssignsToProjectOrder`, `IfcRelAssignsToResource`, `IfcRelAssociates`, `IfcRelAssociatesAppliedValue`, `IfcRelAssociatesApproval`, `IfcRelAssociatesClassification`, `IfcRelAssociatesConstraint`, `IfcRelAssociatesDocument`, `IfcRelAssociatesLibrary`, `IfcRelAssociatesMaterial`, `IfcRelAssociatesProfileProperties`, `IfcRelationship`, `IfcRelaxation`, `IfcRelConnects`, `IfcRelConnectsElements`, `IfcRelConnectsPathElements`, `IfcRelConnectsPorts`, `IfcRelConnectsPortToElement`, `IfcRelConnectsStructuralActivity`, `IfcRelConnectsStructuralElement`, `IfcRelConnectsStructuralMember`, `IfcRelConnectsWithEccentricity`, `IfcRelConnectsWithRealizingElements`, `IfcRelContainedInSpatialStructure`, `IfcRelCoversBldgElements`, `IfcRelCoversSpaces`, `IfcRelDeclares`, `IfcRelDecomposes`, `IfcRelDefines`, `IfcRelDefinesByObject`, `IfcRelDefinesByProperties`, `IfcRelDefinesByTemplate`, `IfcRelDefinesByType`, `IfcRelFillsElement`, `IfcRelFlowControlElements`, `IfcRelInteractionRequirements`, `IfcRelInterferesElements`, `IfcRelNests`, `IfcRelOccupiesSpaces`, `IfcRelOverridesProperties`, `IfcRelProjectsElement`, `IfcRelReferencedInSpatialStructure`, `IfcRelSchedulesCostItems`, `IfcRelSequence`, `IfcRelServicesBuildings`, `IfcRelSpaceBoundary`, `IfcRelSpaceBoundary1stLevel`, `IfcRelSpaceBoundary2ndLevel`, `IfcRelVoidsElement`, `IfcReparametrisedCompositeCurveSegment`, `IfcRepresentation`, `IfcRepresentationContext`, `IfcRepresentationItem`, `IfcRepresentationMap`, `IfcResource`, `IfcResourceApprovalRelationship`, `IfcResourceConstraintRelationship`, `IfcResourceLevelRelationship`, `IfcResourceTime`, `IfcRevolvedAreaSolid`, `IfcRevolvedAreaSolidTapered`, `IfcRibPlateProfileProperties`, `IfcRightCircularCone`, `IfcRightCircularCylinder`, `IfcRoof`, `IfcRoofType`, `IfcRoot`, `IfcRoundedEdgeFeature`, `IfcRoundedRectangleProfileDef`, `IfcSanitaryTerminal`, `IfcSanitaryTerminalType`, `IfcScheduleTimeControl`, `IfcSchedulingTime`, `IfcSeamCurve`, `IfcSectionedSolid`, `IfcSectionedSolidHorizontal`, `IfcSectionedSpine`, `IfcSectionProperties`, `IfcSectionReinforcementProperties`, `IfcSensor`, `IfcSensorType`, `IfcServiceLife`, `IfcServiceLifeFactor`, `IfcShadingDevice`, `IfcShadingDeviceType`, `IfcShapeAspect`, `IfcShapeModel`, `IfcShapeRepresentation`, `IfcShellBasedSurfaceModel`, `IfcSimpleProperty`, `IfcSimplePropertyTemplate`, `IfcSite`, `IfcSIUnit`, `IfcSlab`, `IfcSlabElementedCase`, `IfcSlabStandardCase`, `IfcSlabType`, `IfcSlippageConnectionCondition`, `IfcSolarDevice`, `IfcSolarDeviceType`, `IfcSolidModel`, `IfcSoundProperties`, `IfcSoundValue`, `IfcSpace`, `IfcSpaceHeater`, `IfcSpaceHeaterType`, `IfcSpaceProgram`, `IfcSpaceThermalLoadProperties`, `IfcSpaceType`, `IfcSpatialElement`, `IfcSpatialElementType`, `IfcSpatialStructureElement`, `IfcSpatialStructureElementType`, `IfcSpatialZone`, `IfcSpatialZoneType`, `IfcSphere`, `IfcSphericalSurface`, `IfcStackTerminal`, `IfcStackTerminalType`, `IfcStair`, `IfcStairFlight`, `IfcStairFlightType`, `IfcStairType`, `IfcStructuralAction`, `IfcStructuralActivity`, `IfcStructuralAnalysisModel`, `IfcStructuralConnection`, `IfcStructuralConnectionCondition`, `IfcStructuralCurveAction`, `IfcStructuralCurveConnection`, `IfcStructuralCurveMember`, `IfcStructuralCurveMemberVarying`, `IfcStructuralCurveReaction`, `IfcStructuralItem`, `IfcStructuralLinearAction`, `IfcStructuralLinearActionVarying`, `IfcStructuralLoad`, `IfcStructuralLoadCase`, `IfcStructuralLoadConfiguration`, `IfcStructuralLoadGroup`, `IfcStructuralLoadLinearForce`, `IfcStructuralLoadOrResult`, `IfcStructuralLoadPlanarForce`, `IfcStructuralLoadSingleDisplacement`, `IfcStructuralLoadSingleDisplacementDistortion`, `IfcStructuralLoadSingleForce`, `IfcStructuralLoadSingleForceWarping`, `IfcStructuralLoadStatic`, `IfcStructuralLoadTemperature`, `IfcStructuralMember`, `IfcStructuralPlanarAction`, `IfcStructuralPlanarActionVarying`, `IfcStructuralPointAction`, `IfcStructuralPointConnection`, `IfcStructuralPointReaction`, `IfcStructuralProfileProperties`, `IfcStructuralReaction`, `IfcStructuralResultGroup`, `IfcStructuralSteelProfileProperties`, `IfcStructuralSurfaceAction`, `IfcStructuralSurfaceConnection`, `IfcStructuralSurfaceMember`, `IfcStructuralSurfaceMemberVarying`, `IfcStructuralSurfaceReaction`, `IfcStructuredDimensionCallout`, `IfcStyledItem`, `IfcStyledRepresentation`, `IfcStyleModel`, `IfcSubContractResource`, `IfcSubContractResourceType`, `IfcSubedge`, `IfcSurface`, `IfcSurfaceCurve`, `IfcSurfaceCurveSweptAreaSolid`, `IfcSurfaceFeature`, `IfcSurfaceOfLinearExtrusion`, `IfcSurfaceOfRevolution`, `IfcSurfaceReinforcementArea`, `IfcSurfaceStyle`, `IfcSurfaceStyleLighting`, `IfcSurfaceStyleRefraction`, `IfcSurfaceStyleRendering`, `IfcSurfaceStyleShading`, `IfcSurfaceStyleWithTextures`, `IfcSurfaceTexture`, `IfcSweptAreaSolid`, `IfcSweptDiskSolid`, `IfcSweptDiskSolidPolygonal`, `IfcSweptSurface`, `IfcSwitchingDevice`, `IfcSwitchingDeviceType`, `IfcSymbolStyle`, `IfcSystem`, `IfcSystemFurnitureElement`, `IfcSystemFurnitureElementType`, `IfcTable`, `IfcTableColumn`, `IfcTableRow`, `IfcTank`, `IfcTankType`, `IfcTask`, `IfcTaskTime`, `IfcTaskTimeRecurring`, `IfcTaskType`, `IfcTelecomAddress`, `IfcTendon`, `IfcTendonAnchor`, `IfcTendonAnchorType`, `IfcTendonType`, `IfcTerminatorSymbol`, `IfcTessellatedFaceSet`, `IfcTessellatedItem`, `IfcTextLiteral`, `IfcTextLiteralWithExtent`, `IfcTextStyle`, `IfcTextStyleFontModel`, `IfcTextStyleForDefinedFont`, `IfcTextStyleTextModel`, `IfcTextStyleWithBoxCharacteristics`, `IfcTextureCoordinate`, `IfcTextureCoordinateGenerator`, `IfcTextureMap`, `IfcTextureVertex`, `IfcTextureVertexList`, `IfcThermalMaterialProperties`, `IfcTimePeriod`, `IfcTimeSeries`, `IfcTimeSeriesReferenceRelationship`, `IfcTimeSeriesSchedule`, `IfcTimeSeriesValue`, `IfcTopologicalRepresentationItem`, `IfcTopologyRepresentation`, `IfcToroidalSurface`, `IfcTransformer`, `IfcTransformerType`, `IfcTransitionCurveSegment2D`, `IfcTransportElement`, `IfcTransportElementType`, `IfcTrapeziumProfileDef`, `IfcTriangulatedFaceSet`, `IfcTriangulatedIrregularNetwork`, `IfcTrimmedCurve`, `IfcTShapeProfileDef`, `IfcTubeBundle`, `IfcTubeBundleType`, `IfcTwoDirectionRepeatFactor`, `IfcTypeObject`, `IfcTypeProcess`, `IfcTypeProduct`, `IfcTypeResource`, `IfcUnitaryControlElement`, `IfcUnitaryControlElementType`, `IfcUnitaryEquipment`, `IfcUnitaryEquipmentType`, `IfcUnitAssignment`, `IfcUShapeProfileDef`, `IfcValve`, `IfcValveType`, `IfcVector`, `IfcVertex`, `IfcVertexBasedTextureMap`, `IfcVertexLoop`, `IfcVertexPoint`, `IfcVibrationIsolator`, `IfcVibrationIsolatorType`, `IfcVirtualElement`, `IfcVirtualGridIntersection`, `IfcVoidingFeature`, `IfcWall`, `IfcWallElementedCase`, `IfcWallStandardCase`, `IfcWallType`, `IfcWasteTerminal`, `IfcWasteTerminalType`, `IfcWaterProperties`, `IfcWindow`, `IfcWindowLiningProperties`, `IfcWindowPanelProperties`, `IfcWindowStandardCase`, `IfcWindowStyle`, `IfcWindowType`, `IfcWorkCalendar`, `IfcWorkControl`, `IfcWorkPlan`, `IfcWorkSchedule`, `IfcWorkTime`, `IfcZone`, `IfcZShapeProfileDef`
- `Bricscad.Ifc.IfcEnumValue` — class；构造器：2；属性：`Value{get/set}`；字段：`eA_QUALITYOFCOMPONENTS`, `eABSORBEDDOSEUNIT`, `eACCELERATIONUNIT`, `eACCESS`, `eACCESSORY_ASSEMBLY`, `eACTIVE`, `eACTOR`, `eACTUAL`, `eACTUALSERVICELIFE`, `eADD`, `eADDED`, `eADIABATICAIRWASHER`, `eADIABATICATOMIZING`, `eADIABATICCOMPRESSEDAIRNOZZLE`, `eADIABATICPAN`, `eADIABATICRIGIDMEDIA`, `eADIABATICULTRASONIC`, `eADIABATICWETTEDELEMENT`, `eADMINISTRATION`, `eADVICE_CAUTION`, `eADVICE_NOTE`, `eADVICE_WARNING`, `eADVISORY`, `eAED`, `eAES`, `eAGGREGATES`, `eAHEAD`, `eAIRCONDITIONING`, `eAIRCONDITIONINGUNIT`, `eAIRCOOLED`, `eAIREXCHANGERATE`, `eAIRHANDLER`, `eAIRPARTICLEFILTER`, `eAIRRELEASE`, `eAIRSTATION`, `eALARMPANEL`, `eALTERNATING`, `eALUMINIUM`, `eALUMINIUM_PLASTIC`, `eALUMINIUM_WOOD`, `eAMMETER`, `eAMOUNTOFSUBSTANCEUNIT`, `eAMPERE`, `eAMPLIFIER`, `eANCHORBOLT`, `eANCHORING`, `eANCHORPLATE`, `eANGULARVELOCITYUNIT`, `eANNUAL`, `eANTENNA`, `eANTIVACUUM`, `eARCH`, `eARCHITECT`, `eAREA`, `eAREADENSITYUNIT`, `eAREAUNIT`, `eASBUILT`, `eASSEMBLY`, `eASSETINVENTORY`, `eASSIGNEE`, `eASSIGNOR`, `eASSISTEDBUTANE`, `eASSISTEDELECTRIC`, `eASSISTEDNATURALGAS`, `eASSISTEDPROPANE`, `eASSISTEDSTEAM`, `eATEND`, `eATPATH`, `eATS`, `eATSTART`, `eATTENDANCE`, `eATTO`, `eAUD`, `eAUDIOVISUAL`, `eAUDIOVISUALOUTLET`, `eAUXILIARY`, `eAWNING`, `eAXIS1`, `eAXIS2`, `eAXIS3`, `eB_DESIGNLEVEL`, `eBACKDRAFTDAMPER`, `eBALANCINGDAMPER`, `eBALUSTRADE`, `eBAR`, `eBARREL_ROOF`, `eBASEBOARDHEATER`, `eBASELINE`, `eBASESLAB`, `eBASIN`, `eBATH`, `eBATTERY`, `eBBD`, `eBEAM`, `eBEAM_GRID`, `eBECQUEREL`, `eBED`, `eBEG`, `eBEHIND`, `eBELL`, `eBELTDRIVE`, `eBEND`, `eBENDING_ELEMENT`, `eBGL`, `eBHD`, `eBIDET`, `eBILINEAR`, `eBIQUADRATICPARABOLA`, `eBIRDCAGE`, `eBLASTDAMPER`, `eBLINN`, `eBLOSSCURVE`, `eBMD`, `eBND`, `eBOLT`, `eBOOSTER`, `eBORED`, `eBOTH`, `eBOTTOM`, `eBOTTOMHUNG`, `eBRACE`, `eBRACED_FRAME`, `eBRACKET`, `eBRAKES`, `eBREAKGLASSBUTTON`, `eBREAKPRESSURE`, `eBREECHINGINLET`, `eBRL`, `eBSD`, `eBUDGET`, `eBUILDING`, `eBUILDINGOPERATOR`, `eBUILDINGOWNER`, `eBUMP`, `eBUOYANCY`, `eBUSBARSEGMENT`, `eBUTTERFLY_ROOF`, `eBWP`, `eBY_DAY_COUNT`, `eBY_WEEKDAY_COUNT`, `eBZD`, `eC_WORKEXECUTIONLEVEL`, `eCABLE`, `eCABLECARRIER`, `eCABLELADDERSEGMENT`, `eCABLESEGMENT`, `eCABLETRAYSEGMENT`, `eCABLETRUNKINGSEGMENT`, `eCAD`, `eCAISSON_FOUNDATION`, `eCALIBRATION`, `eCAMERA`, `eCANDELA`, `eCAPACITORBANK`, `eCARPENTRY`, `eCARTESIAN`, `eCAST_IN_PLACE`, `eCBD`, `eCEILING`, `eCENTI`, `eCENTRIFUGALAIRFOIL`, `eCENTRIFUGALBACKWARDINCLINEDCURVED`, `eCENTRIFUGALFORWARDCURVED`, `eCENTRIFUGALRADIAL`, `eCHAIR`, `eCHAMFER`, `eCHANGE`, `eCHANGEORDER`, `eCHANGEOVER`, `eCHECK`, `eCHEMICAL`, `eCHF`, `eCHILLEDWATER`, `eCHORD`, `eCHP`, `eCIRCUITBREAKER`, `eCIRCULAR_ARC`, `eCIRCULATOR`, `eCISTERN`, `eCIVILENGINEER`, `eCLADDING`, `eCLEANING`, `eCLIENT`, `eCLOTHOIDCURVE`, `eCLP`, `eCNY`, `eCO2SENSOR`, `eCOATED`, `eCODECOMPLIANCE`, `eCODEWAIVER`, `eCOHESION`, `eCOLLAR`, `eCOLUMN`, `eCOMBINEDVALUE`, `eCOMISSIONINGENGINEER`, `eCOMMISSIONING`, `eCOMMISSIONINGENGINEER`, `eCOMMUNICATION`, `eCOMMUNICATIONSOUTLET`, `eCOMPACTFLUORESCENT`, `eCOMPLETION_G1`, `eCOMPLEX`, `eCOMPOSITE`, `eCOMPOUNDPLANEANGLEUNIT`, `eCOMPRESSEDAIR`, `eCOMPRESSEDAIRFILTER`, `eCOMPRESSION`, `eCOMPRESSION_MEMBER`, `eCOMPUTER`, `eCONCRETE`, `eCONDENSERWATER`, `eCONDUCTANCESENSOR`, `eCONDUCTORSEGMENT`, `eCONDUITSEGMENT`, `eCONFIDENTIAL`, `eCONICAL_SURF`, `eCONNECTOR`, `eCONST`, `eCONSTANTFLOW`, `eCONSTRUCTION`, `eCONSTRUCTIONMANAGER`, `eCONSULTANT`, `eCONSUMED`, `eCONSUMERUNIT`, `eCONTACTOR`, `eCONTACTSENSOR`, `eCONTINUOUS`, `eCONTRACTOR`, `eCONTROL`, `eCONTROLDAMPER`, `eCONTROLPANEL`, `eCONTSAMEGRADIENT`, `eCONTSAMEGRADIENTSAMECURVATURE`, `eCONVECTOR`, `eCONVEYING`, `eCORESEGMENT`, `eCOSENSOR`, `eCOSINECURVE`, `eCOSTENGINEER`, `eCOSTPLAN`, `eCOULOMB`, `eCOUPLER`, `eCOUPLING`, `eCOWL`, `eCRANEWAY`, `eCREEP`, `eCROSS`, `eCUBIC_METRE`, `eCUBICPARABOLA`, `eCULVERT`, `eCURRENT`, `eCURTAIN_PANEL`, `eCURVATUREUNIT`, `eCURVE`, `eCURVE3D`, `eCURVED`, `eCURVED_RUN_STAIR`, `eCUTOUT`, `eCYCLONIC`, `eCYLINDRICAL_SURF`, `eCYS`, `eCZK`, `eD_INDOORENVIRONMENT`, `eDAILY`, `eDATA`, `eDATAOUTLET`, `eDBA`, `eDBB`, `eDBC`, `eDC`, `eDDP`, `eDEAD_LOAD_G`, `eDECA`, `eDECI`, `eDEGREE_CELSIUS`, `eDEHUMIDIFIER`, `eDELETED`, `eDEM`, `eDEMOLISHING`, `eDEMOLITION`, `eDESIGN`, `eDESIGNINTENT`, `eDESIGNMAXIMUM`, `eDESIGNMINIMUM`, `eDESK`, `eDIAGNOSTIC`, `eDIFFERENCE`, `eDIFFUSER`, `eDIMMERSWITCH`, `eDIRECT`, `eDIRECTDRIVE`, `eDIRECTEVAPORATIVEAIRWASHER`, `eDIRECTEVAPORATIVEPACKAGEDROTARYAIRCOOLER`, `eDIRECTEVAPORATIVERANDOMMEDIAAIRCOOLER`, `eDIRECTEVAPORATIVERIGIDMEDIAAIRCOOLER`, `eDIRECTEVAPORATIVESLINGERSPACKAGEDAIRCOOLER`, `eDIRECTEXPANSION`, `eDIRECTEXPANSIONBRAZEDPLATE`, `eDIRECTEXPANSIONSHELLANDTUBE`, `eDIRECTEXPANSIONTUBEINTUBE`, `eDIRECTION_X`, `eDIRECTION_Y`, `eDIRECTIONSOURCE`, `eDIRECTWATERHEATER`, `eDISCONTINUOUS`, `eDISCRETE`, `eDISCRETEBINARY`, `eDISHWASHER`, `eDISMANTLE`, `eDISPLAY`, `eDISPOSAL`, `eDISTRIBUTIONBOARD`, `eDISTRIBUTIONPOINT`, `eDIVERTING`, `eDIVIDE`, `eDKK`, `eDOME_ROOF`, `eDOMESTICCOLDWATER`, `eDOMESTICHOTWATER`, `eDOOR`, `eDOSEEQUIVALENTUNIT`, `eDOUBLE_ACTING`, `eDOUBLE_DOOR_DOUBLE_SWING`, `eDOUBLE_DOOR_FOLDING`, `eDOUBLE_DOOR_SINGLE_SWING`, `eDOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT`, `eDOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT`, `eDOUBLE_DOOR_SLIDING`, `eDOUBLE_PANEL_HORIZONTAL`, `eDOUBLE_PANEL_VERTICAL`, `eDOUBLE_RETURN_STAIR`, `eDOUBLE_SWING_LEFT`, `eDOUBLE_SWING_RIGHT`, `eDOUBLECHECK`, `eDOUBLEREGULATING`, `eDOWEL`, `eDOWN`, `eDRAFT`, `eDRAINAGE`, `eDRAWOFFCOCK`, `eDRIVEN`, `eDRYBULBTEMPERATURE`, `eDRYWALL`, `eDUCT`, `eDXCOOLINGCOIL`, `eDYNAMIC`, `eDYNAMICVISCOSITYUNIT`, `eE_OUTDOORENVIRONMENT`, `eEARTHFAILUREDEVICE`, `eEARTHING`, `eEARTHINGSWITCH`, `eEARTHLEAKAGECIRCUITBREAKER`, `eEARTHMOVING`, `eEARTHQUAKE_E`, `eEDGE`, `eEGL`, `eELAPSEDTIME`, `eELECTRIC`, `eELECTRICACTUATOR`, `eELECTRICAL`, `eELECTRICALENGINEER`, `eELECTRICCABLEHEATER`, `eELECTRICCAPACITANCEUNIT`, `eELECTRICCHARGEUNIT`, `eELECTRICCONDUCTANCEUNIT`, `eELECTRICCOOKER`, `eELECTRICCURRENTUNIT`, `eELECTRICHEATER`, `eELECTRICHEATINGCOIL`, `eELECTRICMATHEATER`, `eELECTRICMETER`, `eELECTRICPOINTHEATER`, `eELECTRICRESISTANCEUNIT`, `eELECTRICVOLTAGEUNIT`, `eELECTROACOUSTIC`, `eELECTROMAGNETIC`, `eELECTRONIC`, `eELEMENT`, `eELEMENTEDWALL`, `eELEVATION_VIEW`, `eELEVATOR`, `eELLIPTIC_ARC`, `eEMAIL`, `eEMERGENCYSTOP`, `eENDEVENT`, `eENDSUCTION`, `eENERGYMETER`, `eENERGYUNIT`, `eENGINEER`, `eENGINEGENERATOR`, `eENTRY`, `eEQUALTO`, `eEQUIDISTANT`, `eEQUIPMENT`, `eERECTING`, `eERECTION`, `eESCALATOR`, `eEST`, `eESTIMATE`, `eEUR`, `eEVAPORATIVECOOLED`, `eEVENTCOMPLEX`, `eEVENTMESSAGE`, `eEVENTRULE`, `eEVENTTIME`, `eEXA`, `eEXHAUST`, `eEXHAUSTAIR`, `eEXIT`, `eEXPANSION`, `eEXPECTEDSERVICELIFE`, `eEXTERNAL`, `eEXTERNAL_EARTH`, `eEXTERNAL_FIRE`, `eEXTERNAL_WATER`, `eEXTERNALCOMBUSTION`, `eEXTRACTION`, `eEXTRAORDINARY_A`, `eEYEBALL`, `eF_INUSECONDITIONS`, `eFACILITIESMANAGER`, `eFACSIMILE`, `eFACTORY`, `eFAK`, `eFARAD`, `eFAUCET`, `eFAX`, `eFEEDAIRUNIT`, `eFEEDANDEXPANSION`, `eFEMTO`, `eFENESTRATION`, `eFIELDCONSTRUCTIONMANAGER`, `eFILECABINET`, `eFIM`, `eFINAL`, `eFINALDRAFT`, `eFINISH_FINISH`, `eFINISH_START`, `eFINISHING`, `eFINNED`, `eFINNEDTUBEUNIT`, `eFIRE`, `eFIREDAMPER`, `eFIREHYDRANT`, `eFIREPROTECTION`, `eFIRESAFETY`, `eFIRESENSOR`, `eFIRESMOKEDAMPER`, `eFIRST_ORDER_THEORY`, `eFIRSTSHIFT`, `eFIXED_END`, `eFIXEDCASEMENT`, `eFIXEDPANEL`, `eFIXEDPLATECOUNTERFLOWEXCHANGER`, `eFIXEDPLATECROSSFLOWEXCHANGER`, `eFIXEDPLATEPARALLELFLOWEXCHANGER`, `eFJD`, `eFKP`, `eFLAT`, `eFLAT_ROOF`, `eFLATOVAL`, `eFLEXIBLESEGMENT`, `eFLOATING`, `eFLOODEDSHELLANDTUBE`, `eFLOOR`, `eFLOORING`, `eFLOORTRAP`, `eFLOORWASTE`, `eFLOWMETER`, `eFLOWSENSOR`, `eFLUORESCENT`, `eFLUSHING`, `eFOLDING`, `eFOLDING_TO_LEFT`, `eFOLDING_TO_RIGHT`, `eFOOTING_BEAM`, `eFORCEUNIT`, `eFORMEDDUCT`, `eFORMWORK`, `eFOUNDATION`, `eFREEFORM`, `eFREESTANDINGELECTRICHEATER`, `eFREESTANDINGFAN`, `eFREESTANDINGWATERCOOLER`, `eFREESTANDINGWATERHEATER`, `eFREEZER`, `eFREQUENCY`, `eFREQUENCYMETER`, `eFREQUENCYUNIT`, `eFRF`, `eFRICTION`, `eFRIDGE_FREEZER`, `eFROSTSENSOR`, `eFUEL`, `eFULL_NONLINEAR_THEORY`, `eFUMEHOODEXHAUST`, `eFURNITUREINVENTORY`, `eFUSEDISCONNECTOR`, `eG_MAINTENANCELEVEL`, `eGABLE_ROOF`, `eGAMBREL_ROOF`, `eGAS`, `eGASAPPLIANCE`, `eGASBOOSTER`, `eGASBURNER`, `eGASCOCK`, `eGASDETECTIONPANEL`, `eGASDETECTORPANEL`, `eGASHEATINGCOIL`, `eGASMETER`, `eGASSENSOR`, `eGASTAP`, `eGATE`, `eGATEWAY`, `eGBP`, `eGENERAL`, `eGENERALISED_CONE`, `eGFA`, `eGIGA`, `eGIP`, `eGIRDER`, `eGLASS`, `eGLOBAL_COORDS`, `eGLUE`, `eGMD`, `eGRAM`, `eGRAPH_VIEW`, `eGRAVITYDAMPER`, `eGRAVITYRELIEFDAMPER`, `eGRAY`, `eGREASE`, `eGREASEINTERCEPTOR`, `eGREATERTHAN`, `eGREATERTHANOREQUALTO`, `eGRILL`, `eGRILLE`, `eGROUP`, `eGRX`, `eGUARDRAIL`, `eGULLYSUMP`, `eGULLYTRAP`, `eGUTTER`, `eGYPSUM`, `eHALF_TURN_RAMP`, `eHALF_TURN_STAIR`, `eHALF_WINDING_STAIR`, `eHALOGEN`, `eHANDDRYER`, `eHANDOPERATEDACTUATOR`, `eHANDRAIL`, `eHARD`, `eHARMONICFILTER`, `eHAZARDOUS`, `eHEALTHANDSAFETY`, `eHEATFLUXDENSITYUNIT`, `eHEATING`, `eHEATINGVALUEUNIT`, `eHEATPIPE`, `eHEATRECOVERY`, `eHEATSENSOR`, `eHECTO`, `eHENRY`, `eHERMETIC`, `eHERTZ`, `eHIGH_GRADE_STEEL`, `eHIGHPRESSUREMERCURY`, `eHIGHPRESSURESODIUM`, `eHIP_ROOF`, `eHIPPED_GABLE_ROOF`, `eHKD`, `eHOLE`, `eHOLLOWCORE`, `eHOME`, `eHOSEREEL`, `eHUF`, `eHUMIDISTAT`, `eHUMIDITYSENSOR`, `eHVAC`, `eHYDRAULICACTUATOR`, `eHYDRONICCOIL`, `eHYPERBOLIC_ARC`, `eICE`, `eICK`, `eIDENTIFIERSENSOR`, `eIDR`, `eILLUMINANCEUNIT`, `eILS`, `eIMPACT`, `eIMPULSE`, `eIN_PLANE_LOADING_2D`, `eINCLUDEDIN`, `eINCLUDES`, `eINDICATORPANEL`, `eINDIRECTDIRECTCOMBINATION`, `eINDIRECTEVAPORATIVECOOLINGTOWERORCOILCOOLER`, `eINDIRECTEVAPORATIVEPACKAGEAIRCOOLER`, `eINDIRECTEVAPORATIVEWETCOIL`, `eINDIRECTWATERHEATER`, `eINDUCTANCEUNIT`, `eINDUCTION`, `eINDUCTORBANK`, `eINFILTRATION`, `eINR`, `eINSPECTIONCHAMBER`, `eINSPECTIONPIT`, `eINSTALLATION`, `eINSULATION`, `eINTEGERCOUNTRATEUNIT`, `eINTERMEDIATEEVENT`, `eINTERNAL`, `eINTERNALCOMBUSTION`, `eINTERSECTION`, `eINVERTER`, `eIONCONCENTRATIONSENSOR`, `eIONCONCENTRATIONUNIT`, `eIRIS`, `eIRP`, `eIRREGULAR`, `eISOCONTOUR`, `eISOLATING`, `eISOTHERMALMOISTURECAPACITYUNIT`, `eITL`, `eJALOUSIE`, `eJETGROUTING`, `eJMD`, `eJOD`, `eJOIST`, `eJOULE`, `eJPY`, `eJUNCTION`, `eKELVIN`, `eKES`, `eKEYPAD`, `eKILO`, `eKILOPOINT`, `eKINEMATICVISCOSITYUNIT`, `eKITCHENMACHINE`, `eKRW`, `eKWD`, `eKYD`, `eLACK_OF_FIT`, `eLANDING`, `eLANDSCAPING`, `eLATENT`, `eLED`, `eLEFT`, `eLENGTHUNIT`, `eLESSEE`, `eLESSOR`, `eLESSTHAN`, `eLESSTHANOREQUALTO`, `eLETTINGAGENT`, `eLEVELSENSOR`, `eLIFTINGGEAR`, `eLIGATURE`, `eLIGHT`, `eLIGHTDOME`, `eLIGHTEMITTINGDIODE`, `eLIGHTING`, `eLIGHTNINGPROTECTION`, `eLIGHTSENSOR`, `eLINEAR`, `eLINEARDIFFUSER`, `eLINEARFORCEUNIT`, `eLINEARGRILLE`, `eLINEARMOMENTUNIT`, `eLINEARSTIFFNESSUNIT`, `eLINEARVELOCITYUNIT`, `eLINTEL`, `eLIVE_LOAD_Q`, `eLKR`, `eLOAD_CASE`, `eLOAD_COMBINATION`, `eLOAD_COMBINATION_GROUP`, `eLOAD_GROUP`, `eLOADBEARING`, `eLOADING_3D`, `eLOCAL_COORDS`, `eLOCKED`, `eLOG_LINEAR`, `eLOG_LOG`, `eLOGICALAND`, `eLOGICALNOTAND`, `eLOGICALNOTOR`, `eLOGICALOR`, `eLOGICALXOR`, `eLOGISTIC`, `eLOUVER`, `eLOUVRE`, `eLOWPRESSURESODIUM`, `eLOWVOLTAGEHALOGEN`, `eLUF`, `eLUMEN`, `eLUMINOUSFLUXUNIT`, `eLUMINOUSINTENSITYDISTRIBUTIONUNIT`, `eLUMINOUSINTENSITYUNIT`, `eLUX`, `eMAGNETICFLUXDENSITYUNIT`, `eMAGNETICFLUXUNIT`, `eMAIN`, `eMAINTENANCE`, `eMAINTENANCEWORKORDER`, `eMAINVOLTAGEHALOGEN`, `eMANHOLE`, `eMANSARD_ROOF`, `eMANUALPULLBOX`, `eMANUFACTURE`, `eMANUFACTURER`, `eMARK`, `eMASONRY`, `eMASSDENSITYUNIT`, `eMASSFLOWRATEUNIT`, `eMASSPERLENGTHUNIT`, `eMASSUNIT`, `eMATT`, `eMEASURED`, `eMECHANICALENGINEER`, `eMECHANICALFORCEDDRAFT`, `eMECHANICALINDUCEDDRAFT`, `eMEGA`, `eMEMBER`, `eMEMBRANE`, `eMEMBRANE_ELEMENT`, `eMERGECONFLICT`, `eMETAL`, `eMETALHALIDE`, `eMETERCHAMBER`, `eMETRE`, `eMICRO`, `eMICROPHONE`, `eMICROWAVE`, `eMIDDLE`, `eMILEPOINT`, `eMILLI`, `eMIMICPANEL`, `eMIRROR`, `eMITER`, `eMIXING`, `eMODEL_VIEW`, `eMODELVIEW`, `eMODEM`, `eMODIFIED`, `eMODIFIEDADDED`, `eMODIFIEDDELETED`, `eMODULUSOFELASTICITYUNIT`, `eMODULUSOFLINEARSUBGRADEREACTIONUNIT`, `eMODULUSOFROTATIONALSUBGRADEREACTIONUNIT`, `eMODULUSOFSUBGRADEREACTIONUNIT`, `eMOISTUREDIFFUSIVITYUNIT`, `eMOISTURESENSOR`, `eMOLDING`, `eMOLE`, `eMOLECULARWEIGHTUNIT`, `eMOMENTARYSWITCH`, `eMOMENTOFINERTIAUNIT`, `eMONTHLY`, `eMONTHLY_BY_DAY_OF_MONTH`, `eMONTHLY_BY_POSITION`, `eMORTAR`, `eMOTORCONTROLCENTRE`, `eMOVABLE`, `eMOVE`, `eMOVEMENTSENSOR`, `eMOVEORDER`, `eMOVINGWALKWAY`, `eMTL`, `eMULLION`, `eMULTIPLY`, `eMULTIPOSITION`, `eMUNICIPALSOLIDWASTE`, `eMUR`, `eMXN`, `eMYR`, `eNAIL`, `eNAILPLATE`, `eNANO`, `eNATURALDRAFT`, `eNC`, `eNEGATIVE`, `eNETWORKAPPLIANCE`, `eNETWORKBRIDGE`, `eNETWORKHUB`, `eNEWTON`, `eNLG`, `eNOCHANGE`, `eNOK`, `eNOTCH`, `eNOTCONSUMED`, `eNOTDEFINED`, `eNOTEQUALTO`, `eNOTINCLUDEDIN`, `eNOTINCLUDES`, `eNOTKNOWN`, `eNOTOCCUPIED`, `eNR`, `eNULL`, `eNZD`, `eOBSTRUCTION`, `eOCCUPANCY`, `eOCCUPIED`, `eODORFILTER`, `eOFFICE`, `eOHM`, `eOIL`, `eOILFILTER`, `eOILINTERCEPTOR`, `eOILMETER`, `eOLED`, `eOMR`, `eOPACITY`, `eOPENING`, `eOPENTYPE`, `eOPERATION`, `eOPERATIONAL`, `eOPTIMISTICREFERENCESERVICELIFE`, `eORIGIN`, `eOTHER_CONSTRUCTION`, `eOTHEROPERATION`, `eOUT_PLANE_LOADING_2D`, `eOUTERSHELL`, `eOWNER`, `eOXYGENGENERATOR`, `eOXYGENPLANT`, `eP_BOUNDEDVALUE`, `eP_COMPLEX`, `eP_ENUMERATEDVALUE`, `eP_LISTVALUE`, `eP_REFERENCEVALUE`, `eP_SINGLEVALUE`, `eP_TABLEVALUE`, `ePAD_FOOTING`, `ePAINTING`, `ePANEL`, `ePANELRADIATOR`, `ePARABOLA`, `ePARABOLIC_ARC`, `ePARAMETER`, `ePARAPET`, `ePARKING`, `ePARTIAL`, `ePARTIALLYCONSUMED`, `ePARTIALLYOCCUPIED`, `ePARTITIONING`, `ePASCAL`, `ePASSIVE`, `ePAVILION_ROOF`, `ePAVING`, `ePCURVE_S1`, `ePCURVE_S2`, `ePEOPLE`, `ePERMANENT_G`, `ePERSONAL`, `ePESSIMISTICREFERENCESERVICELIFE`, `ePETA`, `ePETROL`, `ePETROLINTERCEPTOR`, `ePGK`, `ePHASEANGLEMETER`, `ePHONE`, `ePHONG`, `ePHOTOCOPIER`, `ePHP`, `ePHSENSOR`, `ePHUNIT`, `ePHYSICAL`, `ePICO`, `ePIECEWISE_BEZIER_KNOTS`, `ePIECEWISEBINARY`, `ePIECEWISECONSTANT`, `ePIECEWISECONTINUOUS`, `ePILASTER`, `ePILE_CAP`, `ePIN_JOINED_MEMBER`, `ePIPE`, `ePIVOTHORIZONTAL`, `ePIVOTVERTICAL`, `ePKR`, `ePLAIN`, `ePLAN_VIEW`, `ePLANARFORCEUNIT`, `ePLANE_SURF`, `ePLANEANGLEUNIT`, `ePLANNED`, `ePLASTIC`, `ePLATE`, `ePLAYER`, `ePLN`, `ePLUMBING`, `ePLUMBINGWALL`, `ePNEUMATICACTUATOR`, `ePOINTSOURCE`, `ePOLYGONAL`, `ePOLYLINE_FORM`, `ePOLYPHASE`, `ePOSITIVE`, `ePOST`, `ePOWER`, `ePOWERFACTORMETER`, `ePOWERGENERATION`, `ePOWEROUTLET`, `ePOWERUNIT`, `ePRECAST_CONCRETE`, `ePRECASTPANEL`, `ePREDICTED`, `ePREFAB_STEEL`, `ePREFORMED`, `ePRESSUREGAUGE`, `ePRESSUREREDUCING`, `ePRESSURERELIEF`, `ePRESSURESENSOR`, `ePRESSUREUNIT`, `ePRESSUREVESSEL`, `ePRESTRESSING_P`, `ePRICEDBILLOFQUANTITIES`, `ePRIMARY`, `ePRINTER`, `ePROCESS`, `ePRODUCT`, `ePROGRAMMABLE`, `ePROJECT`, `ePROJECTED_LENGTH`, `ePROJECTMANAGER`, `ePROJECTOR`, `ePROPELLORAXIAL`, `ePROPORTIONAL`, `ePROPORTIONALINTEGRAL`, `ePROPORTIONALINTEGRALDERIVATIVE`, `ePROPPING`, `ePROVISIONFORSPACE`, `ePROVISIONFORVOID`, `ePSET_OCCURRENCEDRIVEN`, `ePSET_PERFORMANCEDRIVEN`, `ePSET_TYPEDRIVENONLY`, `ePSET_TYPEDRIVENOVERRIDE`, `ePTN`, `ePUBLIC`, `ePUMPING`, `ePUNCHING`, `ePURCHASE`, `ePURCHASEORDER`, `ePURLIN`, `eQ_AREA`, `eQ_COMPLEX`, `eQ_COUNT`, `eQ_LENGTH`, `eQ_TIME`, `eQ_VOLUME`, `eQ_WEIGHT`, `eQAR`, `eQTO_OCCURRENCEDRIVEN`, `eQTO_TYPEDRIVENONLY`, `eQTO_TYPEDRIVENOVERRIDE`, `eQUADRIC_SURF`, `eQUARTER_TURN_RAMP`, `eQUARTER_TURN_STAIR`, `eQUARTER_WINDING_STAIR`, `eQUASI_UNIFORM_KNOTS`, `eRADIAL`, `eRADIAN`, `eRADIANT`, `eRADIANTHEATER`, `eRADIATIONSENSOR`, `eRADIATOR`, `eRADIOACTIVITYSENSOR`, `eRADIOACTIVITYUNIT`, `eRAFTER`, `eRAIN`, `eRAINBOW_ROOF`, `eRAINWATER`, `eRAINWATERHOPPER`, `eREADONLY`, `eREADONLYLOCKED`, `eREADWRITE`, `eREADWRITELOCKED`, `eRECEIVER`, `eRECESS`, `eRECIPROCATING`, `eRECIRCULATEDAIR`, `eRECTANGULAR`, `eRECTIFIER`, `eREDUCER`, `eREFERENCESERVICELIFE`, `eREFLECTED_PLAN_VIEW`, `eREFLECTION`, `eREFRIGERATION`, `eREFRIGERATOR`, `eREGISTER`, `eREGULATING`, `eREINFORCEMENT_UNIT`, `eRELATIVEHUMIDITY`, `eRELAY`, `eRELIEFDAMPER`, `eRELUCTANCESYNCHRONOUS`, `eREMOVABLECASEMENT`, `eREMOVAL`, `eRENOVATION`, `eREPEATER`, `eREQUIREMENT`, `eRESELLER`, `eRESIDUALCURRENT`, `eRESIDUALCURRENTCIRCUITBREAKER`, `eRESIDUALCURRENTSWITCH`, `eRESOURCE`, `eRESTRICTED`, `eREVISION`, `eREVOLVING`, `eRIGHT`, `eRIGID_FRAME`, `eRIGID_JOINED_MEMBER`, `eRIGIDSEGMENT`, `eRING`, `eRIVET`, `eROLLINGPISTON`, `eROLLINGUP`, `eROOF`, `eROOFDRAIN`, `eROOFING`, `eROOFTOPUNIT`, `eROTARY`, `eROTARYVANE`, `eROTARYWHEEL`, `eROTATIONALFREQUENCYUNIT`, `eROTATIONALMASSUNIT`, `eROTATIONALSTIFFNESSUNIT`, `eROUND`, `eROUTER`, `eRULED_SURF`, `eRUNAROUNDCOILLOOP`, `eRUR`, `eSAFETYCUTOFF`, `eSANITARYFOUNTAIN`, `eSAR`, `eSCANNER`, `eSCHEDULEOFRATES`, `eSCR`, `eSCREEN`, `eSCREW`, `eSCROLL`, `eSECOND`, `eSECOND_ORDER_THEORY`, `eSECONDARY`, `eSECONDSHIFT`, `eSECTION_VIEW`, `eSECTIONAL`, `eSECTIONALRADIATOR`, `eSECTIONAREAINTEGRALUNIT`, `eSECTIONMODULUSUNIT`, `eSECURITY`, `eSECURITYLIGHTING`, `eSEK`, `eSELECTORSWITCH`, `eSELFILLUMINATION`, `eSEMIHERMETIC`, `eSENSIBLE`, `eSETTLEMENT_U`, `eSEWAGE`, `eSGD`, `eSHADING`, `eSHEAR`, `eSHEARCONNECTOR`, `eSHEARMODULUSUNIT`, `eSHED_ROOF`, `eSHEET`, `eSHELF`, `eSHELL`, `eSHELLANDCOIL`, `eSHELLANDTUBE`, `eSHININESS`, `eSHOE`, `eSHOWER`, `eSHRINKAGE`, `eSHUTDOWN`, `eSHUTTER`, `eSIDEHUNGLEFTHAND`, `eSIDEHUNGRIGHTHAND`, `eSIEMENS`, `eSIEVERT`, `eSIGNAL`, `eSIMULATED`, `eSINECURVE`, `eSINGLE_PANEL`, `eSINGLE_SWING_LEFT`, `eSINGLE_SWING_RIGHT`, `eSINGLESCREW`, `eSINGLESTAGE`, `eSINK`, `eSINUS`, `eSIREN`, `eSITE`, `eSITEGRADING`, `eSKETCH_VIEW`, `eSKIRTINGBOARD`, `eSKP`, `eSKYLIGHT`, `eSLAB_FIELD`, `eSLEEVING`, `eSLIDING`, `eSLIDING_TO_LEFT`, `eSLIDING_TO_RIGHT`, `eSLIDINGHORIZONTAL`, `eSLIDINGVERTICAL`, `eSMOKEDAMPER`, `eSMOKESENSOR`, `eSNOW_S`, `eSOFA`, `eSOFT`, `eSOLARCOLLECTOR`, `eSOLARPANEL`, `eSOLIDANGLEUNIT`, `eSOLIDWALL`, `eSOUNDPOWERLEVELUNIT`, `eSOUNDPOWERUNIT`, `eSOUNDPRESSURELEVELUNIT`, `eSOUNDPRESSUREUNIT`, `eSOUNDSENSOR`, `eSOURCE`, `eSOURCEANDSINK`, `eSPACE`, `eSPACEINVENTORY`, `eSPANDREL`, `eSPEAKER`, `eSPECIFICATION`, `eSPECIFICHEATCAPACITYUNIT`, `eSPECULAR`, `eSPHERICAL_SURF`, `eSPIRAL`, `eSPIRAL_RAMP`, `eSPIRAL_STAIR`, `eSPLITCASE`, `eSPLITSYSTEM`, `eSPOOL`, `eSPRING`, `eSPRINKLER`, `eSPRINKLERDEFLECTOR`, `eSQUARE_METRE`, `eSTANDALONE`, `eSTANDARD`, `eSTAPLE`, `eSTART_FINISH`, `eSTART_START`, `eSTARTER`, `eSTARTEVENT`, `eSTARTUP`, `eSTATION`, `eSTEAM`, `eSTEAMHEATINGCOIL`, `eSTEAMINJECTION`, `eSTEAMTRAP`, `eSTEEL`, `eSTEELWORK`, `eSTERADIAN`, `eSTOPCOCK`, `eSTORAGE`, `eSTORMWATER`, `eSTRAIGHT`, `eSTRAIGHT_RUN_RAMP`, `eSTRAIGHT_RUN_STAIR`, `eSTRAINER`, `eSTRAND`, `eSTRAUSS`, `eSTRINGER`, `eSTRIP_FOOTING`, `eSTRUCTURALENGINEER`, `eSTRUT`, `eSTUD`, `eSTUDSHEARCONNECTOR`, `eSUBCONTRACTOR`, `eSUBMERSIBLEPUMP`, `eSUBTRACT`, `eSUMP`, `eSUMPPUMP`, `eSUPPLIER`, `eSUPPORT`, `eSURF_OF_LINEAR_EXTRUSION`, `eSURF_OF_REVOLUTION`, `eSURVEYING`, `eSWING_FIXED_LEFT`, `eSWING_FIXED_RIGHT`, `eSWINGING`, `eSWITCHBOARD`, `eSWITCHDISCONNECTOR`, `eSWITCHER`, `eSYNCHRONOUS`, `eSYSTEM_IMPERFECTION`, `eT_BEAM`, `eTABLE`, `eTAG`, `eTAPERED`, `eTARGET`, `eTEE`, `eTELEPHONE`, `eTELEPHONEOUTLET`, `eTEMPERATURE_T`, `eTEMPERATUREGRADIENTUNIT`, `eTEMPERATURERATEOFCHANGEUNIT`, `eTEMPERATURESENSOR`, `eTENANT`, `eTENDER`, `eTENSION_MEMBER`, `eTENSIONING_END`, `eTERA`, `eTERRAIN`, `eTERTIARY`, `eTESLA`, `eTEXTURE`, `eTEXTURED`, `eTHB`, `eTHERMAL`, `eTHERMALADMITTANCEUNIT`, `eTHERMALCONDUCTANCEUNIT`, `eTHERMALEXPANSIONCOEFFICIENTUNIT`, `eTHERMALRESISTANCEUNIT`, `eTHERMALTRANSMITTANCEUNIT`, `eTHERMODYNAMICTEMPERATUREUNIT`, `eTHERMOMETER`, `eTHERMOSIPHONCOILTYPEHEATEXCHANGERS`, `eTHERMOSIPHONSEALEDTUBEHEATEXCHANGERS`, `eTHERMOSTAT`, `eTHERMOSTATICACTUATOR`, `eTHIRD_ORDER_THEORY`, `eTHIRDSHIFT`, `eTHREE_QUARTER_TURN_STAIR`, `eTHREE_QUARTER_WINDING_STAIR`, `eTILTANDTURNLEFTHAND`, `eTILTANDTURNRIGHTHAND`, `eTIMECLOCK`, `eTIMEDELAY`, `eTIMEDTWOPOSITION`, `eTIMEUNIT`, `eTOGGLESWITCH`, `eTOILETPAN`, `eTOP`, `eTOPHUNG`, `eTOROIDAL_SURF`, `eTORQUEUNIT`, `eTRANSITION`, `eTRANSPARENCYMAP`, `eTRANSPORT`, `eTRANSPORTATION`, `eTRANSPORTING`, `eTRAPDOOR`, `eTREATMENT`, `eTRENCH`, `eTRIANGULAR`, `eTRIGGERCONDITION`, `eTRIPLE_PANEL_BOTTOM`, `eTRIPLE_PANEL_HORIZONTAL`, `eTRIPLE_PANEL_LEFT`, `eTRIPLE_PANEL_RIGHT`, `eTRIPLE_PANEL_TOP`, `eTRIPLE_PANEL_VERTICAL`, `eTRL`, `eTROCHOIDAL`, `eTRUE_LENGTH`, `eTRUSS`, `eTTD`, `eTUBEAXIAL`, `eTUBULARRADIATOR`, `eTUMBLEDRYER`, `eTUNER`, `eTUNGSTENFILAMENT`, `eTV`, `eTWD`, `eTWINSCREW`, `eTWINTOWERENTHALPYRECOVERYLOOPS`, `eTWO_CURVED_RUN_STAIR`, `eTWO_QUARTER_TURN_RAMP`, `eTWO_QUARTER_TURN_STAIR`, `eTWO_QUARTER_WINDING_STAIR`, `eTWO_STRAIGHT_RUN_RAMP`, `eTWO_STRAIGHT_RUN_STAIR`, `eTWOPOSITION`, `eTYPE_A`, `eTYPE_B`, `eTYPE_C`, `eUNIFORM`, `eUNIFORM_KNOTS`, `eUNION`, `eUNITHEATER`, `eUNPRICEDBILLOFQUANTITIES`, `eUNSPECIFIED`, `eUP`, `eUPS`, `eURINAL`, `eUSD`, `eUSERDEFINED`, `eVACUUM`, `eVACUUMSTATION`, `eVALVECHAMBER`, `eVANEAXIAL`, `eVAPORPERMEABILITYUNIT`, `eVARIABLE_Q`, `eVARIABLEFLOWPRESSUREDEPENDANT`, `eVARIABLEFLOWPRESSUREINDEPENDANT`, `eVARISTOR`, `eVEB`, `eVENDINGMACHINE`, `eVENT`, `eVENTILATION`, `eVENTILATIONINDOORAIR`, `eVENTILATIONOUTSIDEAIR`, `eVERBAL`, `eVERTICALINLINE`, `eVERTICALTURBINE`, `eVESSEL`, `eVIRTUAL`, `eVND`, `eVOLT`, `eVOLTAGE`, `eVOLTMETER_PEAK`, `eVOLTMETER_RMS`, `eVOLUMETRICFLOWRATEUNIT`, `eVOLUMEUNIT`, `eWARPINGCONSTANTUNIT`, `eWARPINGMOMENTUNIT`, `eWASHHANDBASIN`, `eWASHINGMACHINE`, `eWASTEDISPOSALUNIT`, `eWASTETRAP`, `eWASTEWATER`, `eWATER`, `eWATERCOOLED`, `eWATERCOOLEDBRAZEDPLATE`, `eWATERCOOLEDSHELLCOIL`, `eWATERCOOLEDSHELLTUBE`, `eWATERCOOLEDTUBEINTUBE`, `eWATERCOOLER`, `eWATERCOOLINGCOIL`, `eWATERFILTER`, `eWATERHEATER`, `eWATERHEATINGCOIL`, `eWATERMETER`, `eWATERSUPPLY`, `eWATT`, `eWAVE`, `eWCSEAT`, `eWEATHERSTATION`, `eWEBER`, `eWEEKLY`, `eWELD`, `eWELDEDSHELLHERMETIC`, `eWHISTLE`, `eWIND_W`, `eWINDER`, `eWINDOW`, `eWINDSENSOR`, `eWIRE`, `eWOOD`, `eWORK`, `eWORKORDER`, `eWORKSURFACE`, `eWORKTIME`, `eWRAPPING`, `eXEU`, `eYEARLY_BY_DAY_OF_MONTH`, `eYEARLY_BY_POSITION`, `eZAR`, `eZWD`
- `Bricscad.Ifc.IFCExportOptions` — class；构造器：2；属性：`ExplodeExternalReferences{get/set}`, `ExportBaseQuantities{get/set}`, `ExportElementsOnFrozenAndHiddenLayer{get/set}`, `ExportMultiPlyElementsAsAggregated{get/set}`, `ObjectsToExport{get/set}`
- `Bricscad.Ifc.IFCExportReactor` — abstract class；构造器：1；方法：`AdjustProjectData`×2, `AttachReactor`, `DetachReactor`, `OnBeginIfcModelSetup`×2, `OnEndIfcModelSetup`×2, `OnEntity`×2；属性：`CurrentContext{get/set}`
- `Bricscad.Ifc.IfcGuid` — class；构造器：2；方法：`Create`, `CreateFromBase64`, `CreateFromText`, `GetBase64`, `GetText`, `op_Equality`, `op_Inequality`
- `Bricscad.Ifc.IfcHeader` — class；构造器：2；属性：`Author{get/set}`, `Authorization{get/set}`, `FileDescription{get/set}`, `FileName{get/set}`, `FileSchema{get/set}`, `ImplementationLevel{get}`, `Organization{get/set}`, `OriginatingSystem{get/set}`, `PreprocessorVersion{get/set}`, `TimeStamp{get/set}`
- `Bricscad.Ifc.IFCImportReactor` — abstract class；构造器：1；方法：`AttachReactor`, `BeforeCompletion`×2, `DetachReactor`, `IsFullySupported`, `OnIfcProduct`×2, `OnStart`×2；属性：`CurrentContext{get/set}`, `Ifc2x3Enabled{get/set}`, `Ifc4Enabled{get/set}`
- `Bricscad.Ifc.IfcLogical` — class；构造器：2；属性：`IsKnown{get}`, `IsUnknown{get}`, `Value{get}`
- `Bricscad.Ifc.IfcModel` — class；构造器：0；方法：`CreateModel`, `GetEntity`, `Read`, `Write`；属性：`NumEntities{get}`, `SchemaId{get}`
- `Bricscad.Ifc.IfcProjectData` — class；构造器：0；方法：`GetProperty`, `SetProperty`；字段：`ApplicationDeveloper`, `ApplicationFullName`, `ApplicationIdentifier`, `ApplicationVersion`, `AuthorFamilyName`, `AuthorGivenName`, `AuthorOrganization`, `ProjectDescription`, `ProjectName`, `ProjectNorthAngle`, `ProjectPhase`, `SiteAdressLines`, `SiteBuildableArea`, `SiteBuildingHeightLimit`, `SiteCountry`, `SiteDescription`, `SiteElevation`, `SiteInternalLocation`, `SiteLandTitleNumber`, `SiteLatitude`, `SiteLongitude`, `SiteName`, `SitePostalBox`, `SitePostalCode`, `SiteRegion`, `SiteTotalArea`, `SiteTown`
- `Bricscad.Ifc.IfcResult` — enum；枚举值：5
- `Bricscad.Ifc.IfcSchemaId` — enum；枚举值：3
- `Bricscad.Ifc.IfcSelectorDesc` — class；构造器：0；属性：`Name{get}`；字段：`IfcActorSelect`, `IfcAppliedValueSelect`, `IfcAxis2Placement`, `IfcBendingParameterSelect`, `IfcBooleanOperand`, `IfcCharacterStyleSelect`, `IfcClassificationNotationSelect`, `IfcClassificationReferenceSelect`, `IfcClassificationSelect`, `IfcColour`, `IfcColourOrFactor`, `IfcConditionCriterionSelect`, `IfcCoordinateReferenceSystemSelect`, `IfcCsgSelect`, `IfcCurveFontOrScaledCurveFontSelect`, `IfcCurveOrEdgeCurve`, `IfcCurveStyleFontSelect`, `IfcDateTimeSelect`, `IfcDefinedSymbolSelect`, `IfcDefinitionSelect`, `IfcDerivedMeasureValue`, `IfcDocumentSelect`, `IfcDraughtingCalloutElement`, `IfcFillAreaStyleTileShapeSelect`, `IfcFillStyleSelect`, `IfcGeometricSetSelect`, `IfcGridPlacementDirectionSelect`, `IfcHatchLineDistanceSelect`, `IfcLayeredItem`, `IfcLibrarySelect`, `IfcLightDistributionDataSourceSelect`, `IfcMaterialSelect`, `IfcMeasureValue`, `IfcMetricValueSelect`, `IfcModulusOfRotationalSubgradeReactionSelect`, `IfcModulusOfSubgradeReactionSelect`, `IfcModulusOfTranslationalSubgradeReactionSelect`, `IfcObjectReferenceSelect`, `IfcOrientationSelect`, `IfcPointOrVertexPoint`, `IfcPresentationStyleSelect`, `IfcProcessSelect`, `IfcProductRepresentationSelect`, `IfcProductSelect`, `IfcPropertySetDefinitionSelect`, `IfcResourceObjectSelect`, `IfcResourceSelect`, `IfcRotationalStiffnessSelect`, `IfcSegmentIndexSelect`, `IfcShell`, `IfcSimpleValue`, `IfcSizeSelect`, `IfcSolidOrShell`, `IfcSpaceBoundarySelect`, `IfcSpecularHighlightSelect`, `IfcStructuralActivityAssignmentSelect`, `IfcStyleAssignmentSelect`, `IfcSurfaceOrFaceSurface`, `IfcSurfaceStyleElementSelect`, `IfcSymbolStyleSelect`, `IfcTextFontSelect`, `IfcTextStyleSelect`, `IfcTimeOrRatioSelect`, `IfcTranslationalStiffnessSelect`, `IfcTrimmingSelect`, `IfcUnit`, `IfcValue`, `IfcWarpingStiffnessSelect`
- `Bricscad.Ifc.IfcSelectValue` — class；构造器：2；方法：`SetValue`；属性：`IsNull{get}`, `Tag{get}`, `Value{get}`
- `Bricscad.Ifc.IfcString` — class；构造器：3；方法：`GetString`, `IsEmpty`, `SetEmpty`
- `Bricscad.Ifc.IfcUtilityFunctions` — static class；构造器：0；方法：`ExportIfcFile`
- `Bricscad.Ifc.IfcVectorDesc` — class；构造器：0；字段：`Array_1_2_double`, `Array_1_2_IfcLengthMeasure`, `List_0_IfcInteger`, `List_0_int`, `List_1_2_IfcLengthMeasure`, `List_1_2_IfcPcurve`, `List_1_3_IfcLengthMeasure`, `List_1_8_IfcSoundValue`, `List_1_IfcActorRole`, `List_1_IfcAddress`, `List_1_IfcAlignment2DHorizontalSegment`, `List_1_IfcAlignment2DVerticalSegment`, `List_1_IfcAppliedValue`, `List_1_IfcBendingParameterSelect`, `List_1_IfcBinary`, `List_1_IfcCompositeCurveSegment`, `List_1_IfcConstraint`, `List_1_IfcCostValue`, `List_1_IfcCurveStyleFontPattern`, `List_1_IfcDateTimeSelect`, `List_1_IfcDistanceExpression`, `List_1_IfcGridAxis`, `List_1_IfcIdentifier`, `List_1_IfcIndexedPolygonalFace`, `List_1_IfcInteger`, `List_1_IfcIrregularTimeSeriesValue`, `List_1_IfcLabel`, `List_1_IfcLightDistributionData`, `List_1_IfcLuminousIntensityDistributionMeasure`, `List_1_IfcMaterial`, `List_1_IfcMaterialLayer`, `List_1_IfcMaterialProfile`, `List_1_IfcObjectDefinition`, `List_1_IfcOrientedEdge`, `List_1_IfcPhysicalQuantity`, `List_1_IfcPlaneAngleMeasure`, `List_1_IfcPositiveInteger`, `List_1_IfcReal`, `List_1_IfcRelAssignsToProjectOrder`, `List_1_IfcRepresentation`, `List_1_IfcRepresentationMap`, `List_1_IfcSectionReinforcementProperties`, `List_1_IfcSegmentIndexSelect`, `List_1_IfcShapeModel`, `List_1_IfcSimpleValue`, `List_1_IfcStructuralLoad`, `List_1_IfcStructuralLoadOrResult`, `List_1_IfcSurfaceTexture`, `List_1_IfcTableColumn`, `List_1_IfcTableRow`, `List_1_IfcText`, `List_1_IfcTextFontName`, `List_1_IfcTimePeriod`, `List_1_IfcTimeSeriesValue`, `List_1_IfcURIReference`, `List_1_IfcValue`, `List_1_List_1_2_IfcLengthMeasure`, `List_1_List_2_2_IfcLengthMeasure`, `List_1_List_2_2_IfcParameterValue`, `List_1_List_3_3_IfcLengthMeasure`, `List_1_List_3_3_IfcNormalisedRatioMeasure`, `List_1_List_3_3_IfcParameterValue`, `List_1_List_3_3_IfcPositiveInteger`, `List_1_List_3_IfcPositiveInteger`, `List_1_unsigned_int`, `List_2_2_IfcGridAxis`, `List_2_2_IfcLengthMeasure`, `List_2_2_IfcParameterValue`, `List_2_2_IfcVector`, `List_2_3_double`, `List_2_3_IfcLengthMeasure`, `List_2_3_IfcReal`, `List_2_double`, `List_2_IfcAxis2Placement3D`, `List_2_IfcCartesianPoint`, `List_2_IfcDistanceExpression`, `List_2_IfcInteger`, `List_2_IfcParameterValue`, `List_2_IfcPositiveInteger`, `List_2_IfcPositiveLengthMeasure`, `List_2_IfcProfileDef`, `List_2_IfcReal`, `List_2_IfcStructuralLoad`, `List_2_List_2_IfcCartesianPoint`, `List_2_List_2_IfcReal`, `List_3_3_IfcLengthMeasure`, `List_3_3_IfcNormalisedRatioMeasure`, `List_3_3_IfcParameterValue`, `List_3_3_IfcPositiveInteger`, `List_3_3_IfcRatioMeasure`, `List_3_4_int`, `List_3_IfcCartesianPoint`, `List_3_IfcPositiveInteger`, `List_3_IfcTextureVertex`, `Set_0_IfcCurve`, `Set_0_IfcPresentationStyle`, `Set_0_IfcPresentationStyleSelect`, `Set_1_2_IfcTrimmingSelect`, `Set_1_5_IfcSurfaceStyleElementSelect`, `Set_1_IfcActorSelect`, `Set_1_IfcAppliedValue`, `Set_1_IfcApproval`, `Set_1_IfcBoundaryCurve`, `Set_1_IfcClassificationItem`, `Set_1_IfcClassificationNotationFacet`, `Set_1_IfcClassificationNotationSelect`, `Set_1_IfcClassificationSelect`, `Set_1_IfcClosedShell`, `Set_1_IfcConnectedFaceSet`, `Set_1_IfcConstraint`, `Set_1_IfcCovering`, `Set_1_IfcCurve`, `Set_1_IfcDayInMonthNumber`, `Set_1_IfcDayInWeekNumber`, `Set_1_IfcDefinitionSelect`, `Set_1_IfcDerivedUnitElement`, `Set_1_IfcDistributionControlElement`, `Set_1_IfcDocumentInformation`, `Set_1_IfcDocumentReference`, `Set_1_IfcDocumentSelect`, `Set_1_IfcDraughtingCalloutElement`, `Set_1_IfcElement`, `Set_1_IfcFace`, `Set_1_IfcFaceBound`, `Set_1_IfcFillAreaStyleTileShapeSelect`, `Set_1_IfcFillStyleSelect`, `Set_1_IfcGeometricSetSelect`, `Set_1_IfcLayeredItem`, `Set_1_IfcLibraryReference`, `Set_1_IfcMaterial`, `Set_1_IfcMaterialConstituent`, `Set_1_IfcMonthInYearNumber`, `Set_1_IfcObject`, `Set_1_IfcObjectDefinition`, `Set_1_IfcOrganization`, `Set_1_IfcPerson`, `Set_1_IfcPhysicalQuantity`, `Set_1_IfcPresentationStyleAssignment`, `Set_1_IfcPresentationStyleSelect`, `Set_1_IfcProduct`, `Set_1_IfcProperty`, `Set_1_IfcPropertySetDefinition`, `Set_1_IfcPropertyTemplate`, `Set_1_IfcReinforcementBarProperties`, `Set_1_IfcRelaxation`, `Set_1_IfcRepresentationContext`, `Set_1_IfcRepresentationItem`, `Set_1_IfcResourceObjectSelect`, `Set_1_IfcRoot`, `Set_1_IfcShell`, `Set_1_IfcSpatialElement`, `Set_1_IfcSpatialStructureElement`, `Set_1_IfcStructuralLoadGroup`, `Set_1_IfcStructuralResultGroup`, `Set_1_IfcStyleAssignmentSelect`, `Set_1_IfcStyledItem`, `Set_1_IfcUnit`, `Set_1_IfcVertexBasedTextureMap`, `Set_1_IfcWorkTime`, `Set_2_IfcProfileDef`
- `Bricscad.Ifc.IfcVectorValue` — class；构造器：2；方法：`Add`, `Clear`, `GetCopyAt`, `Remove`；属性：`IsNull{get}`, `Size{get}`
- `Bricscad.Ifc.ImportContext` — class；构造器：0；方法：`CreateDefaultRepresentation`, `CreatePoint`, `CreateRepresentationFromItem`, `CreateSweptArea`, `GetDatabase`, `GetEntity`×2, `GetIfcModel`, `GetLocalPlacement`；属性：`AngleConversionFactor{get}`, `AreaConversionFactor{get}`, `LengthConversionFactor{get}`, `Precision{get}`, `VolumeConversionFactor{get}`
- `Bricscad.Ifc.ImportInfo` — class；构造器：1；方法：`author`, `authorization`, `fileName`, `importBimData`, `importBrepGeometryAsMeshes`, `importIfcProjectStructureAsXrefs`, `importIfcSpace`, `importParametricComponents`, `organization`, `originatingSystem`, `preprocessorVersion`, `timeStamp`

#### `Bricscad.Internal`

- `Bricscad.Internal.CommandCallback` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Internal.CommandTypeFlags` — enum；枚举值：6
- `Bricscad.Internal.CoreUtils` — class；构造器：1；方法：`GraphScr`, `TextScr`, `WcMatch`
- `Bricscad.Internal.LayerUtilities` — class；构造器：1；方法：`RegenLayers`×2, `RegenPending`
- `Bricscad.Internal.LayerUtilities+BooleanValue` — enum；枚举值：2
- `Bricscad.Internal.Utils` — class；构造器：1；方法：`AddCommand`, `ConvertBitmapToAcGiImageBGRA32`, `EntFirst`, `EntLast`, `EntNext`×2, `FlushGraphics`, `GetAcadResourceIcon`×2, `GetCommandPromptString`, `GetTextExtents`, `IsCommandActive`, `IsCommandNameInUse`, `PostCommandPrompt`, `RemoveCommand`, `SelectObjects`, `SetFocusToDwgView`, `SetUndoMark`, `ShowHideTextWindow`, `WcMatchEx`, `Zoom`, `ZoomObjects`
- `Bricscad.Internal.Utils+ResIconSize` — enum；枚举值：4
- `Bricscad.Internal.Utils+ResIconTheme` — enum；枚举值：3

#### `Bricscad.Licensing`

- `Bricscad.Licensing.License` — class；构造器：1；方法：`ActivateBSB`, `ActivateLicense`, `CheckLicense`, `ErrorMessage`, `GetLicenseInfo`, `IsFeatureAvailable`, `Roam`, `ShowLicenseProperties`
- `Bricscad.Licensing.LicensedFeature` — enum；枚举值：5
- `Bricscad.Licensing.LicenseInfo` — struct；构造器：0；字段：`numDays`, `numRoamDays`, `type`
- `Bricscad.Licensing.LicenseInfo+LicenseType` — enum；枚举值：4
- `Bricscad.Licensing.LicenseInformation` — struct；构造器：0；字段：`daysLeft`, `expiration`, `features`, `hostid`, `id`, `isExpired`, `language`, `licenseLevel`, `licenseType`, `lockingType`, `product`, `server`, `version`
- `Bricscad.Licensing.LicenseStatus` — enum；枚举值：3
- `Bricscad.Licensing.LockType` — enum；枚举值：4
- `Bricscad.Licensing.StatusCode` — struct；构造器：0；字段：`code`

#### `Bricscad.MechanicalComponents`

- `Bricscad.MechanicalComponents.ComponentDefinition` — class；构造器：2；方法：`GetComponentDefinition`, `InstanceBlockRefIds`, `IsNull`, `SetNull`；属性：`BlockId{get}`, `BomStatus{get}`, `ComponentType{get}`, `Description{get}`, `FileStatus{get}`, `GetFilePath{get}`, `IsExternal{get}`, `IsOriginal{get}`, `IsRoot{get}`, `IsUpToDate{get}`, `Material{get}`, `Name{get}`, `OriginalBlockId{get}`
- `Bricscad.MechanicalComponents.ComponentInstance` — class；构造器：2；方法：`GetComponentInstance`, `IsNull`, `SetNull`；属性：`BlockReferenceId{get}`, `InstanceBlockId{get}`, `IsVisible{get}`, `Name{get/set}`
- `Bricscad.MechanicalComponents.ComponentType` — enum；枚举值：4
- `Bricscad.MechanicalComponents.FileStatus` — enum；枚举值：4
- `Bricscad.MechanicalComponents.StatusBOM` — enum；枚举值：4

#### `Bricscad.Parametric`

- `Bricscad.Parametric.BlockParameter` — class；构造器：0；属性：`Expression{get/set}`, `HasStringValue{get}`, `StringValue{get}`, `Value{get}`
- `Bricscad.Parametric.Constraint3d` — class；构造器：0；属性：`Arguments{get}`, `BlockId{get}`, `ConstraintArguments{get}`, `Dimension{get}`, `Directions{get/set}`, `IsDimensional{get}`, `IsEnabled{get/set}`, `Measurement{get/set}`, `Name{get/set}`, `NodeId{get}`, `Parameter{get}`, `Placement{get/set}`, `Type{get}`
- `Bricscad.Parametric.ConstraintArgument` — class；构造器：4；属性：`CoordinateSystemObject{get}`, `FSP{get}`, `IsCoordinateSystemObject{get}`
- `Bricscad.Parametric.ConstraintsGroup3d` — class；构造器：0；方法：`AddConstraint`×2, `DeleteConstraint`, `Evaluate`；属性：`BlockId{get}`, `ConstraintByNodeId{get}`, `Constraints{get}`, `HasSketchPlane{get}`, `SketchPlane{get}`, `Transient{get}`
- `Bricscad.Parametric.ConstraintType` — enum；枚举值：17
- `Bricscad.Parametric.CoordinateSystemObject` — enum；枚举值：7
- `Bricscad.Parametric.DesignTable` — class；构造器：0；方法：`GetAllDesignTables`；属性：`BlockId{get}`, `Configurations{get}`, `CurrentConfiguration{get}`, `KeyName{get}`, `Name{get}`
- `Bricscad.Parametric.DesignTableConfiguration` — class；构造器：0；属性：`Name{get}`, `Variables{get}`
- `Bricscad.Parametric.DesignTableConfigurationEntry` — class；构造器：0；属性：`IsDoubleValue{get}`, `Value{get}`, `ValueAsDouble{get}`, `VariableName{get}`
- `Bricscad.Parametric.Directions` — enum；枚举值：4
- `Bricscad.Parametric.ExposeMode` — enum；枚举值：3
- `Bricscad.Parametric.GeometryDrivenMode` — enum；枚举值：3
- `Bricscad.Parametric.MeasurementMode` — enum；枚举值：3
- `Bricscad.Parametric.Parameter` — class；构造器：0；方法：`erase`, `GetByName`, `GetFromBlock`, `UnsetLowerBound`, `UnsetUpperBound`；属性：`BlockId{get}`, `ExposeMode{get/set}`, `Expression{get/set}`, `GeometryDrivenMode{get/set}`, `HasLowerBound{get}`, `HasUpperBound{get}`, `IsAnonymous{get}`, `LowerBound{get/set}`, `Name{get/set}`, `UpperBound{get/set}`, `Value{get/set}`
- `Bricscad.Parametric.Placement` — enum；枚举值：4
- `Bricscad.Parametric.Utility` — class；构造器：1；方法：`EffectiveBlockRefName`, `EffectiveBlockTableRecord`, `Get3dConstraintsGroup`, `GetAllConstraintsGroups3d`, `GetBlockParameter`, `GetBlockParameterNames`, `GetEntityGuiName`, `SetEntityGuiName`

#### `Bricscad.PlottingServices`

- `Bricscad.PlottingServices.BeginDocumentEventArgs` — class；构造器：1；属性：`Copies{get}`, `DocumentName{get}`, `FileName{get}`, `PlotInfo{get}`, `PlotToFile{get}`
- `Bricscad.PlottingServices.BeginDocumentEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.BeginPageEventArgs` — class；构造器：1；属性：`LastPage{get}`, `PlotInfo{get}`, `PlotPageInfo{get}`
- `Bricscad.PlottingServices.BeginPageEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.BeginPlotEventArgs` — class；构造器：1；属性：`BRX_PlotType{get}`, `PlotProgress{get}`
- `Bricscad.PlottingServices.BeginPlotEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.BRX_PlotType` — enum；枚举值：4
- `Bricscad.PlottingServices.DsdData` — class；构造器：1；方法：`Copy`, `GetDsdEntryCollection`, `ReadDsd`, `SetDsdEntryCollection`, `SetUnrecognizedData`×2, `WriteDsd`；属性：`CategoryName{get/set}`, `DestinationName{get/set}`, `Dwf3dOptions{get}`, `IsHomogeneous{get/set}`, `IsSheetSet{get/set}`, `LogFilePath{get/set}`, `MajorVersion{get/set}`, `MinorVersion{get/set}`, `NoOfCopies{get/set}`, `Password{get/set}`, `PlotStampOn{get/set}`, `ProjectPath{get/set}`, `PromptForDwfName{get/set}`, `SelectionSetName{get/set}`, `SheetSetName{get/set}`, `SheetType{get/set}`, `UnrecognizedDataSectionNames{get}`, `UnrecognizedDataSections{get}`
- `Bricscad.PlottingServices.DsdEntry` — class；构造器：1；方法：`Copy`；属性：`DwgName{get/set}`, `Layout{get/set}`, `Nps{get/set}`, `NpsSourceDwg{get/set}`, `OriginalSheetPath{get}`, `Title{get/set}`
- `Bricscad.PlottingServices.DsdEntryCollection` — class；构造器：1；方法：`Add`, `Clear`, `CopyTo`, `GetEnumerator`, `Insert`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Bricscad.PlottingServices.Dwf3dOptions` — class；构造器：0；属性：`GroupByXrefHierarchy{get/set}`, `PublishWithMaterials{get/set}`
- `Bricscad.PlottingServices.EndDocumentEventArgs` — class；构造器：1；属性：`Status{get}`
- `Bricscad.PlottingServices.EndDocumentEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.EndPageEventArgs` — class；构造器：1；属性：`Status{get}`
- `Bricscad.PlottingServices.EndPageEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.EndPlotEventArgs` — class；构造器：1；属性：`Status{get}`
- `Bricscad.PlottingServices.EndPlotEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.MatchingPolicy` — enum；枚举值：4
- `Bricscad.PlottingServices.MediaBounds` — class；构造器：1；方法：`Equals`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`LowerLeftPrintableArea{get/set}`, `PageSize{get/set}`, `UpperRightPrintableArea{get/set}`
- `Bricscad.PlottingServices.PageCancelledEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.PlotCancelledEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.PlottingServices.PlotCancelStatus` — enum；枚举值：3
- `Bricscad.PlottingServices.PlotConfig` — class；构造器：0；方法：`Dispose`, `GetLocalMediaName`, `GetMediaBounds`, `RefreshMediaNameList`, `SaveToPC3`；属性：`CanonicalMediaNames{get}`, `Comment{get}`, `DefaultFileExtension{get}`, `DeviceName{get}`, `DeviceType{get}`, `DriverName{get}`, `IsPlotToFile{get/set}`, `LocationName{get}`, `PlotToFileCapability{get}`, `PortName{get}`, `ServerName{get}`, `TagLine{get}`
- `Bricscad.PlottingServices.PlotConfigManager` — class；构造器：0；方法：`get_StdConfigNames`, `SetCurrentConfig`；属性：`CurrentConfig{get}`
- `Bricscad.PlottingServices.PlotEngine` — class；构造器：0；方法：`BeginDocument`, `BeginGenerateGraphics`, `BeginPage`, `BeginPlot`, `Destroy`, `EndDocument`, `EndGenerateGraphics`, `EndPage`, `EndPlot`；属性：`IsBackgroundPackaging{get}`
- `Bricscad.PlottingServices.PlotFactory` — class；构造器：0；方法：`CreatePreviewEngine`, `CreatePublishEngine`；属性：`ProcessPlotState{get}`
- `Bricscad.PlottingServices.PlotInfo` — class；构造器：1；方法：`Dispose`；属性：`DeviceOverride{get/set}`, `IsValidated{get}`, `Layout{get/set}`, `MergeStatus{get}`, `OverrideSettings{get/set}`, `ValidatedConfig{get}`, `ValidatedSettings{get}`
- `Bricscad.PlottingServices.PlotInfoValidator` — class；构造器：2；方法：`Dispose`, `Validate`；属性：`DimensionalWeight{get}`, `MediaBoundsWeight{get}`, `MediaGroupWeight{get}`, `MediaMatchingPolicy{get/set}`, `MediaMatchingThreshold{get}`, `PrintableBoundsWeight{get}`, `SheetDimensionalWeight{get}`, `SheetMediaGroupWeight{get}`
- `Bricscad.PlottingServices.PlotLogger` — class；构造器：0；方法：`EndJob`, `EndSheet`, `LogAbortRetryIgnoreError`, `LogError`, `LogInformation`, `LogMessage`, `LogSevereError`, `LogTerminalError`, `LogWarning`, `StartJob`, `StartSheet`；属性：`ErrorHasHappenedInJob{get}`, `ErrorHasHappenedInSheet{get}`, `WarningHasHappenedInJob{get}`, `WarningHasHappenedInSheet{get}`
- `Bricscad.PlottingServices.PlotMessageIndex` — enum；枚举值：11
- `Bricscad.PlottingServices.PlotPageInfo` — class；构造器：1；方法：`Dispose`；属性：`EntityCount{get}`, `GradientCount{get}`, `OleObjectCount{get}`, `RasterCount{get}`, `ShavedViewportType{get}`
- `Bricscad.PlottingServices.PlotProgress` — class；构造器：1；方法：`Heartbeat`；属性：`IsPlotCancelled{get}`, `IsSheetCancelled{get}`, `IsVisible{get/set}`, `LowerPlotProgressRange{get/set}`, `LowerSheetProgressRange{get/set}`, `PlotCancelStatus{get/set}`, `PlotProgressPos{get/set}`, `SheetCancelStatus{get/set}`, `SheetProgressPos{get/set}`, `StatusMsgString{get/set}`, `UpperPlotProgressRange{get/set}`, `UpperSheetProgressRange{get/set}`
- `Bricscad.PlottingServices.PlotProgressDialog` — class；构造器：1；方法：`Destroy`, `OnBeginPlot`, `OnBeginSheet`, `OnEndPlot`, `OnEndSheet`；属性：`IsSingleSheetPlot{get}`, `PlotMsgString{get/set}`
- `Bricscad.PlottingServices.PlotReactorManager` — class；构造器：1；事件：`BeginDocument`, `BeginPage`, `BeginPlot`, `EndDocument`, `EndPage`, `EndPlot`, `PageCancelled`, `PlotCancelled`
- `Bricscad.PlottingServices.PlotToFileCapability` — enum；枚举值：3
- `Bricscad.PlottingServices.PlotType` — enum；枚举值：4
- `Bricscad.PlottingServices.PreviewEndPlotInfo` — class；构造器：1；方法：`Dispose`；属性：`Status{get}`
- `Bricscad.PlottingServices.PreviewEndPlotStatus` — enum；枚举值：5
- `Bricscad.PlottingServices.PreviewEngineFlags` — enum；枚举值：3
- `Bricscad.PlottingServices.ProcessPlotState` — enum；枚举值：3
- `Bricscad.PlottingServices.SheetCancelStatus` — enum；枚举值：4
- `Bricscad.PlottingServices.SheetType` — enum；枚举值：7
- `Bricscad.PlottingServices.StdConfiguration` — enum；枚举值：8

#### `Bricscad.Private.Windows`

- `Bricscad.Private.Windows.RibbonImageSource` — class；构造器：2；方法：`Dispose`, `GetThemedImageSource`；属性：`Image{get/set}`, `ImageThemed{get}`, `ImageUri{get/set}`, `LargeImage{get/set}`, `LargeImageThemed{get}`, `LargeImageUri{get/set}`
- `Bricscad.Private.Windows.RibbonImageSourceConverter` — class；构造器：1；方法：`ConvertFrom`
- `Bricscad.Private.Windows.ThemedImageCache` — class；构造器：2；属性：`Image{get/set}`, `ImageUri{get/set}`, `Item{get}`

#### `Bricscad.Publishing`

- `Bricscad.Publishing.AboutToBeginBackgroundPublishingEventArgs` — class；构造器：1；方法：`ReadPrivateSection`, `WritePrivateSection`；属性：`DsdData{get}`, `JobWillPublishInBackground{get}`
- `Bricscad.Publishing.AboutToBeginBackgroundPublishingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.AboutToBeginPublishingEventArgs` — class；构造器：1；方法：`ReadPrivateSection`, `WritePrivateSection`；属性：`DsdData{get}`, `JobWillPublishInBackground{get}`, `PlotLogger{get}`
- `Bricscad.Publishing.AboutToBeginPublishingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.AboutToEndPublishingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.AboutToMoveFileEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.BeginAggregationEventArgs` — class；构造器：1；方法：`AddGlobalPropertyRange`, `AddGlobalResourceRange`；属性：`DwfFileName{get}`, `DwfPassword{get}`, `PlotLogger{get}`
- `Bricscad.Publishing.BeginAggregationEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.BeginEntityEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.BeginPublishingSheetEventArgs` — class；构造器：1；方法：`AddGlobalPropertyRange`, `AddGlobalResourceRange`；属性：`DwfPassword{get}`, `PlotLogger{get}`, `UniqueId{get}`
- `Bricscad.Publishing.BeginPublishingSheetEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.BeginSheetEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.CancelledOrFailedPublishingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.Dwf3dNavigationTreeNode` — class；构造器：2；方法：`GetKeys`, `SetKeys`；属性：`Children{get/set}`, `DisplayName{get/set}`, `IsBlock{get/set}`, `IsGroup{get/set}`
- `Bricscad.Publishing.Dwf3dNavigationTreeNodeCollection` — class；构造器：0；方法：`Add`, `Remove`；属性：`Count{get}`, `Item{get/set}`
- `Bricscad.Publishing.DwfNode` — class；构造器：2；属性：`NodeId{get/set}`, `NodeName{get/set}`
- `Bricscad.Publishing.EndEntityEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.EndPublishEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.EndSheetEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.EPlotAttribute` — class；构造器：2；属性：`Name{get/set}`, `Ns{get/set}`, `NsUrl{get/set}`, `Value{get/set}`
- `Bricscad.Publishing.EPlotAttributeCollection` — class；构造器：1；方法：`Add`, `Clear`, `CopyTo`, `GetEnumerator`；属性：`Count{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`
- `Bricscad.Publishing.EPlotProperty` — class；构造器：2；方法：`AddEplotAttribute`×2；属性：`Attributes{get/set}`, `Category{get/set}`, `Name{get/set}`, `Type{get/set}`, `Units{get/set}`, `Value{get/set}`
- `Bricscad.Publishing.EPlotPropertyBag` — class；构造器：2；属性：`Attributes{get/set}`, `Id{get/set}`, `NamespaceLocation{get/set}`, `NamespaceUrl{get/set}`, `References{get/set}`
- `Bricscad.Publishing.EPlotPropertyCollection` — class；构造器：1；方法：`Add`, `Clear`, `CopyTo`, `GetEnumerator`；属性：`Count{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`
- `Bricscad.Publishing.EPlotResource` — class；构造器：2；属性：`Mime{get/set}`, `Path{get/set}`, `Role{get/set}`
- `Bricscad.Publishing.InitPublishOptionsDialogEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Publishing.OptionsDialogResult` — class；构造器：1；属性：`DsdData{get/set}`, `PlotConfig{get/set}`, `Status{get/set}`
- `Bricscad.Publishing.PublishEntityEventArgs` — class；构造器：1；方法：`Add3DDwfProperty`, `AddNodeToMap`, `AddPropertiesIds`, `AddPropertyBag`, `Cancel`, `Flush`, `GetCurrentEntityNode`, `getEntityBlockRefPath`, `GetEntityNode`, `GetGraphicIDs`, `GetNextAvailableNode`, `GetNode`, `SetCurrentNode`, `SetNodeName`；属性：`EffectiveBlockLayerId{get}`, `Entity{get}`, `IsCancelled{get}`, `PlotLogger{get}`, `UniqueEntityId{get}`
- `Bricscad.Publishing.Publisher` — class；构造器：0；方法：`Dispose`, `PublishDsd`, `PublishExecute`, `PublishSelectedLayouts`, `ShowDwfOptionsDialog`, `ShowPublishDialog`；属性：`CurrentPublishedSheetSetPath{get}`；事件：`AboutToBeginBackgroundPublishing`, `AboutToBeginPublishing`, `AboutToEndPublishing`, `AboutToMoveFile`, `BeginAggregation`, `BeginEntity`, `BeginPublishingSheet`, `BeginSheet`, `CancelledOrFailedPublishing`, `EndEntity`, `EndPublish`, `EndSheet`, `InitPublishOptionsDialog`
- `Bricscad.Publishing.PublishEventArgs` — class；构造器：1；属性：`DwfFileName{get}`, `DwfPassword{get}`, `IsMultiSheetDwf{get}`, `TemporaryDwfFileName{get}`
- `Bricscad.Publishing.PublishSheetEventArgs` — class；构造器：1；方法：`AddPagePropertyRange`, `AddPageResourceRange`；属性：`AreLinesHidden{get}`, `ArePlottingLineWeights{get}`, `AreScalingLineWeights{get}`, `CanonicalMediaName{get}`, `Configuration{get}`, `Database{get}`, `DisplayMaxX{get}`, `DisplayMaxY{get}`, `DisplayMinX{get}`, `DisplayMinY{get}`, `DrawingScale{get}`, `Dwf3dNavigationTreeNode{get/set}`, `EffectivePlotOffsetX{get}`, `EffectivePlotOffsetXDevice{get}`, `EffectivePlotOffsetY{get}`, `EffectivePlotOffsetYDevice{get}`, `IsModelLayout{get}`, `IsPlotJobCancelled{get}`, `IsScaleSpecified{get}`, `LayoutBoundsMaxX{get}`, `LayoutBoundsMaxY{get}`, `LayoutBoundsMinX{get}`, `LayoutBoundsMinY{get}`, `LayoutMarginMaxX{get}`, `LayoutMarginMaxY{get}`, `LayoutMarginMinX{get}`, `LayoutMarginMinY{get}`, `MaxBoundsX{get}`, `MaxBoundsY{get}`, `OriginX{get}`, `OriginY{get}`, `PaperScale{get}`, `PlotBoundsMaxX{get}`, `PlotBoundsMaxY{get}`, `PlotBoundsMinX{get}`, `PlotBoundsMinY{get}`, `PlotLayoutId{get}`, `PlotLogger{get}`, `PlotPaperUnit{get}`, `PlotRotation{get}`, `PlotToFileName{get}`, `PlotToFilePath{get}`, `PlotType{get}`, `PlotWindowMaxX{get}`, `PlotWindowMaxY{get}`, `PlotWindowMinX{get}`, `PlotWindowMinY{get}`, `PrintableBoundsX{get}`, `PrintableBoundsY{get}`, `PublishingTo3DDwf{get}`, `StepsPerInch{get}`, `UniqueLayoutId{get}`, `ViewPlotted{get}`
- `Bricscad.Publishing.PublishUIEventArgs` — class；构造器：1；方法：`ReadPrivateSection`, `WritePrivateSection`；属性：`DsdData{get}`, `EffectivePlotOffsetYDevice{get}`, `JobWillPublishInBackground{get}`

#### `Bricscad.Quad`

- `Bricscad.Quad.QuadBoundary` — class；构造器：1；方法：`getAsCurves`, `getAsRegion`, `isValid`, `overlapsWithFaceEdge`, `path`, `plane`
- `Bricscad.Quad.QuadItemRegistry` — class；构造器：0；方法：`append`
- `Bricscad.Quad.QuadItems` — class；构造器：0；方法：`append`, `length`
- `Bricscad.Quad.QuadReactor` — abstract class；构造器：1；方法：`appendQuadItems`×2, `displayName`, `GUID`, `registerQuadItems`, `registerQuadReactor`, `unregisterQuadReactor`
- `Bricscad.Quad.QuadSelection` — class；构造器：0；方法：`fullData`, `hasHoveredData`, `hasPickFirstData`, `hoveredData`, `isValid`, `pickFirstData`
- `Bricscad.Quad.QuadSelectionData` — class；构造器：0；方法：`boundaryAt`, `entityAt`, `hasTypes`, `isValid`, `length`, `selectionSet`, `subentAt`, `typeAt`
- `Bricscad.Quad.QuadSelectionData+SelectedType` — enum；枚举值：3
- `Bricscad.Quad.TypeQuadBoundary` — enum；枚举值：3

#### `Bricscad.Rhino`

- `Bricscad.Rhino.RhinoUtilityFunctions` — static class；构造器：0；方法：`ExportRhinoFile`×2, `ImportRhinoFile`

#### `Bricscad.Ribbon`

- `Bricscad.Ribbon.RibbonPaletteSet` — class；构造器：0；属性：`RibbonControl{get}`, `Visible{get/set}`；事件：`Destroy`, `SizeChanged`
- `Bricscad.Ribbon.RibbonServices` — class；构造器：1；方法：`CreateRibbonPaletteSet`；属性：`RibbonPaletteSet{get/set}`；事件：`RibbonPaletteSetCreated`

#### `Bricscad.Runtime`

- `Bricscad.Runtime.AngularUnitFormat` — enum；枚举值：6
- `Bricscad.Runtime.Converter` — class；构造器：0；方法：`AngleToString`×2, `DistanceToString`×2, `StringToAngle`×2, `StringToDistance`×2
- `Bricscad.Runtime.DistanceUnitFormat` — enum；枚举值：6
- `Bricscad.Runtime.LispDataType` — enum；枚举值：17
- `Bricscad.Runtime.PerDocumentClassAttribute` — class；构造器：1；属性：`Type{get}`

#### `Bricscad.Windows`

- `Bricscad.Windows.ColorDialog` — class；构造器：1；方法：`SetDialogTabs`, `ShowDialog`；属性：`Color{get/set}`, `IncludeByBlockByLayer{get/set}`
- `Bricscad.Windows.ColorDialog+ColorTabs` — enum；枚举值：3
- `Bricscad.Windows.ComponentManager` — static class；构造器：0；属性：`Ribbon{get}`
- `Bricscad.Windows.ContextMenuExtension` — class；构造器：1；属性：`Title{get/set}`；事件：`Popup`
- `Bricscad.Windows.DefaultPane` — enum；枚举值：25
- `Bricscad.Windows.DependencyPropertyChangedEventArgs` — class；构造器：0；属性：`NewValue{get}`, `OldValue{get}`
- `Bricscad.Windows.DependencyPropertyChangedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.DockingTemplate` — class；构造器：4；属性：`DefaultDock{get/set}`, `DefaultStackId{get/set}`, `DefaultStackZ{get/set}`
- `Bricscad.Windows.DockSides` — enum；枚举值：5
- `Bricscad.Windows.DropTarget` — abstract class；构造器：0；方法：`OnDragEnter`, `OnDragLeave`, `OnDragOver`, `OnDrop`
- `Bricscad.Windows.IconType` — enum；枚举值：4
- `Bricscad.Windows.LinetypeDialog` — class；构造器：1；方法：`ShowDialog`；属性：`IncludeByBlockByLayer{get/set}`, `Linetype{get/set}`
- `Bricscad.Windows.LineWeightDialog` — class；构造器：1；方法：`ShowDialog`, `ShowModal`；属性：`IncludeByBlockByLayer{get/set}`, `LineWeight{get/set}`
- `Bricscad.Windows.Menu` — abstract class；构造器：0；属性：`MenuItems{get}`
- `Bricscad.Windows.MenuItem` — class；构造器：2；方法：`OnClicked`；属性：`Checked{get/set}`, `Enabled{get/set}`, `Icon{get/set}`, `Items{get}`, `Text{get/set}`, `Visible{get/set}`；事件：`Click`
- `Bricscad.Windows.MenuItemCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`×2, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`
- `Bricscad.Windows.OpenFileDialog` — class；构造器：1；方法：`GetFilenames`, `ShowDialog`；属性：`Filename{get}`
- `Bricscad.Windows.OpenFileDialog+OpenFileDialogFlags` — enum；枚举值：3
- `Bricscad.Windows.Palette` — class；构造器：0；属性：`Name{get/set}`, `PaletteSet{get}`
- `Bricscad.Windows.PaletteActivatedEventArgs` — class；构造器：1；属性：`Activated{get}`, `Deactivated{get}`
- `Bricscad.Windows.PaletteActivatedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.PalettePersistEventArgs` — class；构造器：1；属性：`ConfigurationSection{get}`
- `Bricscad.Windows.PalettePersistEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.PaletteSet` — class；构造器：3；方法：`Activate`, `Add`, `AddVisual`×2, `CopyTo`×2, `GetEnumerator`, `Remove`；属性：`Anchored{get}`, `AutoRollUp{get/set}`, `Count{get}`, `DeviceIndependentLocation{get/set}`, `DeviceIndependentSize{get/set}`, `Dock{get/set}`, `DockEnabled{get/set}`, `Icon{get/set}`, `IsSynchronized{get}`, `Item{get}`, `KeepFocus{get/set}`, `Location{get/set}`, `MinimumSize{get/set}`, `Name{get/set}`, `Opacity{get/set}`, `RolledUp{get/set}`, `Size{get/set}`, `Style{get/set}`, `SyncRoot{get}`, `TitleBarLocation{get/set}`, `Visible{get/set}`；事件：`Load`, `PaletteActivated`, `Save`, `SizeChanged`, `StateChanged`
- `Bricscad.Windows.PaletteSetSizeEventArgs` — class；构造器：1；属性：`DeviceIndependentHeight{get}`, `DeviceIndependentWidth{get}`, `Height{get}`, `Width{get}`
- `Bricscad.Windows.PaletteSetSizeEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.PaletteSetStateEventArgs` — class；构造器：1；属性：`NewState{get}`
- `Bricscad.Windows.PaletteSetStateEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.PaletteSetStyles` — enum；枚举值：7
- `Bricscad.Windows.PaletteSetTitleBarLocation` — enum；枚举值：2
- `Bricscad.Windows.Pane` — class；构造器：2；属性：`MaximumWidth{get/set}`, `MinimumWidth{get/set}`, `Name{get/set}`, `RegistryKey{get/set}`, `Style{get/set}`, `Text{get/set}`
- `Bricscad.Windows.PaneCollection` — class；构造器：0；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get/set}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `Item{get/set}`
- `Bricscad.Windows.Panel` — class；构造器：6；方法：`RegisterRestartableTool`；属性：`Icon{get/set}`, `Name{get}`, `Title{get/set}`, `Visible{get/set}`；事件：`StateChanged`
- `Bricscad.Windows.PanelStateEventArgs` — class；构造器：1；属性：`NewState{get}`
- `Bricscad.Windows.PanelStateEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.PaneStyles` — enum；枚举值：6
- `Bricscad.Windows.RibbonButton` — class；构造器：1；方法：`CopyFrom`；属性：`ButtonStyle{get/set}`, `MacroId{get/set}`
- `Bricscad.Windows.RibbonButtonStyle` — enum；枚举值：6
- `Bricscad.Windows.RibbonCombo` — class；构造器：1
- `Bricscad.Windows.RibbonCommandItem` — class；构造器：1；方法：`CopyFrom`；属性：`CommandHandler{get/set}`, `CommandParameter{get/set}`
- `Bricscad.Windows.RibbonControl` — class；构造器：0；方法：`ClearAllTabs`, `FindItem`×4, `FindPanel`×2, `FindTab`；属性：`ActiveTab{get/set}`, `Tabs{get}`；事件：`IsVisibleChanged`, `Loaded`
- `Bricscad.Windows.RibbonItem` — class；构造器：1；方法：`Clone`, `CopyFrom`；属性：`Id{get/set}`, `Image{get/set}`, `ImagePath{get/set}`, `IsEnabled{get/set}`, `IsInitialized{get}`, `IsVisible{get/set}`, `LargeImage{get/set}`, `Name{get/set}`, `ShowImage{get/set}`, `ShowText{get/set}`, `Size{get/set}`, `Text{get/set}`, `ToolTip{get/set}`, `Width{get/set}`；事件：`Initialized`, `PropertyChanged`
- `Bricscad.Windows.RibbonItemCollection` — class；构造器：1；方法：`Find`
- `Bricscad.Windows.RibbonItemEventArgs` — class；构造器：0；属性：`Item{get/set}`
- `Bricscad.Windows.RibbonItemSize` — enum；枚举值：2
- `Bricscad.Windows.RibbonList` — abstract class；构造器：0；属性：`Current{get/set}`, `Items{get}`；事件：`CurrentChanged`, `DropDownClosed`, `DropDownOpened`
- `Bricscad.Windows.RibbonListButton` — class；构造器：1；方法：`CopyFrom`；属性：`Current{get/set}`, `Items{get}`
- `Bricscad.Windows.RibbonObservableCollection`1` — class；构造器：1；方法：`CopyFrom`
- `Bricscad.Windows.RibbonPanel` — class；构造器：1；方法：`Clone`, `CopyFrom`, `FindItem`×2, `GetWPFControl`, `SetWPFControl`；属性：`IsEnabled{get/set}`, `IsVisible{get/set}`, `Source{get/set}`, `Tab{get}`；事件：`PropertyChanged`；字段：`IsEnabledPropertyName`, `IsVisiblePropertyName`, `SourcePropertyName`
- `Bricscad.Windows.RibbonPanelBreak` — class；构造器：1
- `Bricscad.Windows.RibbonPanelCollection` — class；构造器：1
- `Bricscad.Windows.RibbonPanelSource` — class；构造器：1；方法：`Clone`, `CopyFrom`, `FindItem`×2；属性：`Id{get/set}`, `Items{get}`, `Name{get/set}`, `Title{get/set}`；事件：`PropertyChanged`；字段：`IdPropertyName`, `NamePropertyName`, `TitlePropertyName`
- `Bricscad.Windows.RibbonPanelSourceCollection` — class；构造器：1；方法：`Find`
- `Bricscad.Windows.RibbonProperty` — enum；枚举值：2
- `Bricscad.Windows.RibbonPropertyChangedEventArgs` — class；构造器：0；属性：`NewValue{get}`, `OldValue{get}`
- `Bricscad.Windows.RibbonRowBreak` — class；构造器：1
- `Bricscad.Windows.RibbonRowPanel` — class；构造器：1；属性：`Items{get}`
- `Bricscad.Windows.RibbonSeparator` — class；构造器：1；方法：`CopyFrom`；属性：`SeparatorStyle{get/set}`；字段：`SeparatorStylePropertyName`
- `Bricscad.Windows.RibbonSeparatorStyle` — enum；枚举值：4
- `Bricscad.Windows.RibbonSplitButton` — class；构造器：1；方法：`CopyFrom`, `CurrentItem`×2；属性：`Behavior{get/set}`
- `Bricscad.Windows.RibbonSplitButtonBehavior` — enum；枚举值：5
- `Bricscad.Windows.RibbonTab` — class；构造器：1；方法：`Clone`, `CopyFrom`, `FindItem`×4, `FindPanel`；属性：`Id{get/set}`, `IsActive{get/set}`, `IsEnabled{get/set}`, `IsVisible{get/set}`, `Name{get/set}`, `Panels{get}`, `Title{get/set}`；事件：`PropertyChanged`
- `Bricscad.Windows.RibbonTabCollection` — class；构造器：1
- `Bricscad.Windows.RibbonTextBox` — class；构造器：1；方法：`CopyFrom`；属性：`TextValue{get/set}`
- `Bricscad.Windows.RibbonToggleButton` — class；构造器：1；方法：`CopyFrom`；属性：`CheckState{get/set}`；事件：`CheckStateChanged`
- `Bricscad.Windows.SaveFileDialog` — class；构造器：1；方法：`ShowDialog`；属性：`Filename{get}`
- `Bricscad.Windows.SaveFileDialog+SaveFileDialogFlags` — enum；枚举值：2
- `Bricscad.Windows.StateEventIndex` — enum；枚举值：3
- `Bricscad.Windows.StatusBar` — class；构造器：0；方法：`CloseBubbleWindows`, `GetDefaultPane`, `RemoveDefaultPane`, `Update`；属性：`Panes{get}`, `TrayItems{get}`, `Window{get}`
- `Bricscad.Windows.StatusBarItem` — class；构造器：0；方法：`DisplayContextMenu`, `PointToClient`, `PointToScreen`；属性：`Enabled{get/set}`, `Icon{get/set}`, `Name{get}`, `ToolTipText{get/set}`, `Visible{get/set}`；事件：`Deleted`, `MouseDown`
- `Bricscad.Windows.StatusBarMouseDownEventArgs` — class；构造器：0；属性：`Button{get}`, `DoubleClick{get}`, `X{get}`, `Y{get}`
- `Bricscad.Windows.StatusBarMouseDownEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.TrayItem` — class；构造器：1；方法：`CloseBubbleWindows`, `ShowBubbleWindow`
- `Bricscad.Windows.TrayItemBubbleWindow` — class；构造器：1；属性：`HyperLink{get/set}`, `HyperText{get/set}`, `IconType{get/set}`, `Text{get/set}`, `Text2{get/set}`, `Title{get/set}`；事件：`Closed`
- `Bricscad.Windows.TrayItemBubbleWindowClosedEventArgs` — class；构造器：0；属性：`CloseReason{get}`
- `Bricscad.Windows.TrayItemBubbleWindowClosedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Bricscad.Windows.TrayItemBubbleWindowCloseReason` — enum；枚举值：7
- `Bricscad.Windows.TrayItemCollection` — class；构造器：0；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get/set}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `Item{get/set}`
- `Bricscad.Windows.Window` — class；构造器：0；方法：`Close`, `Focus`, `GetDeviceIndependentScale`, `GetIcon`, `GetLocation`, `GetSize`, `SetIcon`, `SetLocation`, `SetSize`；属性：`DeviceIndependentLocation{get/set}`, `DeviceIndependentSize{get/set}`, `Handle{get}`, `Icon{get/set}`, `Location{get/set}`, `Size{get/set}`, `Text{get/set}`, `Visible{get/set}`, `WindowState{get/set}`

#### `Microsoft.VisualC.MFC`

- `Microsoft.VisualC.MFC.CWin32Window` — class；构造器：1；属性：`Handle{get}`
- `Microsoft.VisualC.MFC.CWinFormsEventsHelper` — class；构造器：1；方法：`Advise`, `Unadvise`；属性：`Control{get/set}`；字段：`m_pControl`, `m_pSink`

### TA_Mgd

#### `Teigha.Aec`

- `Teigha.Aec.InitAECApp` — class；构造器：1；方法：`InitDisplaySystem`

#### `Teigha.Aec.DatabaseServices`

- `Teigha.Aec.DatabaseServices.Anchor` — class；构造器：1
- `Teigha.Aec.DatabaseServices.AnchorEntityToCurve` — class；构造器：1；属性：`AnchorX{get}`, `AnchorY{get}`, `AnchorZ{get}`, `FlipX{get/set}`, `FlipY{get/set}`, `FlipZ{get/set}`, `Rotation{get/set}`, `RotationAroundX{get/set}`
- `Teigha.Aec.DatabaseServices.AnchorToCurveX` — class；构造器：1；属性：`MeasureToType{get/set}`, `OffsetDistance{get/set}`, `OffsetType{get/set}`
- `Teigha.Aec.DatabaseServices.AnchorToCurveY` — class；构造器：1；属性：`MeasureToType{get/set}`, `OffsetDistance{get/set}`, `OffsetType{get/set}`
- `Teigha.Aec.DatabaseServices.AnchorToCurveZ` — class；构造器：1；属性：`MeasureToType{get/set}`, `OffsetDistance{get/set}`, `OffsetType{get/set}`
- `Teigha.Aec.DatabaseServices.AnchorToReference` — class；构造器：1
- `Teigha.Aec.DatabaseServices.CellLayoutTool` — class；构造器：1
- `Teigha.Aec.DatabaseServices.CurveXMeasureToType` — enum；枚举值：3
- `Teigha.Aec.DatabaseServices.CurveXOffsetType` — enum；枚举值：3
- `Teigha.Aec.DatabaseServices.CurveYMeasureToType` — enum；枚举值：3
- `Teigha.Aec.DatabaseServices.CurveYOffsetType` — enum；枚举值：3
- `Teigha.Aec.DatabaseServices.CurveZMeasureToType` — enum；枚举值：3
- `Teigha.Aec.DatabaseServices.CurveZOffsetType` — enum；枚举值：3
- `Teigha.Aec.DatabaseServices.DBObject` — class；构造器：1
- `Teigha.Aec.DatabaseServices.DictionaryRecord` — class；构造器：0；属性：`Description{get/set}`, `DictRecordDescription{get/set}`
- `Teigha.Aec.DatabaseServices.Entity` — abstract class；构造器：0；属性：`Description{get/set}`, `StyleId{get/set}`
- `Teigha.Aec.DatabaseServices.Geo` — class；构造器：0；属性：`GeoEcs{get}`
- `Teigha.Aec.DatabaseServices.GridAssembly` — class；构造器：1
- `Teigha.Aec.DatabaseServices.ImpObject` — class；构造器：1；方法：`SetToStandard`, `SubSetDatabaseDefaults`；属性：`Database{get}`, `Description{get/set}`
- `Teigha.Aec.DatabaseServices.LayoutTool` — class；构造器：1
- `Teigha.Aec.DatabaseServices.MassElement` — class；构造器：1；方法：`CreateObround`, `Extrusion`, `SetBody`；属性：`Depth{get/set}`, `Height{get/set}`, `Radius{get/set}`, `Rise{get/set}`, `SType{set}`, `Width{get/set}`
- `Teigha.Aec.DatabaseServices.ShapeType` — enum；枚举值：15

#### `Teigha.Aec.Geometry`

- `Teigha.Aec.Geometry.CompoundCurve2d` — class；构造器：1；属性：`IsClosed{get/set}`, `SegmentCount{get}`
- `Teigha.Aec.Geometry.Profile` — class；构造器：1；属性：`Area{get}`, `Centroid{get}`, `RingCount{get}`, `Rings{get}`
- `Teigha.Aec.Geometry.Ring` — class；构造器：1；属性：`Area{get}`, `Centroid{get}`, `Segments{get}`
- `Teigha.Aec.Geometry.RingCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.Aec.Geometry.Segment2d` — class；构造器：1；方法：`Set`；属性：`EndPoint{get}`, `StartPoint{get}`, `Visible{get/set}`
- `Teigha.Aec.Geometry.Segment2dCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`

#### `Teigha.Aec.Modeler`

- `Teigha.Aec.Modeler.Body` — abstract class；构造器：0；方法：`CreateFreeForm`
- `Teigha.Aec.Modeler.Entity` — abstract class；构造器：0；属性：`Flags{get/set}`

#### `Teigha.Runtime`

- `Teigha.Runtime.AecServices` — class；构造器：1；方法：`Dispose`

### TA_MgdArch

#### `Teigha.Aec.Arch.DatabaseServices`

- `Teigha.Aec.Arch.DatabaseServices.AnchorEntityToWall` — class；构造器：1
- `Teigha.Aec.Arch.DatabaseServices.AnchorOpeningBaseToWall` — class；构造器：1
- `Teigha.Aec.Arch.DatabaseServices.Door` — class；构造器：1
- `Teigha.Aec.Arch.DatabaseServices.InstanceBasedValue` — class；构造器：1；属性：`BaseValue{get/set}`, `Operand{get/set}`, `OperatorType{get/set}`, `UseInstanceValue{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.InstanceBasedValueOperatorType` — enum；枚举值：4
- `Teigha.Aec.Arch.DatabaseServices.OpenFiller` — class；构造器：1；属性：`LeafWidth{get/set}`, `OpenPercent{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.Opening` — class；构造器：1；属性：`CustomShapeId{get/set}`, `ShapeType{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.OpeningBase` — class；构造器：1；方法：`AttachWallAnchor`；属性：`Height{get/set}`, `Rise{get/set}`, `Width{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.OpenShapeType` — enum；枚举值：14
- `Teigha.Aec.Arch.DatabaseServices.RoofSlab` — class；构造器：1
- `Teigha.Aec.Arch.DatabaseServices.Slab` — class；构造器：1
- `Teigha.Aec.Arch.DatabaseServices.SlabBase` — class；构造器：1；方法：`SetBaseCurve`；属性：`BaseThickness{get/set}`, `Face{get}`, `HorizontalOffset{get/set}`, `PivotPoint{get/set}`, `VerticalOffset{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.Wall` — class；构造器：1；方法：`Set`；属性：`BaseHeight{get/set}`, `CleanupGroupDefinitionId{get/set}`, `CleanupRadius{get/set}`, `DontCleanup{get/set}`, `EndPoint{set}`, `FloorLine{get/set}`, `JustificationType{get/set}`, `Length{get/set}`, `MidPoint{get}`, `RoofLine{get/set}`, `StartPoint{set}`, `Width{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.WallCleanupGroupDefinition` — class；构造器：1；方法：`CreateCleanupGroupDef`, `GetCleanupGroupDef`；属性：`CrossXrefBoundaries{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.WallCutLine` — class；构造器：2；属性：`Anchors{get}`, `CutLineType{get}`
- `Teigha.Aec.Arch.DatabaseServices.WallCutLineAnchor` — class；构造器：1；属性：`DistanceOffset{get}`, `DistanceOffsetType{get}`, `HeightOffset{get}`, `HeightOffsetType{get}`
- `Teigha.Aec.Arch.DatabaseServices.WallCutLineAnchorCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.WallCutLineAnchorOffsetType` — enum；枚举值：8
- `Teigha.Aec.Arch.DatabaseServices.WallCutLineType` — enum；枚举值：2
- `Teigha.Aec.Arch.DatabaseServices.WallJustificationType` — enum；枚举值：4
- `Teigha.Aec.Arch.DatabaseServices.WallStyle` — class；构造器：1；方法：`ComponentsAdd`, `CreateWallStyle`, `GetWallStyle`；属性：`CleanupRadius{set}`, `Components{get}`, `DontCleanup{set}`, `Name{get}`, `Width{set}`
- `Teigha.Aec.Arch.DatabaseServices.WallStyleComponent` — class；构造器：1；属性：`MaterialId{get/set}`, `Name{get/set}`, `Position{get}`, `Priority{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.WallStyleComponentCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.Aec.Arch.DatabaseServices.WallStyleComponentPosition` — class；构造器：1；方法：`SetFixedEdgeOffset`, `SetFixedWidth`
- `Teigha.Aec.Arch.DatabaseServices.Window` — class；构造器：1
- `Teigha.Aec.Arch.DatabaseServices.WindowAssembly` — class；构造器：1

#### `Teigha.Aec.Arch.Geometry`

- `Teigha.Aec.Arch.Geometry.SlabFace` — class；构造器：1；方法：`GetProfile`
- `Teigha.Aec.Arch.Geometry.SlabLoop` — class；构造器：1
- `Teigha.Aec.Arch.Geometry.SlabLoopCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`

#### `Teigha.Runtime`

- `Teigha.Runtime.AecArchServices` — class；构造器：1；方法：`Dispose`

### TA_MgdStructure

#### `Teigha.Aec.Structural.DatabaseServices`

- `Teigha.Aec.Structural.DatabaseServices.Justification` — enum；枚举值：10
- `Teigha.Aec.Structural.DatabaseServices.Member` — class；构造器：1；方法：`AddTrimPlane`, `DeleteTrimPlane`, `Set`；属性：`EndOffset{get/set}`, `Justification{get/set}`, `Length{get}`, `MemberType{get/set}`, `MidPoint{get}`, `Roll{get/set}`, `StartOffset{get/set}`, `TrimPlaneCount{get}`, `TrimPlanes{get}`
- `Teigha.Aec.Structural.DatabaseServices.MemberComponent` — class；构造器：1；属性：`EndNode{get/set}`, `EndOffset{get/set}`, `MaterialId{get/set}`, `Name{get/set}`, `Priority{get/set}`, `StartNode{get/set}`, `StartOffset{get/set}`
- `Teigha.Aec.Structural.DatabaseServices.MemberComponentCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.Aec.Structural.DatabaseServices.MemberNodeComponent` — class；构造器：1；属性：`Mirror{get/set}`, `OffSet{get/set}`, `ReferenceNodeId{get/set}`, `Rotation{get/set}`, `Scale{get/set}`, `ShapeId{get/set}`
- `Teigha.Aec.Structural.DatabaseServices.MemberNodeId` — class；构造器：2；属性：`Index{get/set}`, `RelativeEnd{get/set}`
- `Teigha.Aec.Structural.DatabaseServices.MemberNodeShape` — class；构造器：1；方法：`CreateMemberNodeShape`, `GetMemberNodeShape`, `SetProfile`
- `Teigha.Aec.Structural.DatabaseServices.MemberStyle` — class；构造器：1；方法：`ComponentsAdd`, `CreateMemberStyle`, `GetMemberStyle`
- `Teigha.Aec.Structural.DatabaseServices.MemberType` — enum；枚举值：3
- `Teigha.Aec.Structural.DatabaseServices.RelativeEnd` — enum；枚举值：2
- `Teigha.Aec.Structural.DatabaseServices.TrimPlane` — class；构造器：1；属性：`End{get/set}`, `Plane{get/set}`, `PlaneNormal{get}`, `PointOnPlane{get}`
- `Teigha.Aec.Structural.DatabaseServices.TrimPlaneCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.Aec.Structural.DatabaseServices.TrimPlaneFrom` — enum；枚举值：3

### TD_Mgd

#### `Teigha.Colors`

- `Teigha.Colors.Color` — class；构造器：1；方法：`Audit`, `Clone`, `CompareTo`, `DwgIn`, `DwgOut`, `DxfIn`, `DxfOut`, `Equals`, `FromColor`, `FromColorIndex`, `FromDictionaryName`, `FromEntityColor`, `FromNames`, `FromRgb`, `GetHashCode`, `op_Equality`, `op_GreaterThan`, `op_Inequality`, `op_LessThan`, `ToString`×2；属性：`Blue{get}`, `BookName{get}`, `ColorIndex{get}`, `ColorMethod{get}`, `ColorName{get}`, `ColorNameForDisplay{get}`, `ColorValue{get}`, `Description{get}`, `DictionaryKey{get}`, `DictionaryKeyLength{get}`, `EntityColor{get}`, `Explanation{get}`, `Green{get}`, `HasBookName{get}`, `HasColorName{get}`, `IsByAci{get}`, `IsByBlock{get}`, `IsByColor{get}`, `IsByLayer{get}`, `IsByPen{get}`, `IsForeground{get}`, `IsNone{get}`, `PenIndex{get}`, `Red{get}`
- `Teigha.Colors.ColorMethod` — enum；枚举值：9
- `Teigha.Colors.EntityColor` — struct；构造器：4；方法：`LookUpAci`, `LookUpRgb`；属性：`Blue{get}`, `ColorIndex{get}`, `ColorMethod{get}`, `Green{get}`, `IsByAci{get}`, `IsByBlock{get}`, `IsByColor{get}`, `IsByLayer{get}`, `IsByPen{get}`, `IsForeground{get}`, `IsLayerFrozen{get}`, `IsLayerFrozenOrOff{get}`, `IsLayerOff{get}`, `IsNone{get}`, `LayerIndex{get}`, `PenIndex{get}`, `Red{get}`, `TrueColor{get}`
- `Teigha.Colors.EntityColorCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Colors.EntityColorCollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.Colors.Transparency` — struct；构造器：2；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Alpha{get}`, `IsByAlpha{get}`, `IsByBlock{get}`, `IsByLayer{get}`, `IsClear{get}`, `IsSolid{get}`
- `Teigha.Colors.TransparencyCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `Copy`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`
- `Teigha.Colors.TransparencyCollectionEnumerator` — class；构造器：1；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.Colors.TransparencyMethod` — enum；枚举值：4

#### `Teigha.DatabaseServices`

- `Teigha.DatabaseServices.AbstractViewPE` — class；构造器：1；方法：`GetClass`, `GetPlotExtents`, `GetViewExtents`, `SetUcsFromView`, `SetView`×2, `SetViewport`, `ZoomExtents`×3；属性：`BackClipDistance{get/set}`, `Direction{get}`, `Elevation{get/set}`, `EyeToWorld{get}`, `FieldHeight{get}`, `FieldWidth{get}`, `FrontClipDistance{get/set}`, `FrozenLayers{get/set}`, `HasUcs{get}`, `HasViewOffset{get}`, `HasViewport{get}`, `IsBackClipOn{get/set}`, `IsFrontClipAtEyeOn{get/set}`, `IsFrontClipOn{get/set}`, `IsPerspective{get}`, `IsPlotting{get}`, `LensLength{get/set}`, `LowerLeftCorner{get}`, `OrthoUcs{get/set}`, `RenderMode{get/set}`, `Target{get}`, `Ucs{get/set}`, `UcsName{get/set}`, `UpperRightCorner{get}`, `UpVector{get}`, `ViewOffset{get}`, `ViewTwist{get}`, `VisualStyle{get/set}`, `WorldToEye{get}`
- `Teigha.DatabaseServices.AbstractViewportData` — class；构造器：1；方法：`GetClass`, `SetProps`；属性：`CircleSides{get/set}`, `GridIncrement{get/set}`, `GsView{get/set}`, `IsGridOn{get/set}`, `IsSnapIsometric{get/set}`, `IsSnapOn{get/set}`, `IsUcsFollowModeOn{get/set}`, `IsUcsIconAtOrigin{get/set}`, `IsUcsIconVisible{get/set}`, `IsUcsSavedWithViewport{get/set}`, `SnapAngle{get/set}`, `SnapBase{get/set}`, `SnapIncrement{get/set}`, `SnapIsoPair{get/set}`
- `Teigha.DatabaseServices.AbstractViewTable` — abstract class；构造器：0
- `Teigha.DatabaseServices.AbstractViewTableRecord` — abstract class；构造器：0；方法：`SetSun`, `SetUcs`×3, `SetUcsToWorld`, `SetViewDirection`；属性：`AmbientLightColor{get/set}`, `BackClipDistance{get/set}`, `BackClipEnabled{get/set}`, `Background{get/set}`, `Brightness{get/set}`, `CenterPoint{get/set}`, `Contrast{get/set}`, `DefaultLightingOn{get/set}`, `DefaultLightingType{get/set}`, `Elevation{get/set}`, `FrontClipAtEye{get/set}`, `FrontClipDistance{get/set}`, `FrontClipEnabled{get/set}`, `Height{get/set}`, `LensLength{get/set}`, `PerspectiveEnabled{get/set}`, `RenderMode{get/set}`, `SunId{get}`, `Target{get/set}`, `Ucs{get}`, `UcsName{get}`, `UcsOrthographic{get}`, `ViewDirection{get/set}`, `ViewOrthographic{get}`, `ViewTwist{get/set}`, `VisualStyleId{get/set}`, `Width{get/set}`
- `Teigha.DatabaseServices.AdsName` — struct；构造器：0；方法：`ToArray`；字段：`name1`, `name2`
- `Teigha.DatabaseServices.AlignedDimension` — class；构造器：2；属性：`DimLinePoint{get/set}`, `Oblique{get/set}`, `XLine1Point{get/set}`, `XLine2Point{get/set}`
- `Teigha.DatabaseServices.AngleConstraint` — enum；枚举值：7
- `Teigha.DatabaseServices.AnnotationScale` — class；构造器：1；属性：`CollectionName{get}`, `DrawingUnits{get/set}`, `IsTemporaryScale{get}`, `Name{get/set}`, `PaperUnits{get/set}`, `Scale{get}`, `UniqueIdentifier{get}`
- `Teigha.DatabaseServices.AnnotationType` — enum；枚举值：4
- `Teigha.DatabaseServices.AnnotativeStates` — enum；枚举值：3
- `Teigha.DatabaseServices.ApplicationLoadReasons` — enum；枚举值：6
- `Teigha.DatabaseServices.Arc` — class；构造器：3；属性：`Center{get/set}`, `EndAngle{get/set}`, `Length{get}`, `Normal{get/set}`, `Radius{get/set}`, `StartAngle{get/set}`, `Thickness{get/set}`, `TotalAngle{get}`
- `Teigha.DatabaseServices.ArcDimension` — class；构造器：1；属性：`ArcEndParam{get/set}`, `ArcPoint{get/set}`, `ArcStartParam{get/set}`, `ArcSymbolType{get/set}`, `CenterPoint{get/set}`, `HasLeader{get/set}`, `IsPartial{get/set}`, `Leader1Point{get/set}`, `Leader2Point{get/set}`, `XLine1Point{get/set}`, `XLine2Point{get/set}`
- `Teigha.DatabaseServices.AssocEvaluationPriority` — enum；枚举值：3
- `Teigha.DatabaseServices.AssocFlags` — enum；枚举值：4
- `Teigha.DatabaseServices.AssocStatus` — enum；枚举值：7
- `Teigha.DatabaseServices.AttachmentPoint` — enum；枚举值：24
- `Teigha.DatabaseServices.AttributeCollection` — class；构造器：0；方法：`AppendAttribute`, `CopyTo`, `GetEnumerator`；属性：`Count{get}`, `Item{get}`
- `Teigha.DatabaseServices.AttributeDefinition` — class；构造器：2；方法：`UpdateMTextAttributeDefinition`；属性：`Constant{get/set}`, `FieldLength{get/set}`, `Invisible{get/set}`, `IsMTextAttributeDefinition{get/set}`, `LockPositionInBlock{get/set}`, `MTextAttributeDefinition{get/set}`, `Preset{get/set}`, `Prompt{get/set}`, `Tag{get/set}`, `Verifiable{get/set}`
- `Teigha.DatabaseServices.AttributeReference` — class；构造器：2；方法：`SetAttributeFromBlock`×2, `UpdateMTextAttribute`；属性：`FieldLength{get/set}`, `Invisible{get/set}`, `IsConstant{get}`, `IsMTextAttribute{get/set}`, `IsPreset{get}`, `IsVerifiable{get}`, `LockPositionInBlock{get/set}`, `MTextAttribute{get/set}`, `Tag{get/set}`
- `Teigha.DatabaseServices.AuditInfo` — class；构造器：1；方法：`ErrorsFixed`, `ErrorsFound`, `IncNumEntities`, `PrintError`×2, `PrintNumEntities`, `RequestRegen`, `ResetNumEntities`；属性：`AuditPass{get}`, `FixErrors{get/set}`, `NumEntities{get}`, `NumErrors{get}`, `NumFixes{get}`
- `Teigha.DatabaseServices.AuditPass` — enum；枚举值：2
- `Teigha.DatabaseServices.Background` — class；构造器：0；方法：`GetBackgroundDictionaryId`
- `Teigha.DatabaseServices.BeginInsertEventArgs` — class；构造器：0；属性：`From{get}`
- `Teigha.DatabaseServices.BeginInsertEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.BeginWblockBlockEventArgs` — class；构造器：0；属性：`BlockId{get}`, `From{get}`
- `Teigha.DatabaseServices.BeginWblockBlockEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.BeginWblockEntireDatabaseEventArgs` — class；构造器：0；属性：`From{get}`
- `Teigha.DatabaseServices.BeginWblockEntireDatabaseEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.BeginWblockObjectsEventArgs` — class；构造器：0；属性：`From{get}`, `IdMapping{get}`
- `Teigha.DatabaseServices.BeginWblockObjectsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.BeginWblockSelectedObjectsEventArgs` — class；构造器：0；属性：`From{get}`, `InsertionPoint{get}`
- `Teigha.DatabaseServices.BeginWblockSelectedObjectsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.BitmapDeviceFlags` — enum；枚举值：4
- `Teigha.DatabaseServices.BlockBegin` — class；构造器：1
- `Teigha.DatabaseServices.BlockConnectionType` — enum；枚举值：2
- `Teigha.DatabaseServices.BlockEnd` — class；构造器：1
- `Teigha.DatabaseServices.BlockInsertionPointsEventArgs` — class；构造器：1；属性：`AlignmentVectors{get}`, `BlockTableRecord{get}`, `InsertionPoints{get}`
- `Teigha.DatabaseServices.BlockInsertionPointsEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.BlockPropertiesTable` — class；构造器：1；方法：`Audit`；属性：`Columns{get}`, `ContainsRuntimeParametersOnly{get/set}`, `DefaultActiveRowIndex{get/set}`, `IsDisabledInDrawingEditor{get}`, `MustMatch{get/set}`, `Rows{get}`
- `Teigha.DatabaseServices.BlockPropertiesTable+AuditError` — class；构造器：0；属性：`ColumnIndex{get}`, `RowIndex{get}`, `RowIndices{get}`, `Type{get}`
- `Teigha.DatabaseServices.BlockPropertiesTable+AuditErrorType` — enum；枚举值：9
- `Teigha.DatabaseServices.BlockPropertiesTableColumn` — class；构造器：0；属性：`Constant{get/set}`, `CustomProperties{get/set}`, `DefaultValue{get/set}`, `Editable{get/set}`, `Format{get/set}`, `Parameter{get}`, `Removable{get/set}`, `Table{get}`, `UnmatchedValue{get/set}`
- `Teigha.DatabaseServices.BlockPropertiesTableColumnCollection` — class；构造器：0；方法：`AddAt`, `AddItem`, `Clear`, `ContainsColumn`, `CopyTo`, `GetEnumerator`, `GetIndex`, `Move`×2, `Remove`×2；属性：`Count{get}`, `IsSynchronized{get}`, `Item{get}`, `SyncRoot{get}`
- `Teigha.DatabaseServices.BlockPropertiesTableRow` — class；构造器：0；方法：`CopyTo`, `GetEnumerator`；属性：`Count{get}`, `IsSynchronized{get}`, `Item{get/set}`, `Item{get/set}`, `SyncRoot{get}`, `Table{get}`
- `Teigha.DatabaseServices.BlockPropertiesTableRowCollection` — class；构造器：0；方法：`AddAt`, `AddItem`, `Clear`, `CopyTo`, `GetEnumerator`, `GetIndex`, `Move`×2, `Remove`×2, `Sort`；属性：`Count{get}`, `IsSynchronized{get}`, `Item{get}`, `SyncRoot{get}`
- `Teigha.DatabaseServices.BlockReference` — class；构造器：1；方法：`ConvertToStaticBlock`×2, `ExplodeToOwnerSpace`, `GeometryExtentsBestFit`×2, `ResetBlock`；属性：`AnonymousBlockTableRecord{get}`, `AttributeCollection{get}`, `BlockTableRecord{get/set}`, `BlockTransform{get/set}`, `BlockUnit{get/set}`, `DynamicBlockReferencePropertyCollection{get}`, `DynamicBlockTableRecord{get}`, `IsDynamicBlock{get}`, `Name{get}`, `Normal{get/set}`, `Position{get/set}`, `Rotation{get/set}`, `ScaleFactors{get/set}`, `TreatAsBlockRefForExplode{get}`, `UnitFactor{get}`
- `Teigha.DatabaseServices.BlockScaling` — enum；枚举值：2
- `Teigha.DatabaseServices.BlockTable` — class；构造器：0
- `Teigha.DatabaseServices.BlockTableRecord` — class；构造器：1；方法：`AppendEntity`, `AssumeOwnershipOf`, `GetAnonymousBlockIds`, `GetBlockReferenceIds`, `GetEnumerator`, `GetErasedBlockReferenceIds`, `GetXrefDatabase`, `UpdateAnonymousBlocks`；属性：`BlockBeginId{get}`, `BlockEndId{get}`, `BlockScaling{get/set}`, `Comments{get/set}`, `DrawOrderTableId{get}`, `Explodable{get/set}`, `HasAttributeDefinitions{get}`, `HasPreviewIcon{get}`, `IncludingErased{get}`, `IsAnonymous{get}`, `IsDynamicBlock{get}`, `IsFromExternalReference{get}`, `IsFromOverlayReference{get/set}`, `IsLayout{get}`, `IsUnloaded{get/set}`, `LayoutId{get/set}`, `Origin{get/set}`, `PathName{get/set}`, `PreviewIcon{get/set}`, `Units{get/set}`, `XrefStatus{get}`；事件：`BlockInsertionPoints`；字段：`ModelSpace`, `PaperSpace`
- `Teigha.DatabaseServices.BlockTableRecordEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.Body` — class；构造器：1；方法：`AcisIn`, `AcisOut`；属性：`BodyPtr{get/set}`, `IsNull{get}`, `NumChanges{get}`
- `Teigha.DatabaseServices.BooleanOperationType` — enum；枚举值：3
- `Teigha.DatabaseServices.BulgeVertex` — class；构造器：1；属性：`Bulge{get/set}`, `Vertex{get/set}`
- `Teigha.DatabaseServices.BulgeVertexCollection` — class；构造器：1；方法：`Add`, `Contains`, `CopyTo`, `IndexOf`, `Insert`, `Remove`；属性：`Item{get/set}`
- `Teigha.DatabaseServices.Cell` — class；构造器：1；方法：`GetBlockAttributeValue`, `GetDataLinkRange`, `GetExtents`, `GetMergeRange`, `GetTextString`, `GetValue`, `RemoveDataLink`, `ResetValue`, `SetBlockAttributeValue`, `SetValue`, `UpdateDataLink`；属性：`AttachmentPoint{get}`, `BlockTableRecordId{get/set}`, `CellType{get}`, `Column{get}`, `Contents{get}`, `ContentTypes{get}`, `DataLink{get/set}`, `FieldId{get/set}`, `Row{get}`, `TextString{get/set}`, `ToolTip{get/set}`, `Value{get/set}`
- `Teigha.DatabaseServices.CellAlignment` — enum；枚举值：9
- `Teigha.DatabaseServices.CellBorder` — class；构造器：0；属性：`Color{get/set}`, `DoubleLineSpacing{get/set}`, `IsVisible{get/set}`, `LineStyle{get/set}`, `Linetype{get/set}`, `LineWeight{get/set}`, `Margin{get/set}`, `Overrides{get/set}`
- `Teigha.DatabaseServices.CellBorders` — class；构造器：0；属性：`Bottom{get}`, `Horizontal{get}`, `Left{get}`, `Right{get}`, `Top{get}`, `Vertical{get}`
- `Teigha.DatabaseServices.CellClass` — enum；枚举值：3
- `Teigha.DatabaseServices.CellContent` — class；构造器：0；方法：`DeleteContent`, `GetBlockAttributeValue`, `GetTextString`, `GetValue`, `SetBlockAttributeValue`, `SetValue`；属性：`BlockTableRecordId{get/set}`, `ContentColor{get/set}`, `ContentTypes{get}`, `DataFormat{get/set}`, `DataType{get/set}`, `FieldId{get/set}`, `Formula{get/set}`, `HasFormula{get}`, `IsAutoScale{get/set}`, `Overrides{get/set}`, `Rotation{get/set}`, `Scale{get/set}`, `TextHeight{get/set}`, `TextString{get/set}`, `TextStyleId{get/set}`, `Value{get/set}`
- `Teigha.DatabaseServices.CellContentLayout` — enum；枚举值：3
- `Teigha.DatabaseServices.CellContentsCollection` — class；构造器：0；方法：`Add`, `Clear`, `GetEnumerator`, `InsertAt`, `Move`, `RemoveAt`；属性：`Count{get}`, `Item{get}`
- `Teigha.DatabaseServices.CellContentTypes` — enum；枚举值：4
- `Teigha.DatabaseServices.CellEdgeMasks` — enum；枚举值：4
- `Teigha.DatabaseServices.CellEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.CellMargins` — enum；枚举值：4
- `Teigha.DatabaseServices.CellOption` — enum；枚举值：2
- `Teigha.DatabaseServices.CellProperties` — enum；枚举值：20
- `Teigha.DatabaseServices.CellRange` — class；构造器：0；方法：`ClearStyleOverrides`, `Create`, `DeleteContent`, `Equals`, `GetCustomData`, `GetDataLink`, `GetEnumerator`, `GetHashCode`, `GetStyleOverrides`, `IEnumerableGetEnumerator`, `op_Equality`, `op_Inequality`, `SetCustomData`, `SetDataLink`；属性：`Alignment{get/set}`, `BackgroundColor{get/set}`, `Borders{get}`, `BottomRight{get}`, `BottomRightPlusOne{get}`, `BottomRow{get}`, `CanDeleteColumns{get}`, `CanDeleteRows{get}`, `CanInsertColumn{get}`, `CanInsertRow{get}`, `ContentColor{get/set}`, `ContentLayout{get/set}`, `DataFormat{get/set}`, `DataType{get/set}`, `IsBackgroundColorNone{get/set}`, `IsContentEditable{get}`, `IsEmpty{get}`, `IsFormatEditable{get}`, `IsLinked{get}`, `IsMergeAllEnabled{get/set}`, `IsMerged{get}`, `IsNull{get}`, `IsSingleCell{get}`, `Item{get}`, `LeftColumn{get}`, `Parent{get/set}`, `ParentTable{get}`, `RightColumn{get}`, `State{get/set}`, `Style{get/set}`, `TextHeight{get/set}`, `TextStyleId{get/set}`, `TopLeft{get}`, `TopRow{get}`
- `Teigha.DatabaseServices.CellReference` — struct；构造器：0；属性：`Column{get/set}`, `Row{get/set}`
- `Teigha.DatabaseServices.CellStates` — enum；枚举值：8
- `Teigha.DatabaseServices.CellType` — enum；枚举值：12
- `Teigha.DatabaseServices.Circle` — class；构造器：2；属性：`Center{get/set}`, `Circumference{get/set}`, `Diameter{get/set}`, `Normal{get/set}`, `Radius{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.ClipBoundaryType` — enum；枚举值：3
- `Teigha.DatabaseServices.CollisionType` — enum；枚举值：2
- `Teigha.DatabaseServices.Column` — class；构造器：0；属性：`MinimumWidth{get}`, `Name{get/set}`, `Width{get/set}`
- `Teigha.DatabaseServices.ColumnsCollection` — class；构造器：0；方法：`GetEnumerator`；属性：`Count{get}`, `Item{get}`
- `Teigha.DatabaseServices.ColumnType` — enum；枚举值：3
- `Teigha.DatabaseServices.CompoundObjectId` — class；构造器：5；方法：`DwgInFields`, `DwgOutFields`, `DxfInFields`, `DxfOutFields`, `Equals`, `IsValid`, `NullId`, `op_Assign`×2, `op_Equality`, `op_Inequality`, `Remap`, `Set`×3, `SetEmpty`, `SetFullPath`；属性：`FullPath{get}`, `IsEmpty{get}`, `IsExternal{get}`, `IsSimpleObjectId{get}`, `LeafId{get}`, `Path{get}`, `TopId{get}`, `Transform{get}`
- `Teigha.DatabaseServices.ConstrainType` — enum；枚举值：3
- `Teigha.DatabaseServices.ContentType` — enum；枚举值：4
- `Teigha.DatabaseServices.Curve` — abstract class；构造器：0；方法：`CreateFromGeCurve`×4, `Extend`×2, `GetClosestPointTo`×2, `GetDistanceAtParameter`, `GetDistAtPoint`, `GetFirstDerivative`×2, `GetGeCurve`×2, `GetOffsetCurves`, `GetOffsetCurvesGivenPlaneNormal`, `GetOrthoProjectedCurve`, `GetParameterAtDistance`, `GetParameterAtPoint`, `GetPointAtDist`, `GetPointAtParameter`, `GetProjectedCurve`, `GetSecondDerivative`×2, `GetSplitCurves`×2, `ReverseCurve`, `SetFromGeCurve`×4；属性：`Area{get}`, `Closed{get}`, `EndParam{get}`, `EndPoint{get/set}`, `IsPeriodic{get}`, `Spline{get}`, `StartParam{get}`, `StartPoint{get/set}`
- `Teigha.DatabaseServices.CustomScale` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Denominator{get}`, `Numerator{get}`
- `Teigha.DatabaseServices.Database` — class；构造器：2；方法：`AbortDeepClone`, `AddDBObject`, `ApplyPartialOpenFilters`, `AttachXref`, `Audit`, `AuditXData`, `BindXrefs`, `ClassDxfName`, `CloseInput`, `CountHardReferences`, `Create`, `DeepCloneObjects`, `DetachXref`, `DisablePartialOpen`, `DisableUndoRecording`, `DxfIn`, `DxfOut`×3, `ForceWblockDatabaseCopy`, `FromAcadDatabase`, `GetAllDatabases`, `GetDimensionStyleChildData`, `GetDimensionStyleChildId`, `GetDimensionStyleParentId`, `GetDimRecentStyleList`, `GetDimstyleData`, `GetHostDwgXrefGraph`, `GetNearestLineWeight`, `GetObjectId`, `GetSupportedDxfOutVersions`, `GetSupportedSaveVersions`, `GetViewports`, `GetVisualStyleList`, `Insert`×3, `IsObjectNonPersistent`, `IsValidLineWeight`, `LoadLineTypeFile`, `LoadMlineStyleFile`, `MarkObjectNonPersistent`, `OverlayXref`, `Purge`×2, `ReadDwgFile`×6, `ReadDwgFileFromMemory`, `ReclaimMemoryFromErasedObjects`, `Redo`, `ReloadXrefs`, `ResolveXrefs`, `RestoreForwardingXrefSymbols`, `RestoreOriginalXrefSymbols`, `Save`, `SaveAs`×8, `SetDimstyleData`, `SetTimeZoneAsUtcOffset`, `SetWorldPaperspaceUcsBaseOrigin`, `SetWorldUcsBaseOrigin`, `StartUndoRecord`, `TimeZoneDescription`, `TimeZoneOffset`, `TryGetObjectId`, `Undo`, `UnloadXrefs`, `UpdateExt`, `Wblock`×4, `WblockCloneObjects`, `WorldPaperspaceUcsBaseOrigin`, `WorldUcsBaseOrigin`, `XBindXrefs`；属性：`AcadDatabase{get}`, `AllowExtendedNames{get/set}`, `Angbase{get/set}`, `Angdir{get/set}`, `AnnoAllVisible{get/set}`, `AnnotativeDwg{get/set}`, `ApproxNumObjects{get}`, `Attmode{get/set}`, `Aunits{get/set}`, `Auprec{get/set}`, `BlockTableId{get}`, `ByBlockLinetype{get}`, `ByLayerLinetype{get}`, `CameraDisplay{get/set}`, `CameraHeight{get/set}`, `Cannoscale{get/set}`, `Cecolor{get/set}`, `Celtscale{get/set}`, `Celtype{get/set}`, `Celweight{get/set}`, `Cetransparency{get/set}`, `Chamfera{get/set}`, `Chamferb{get/set}`, `Chamferc{get/set}`, `Chamferd{get/set}`, `Clayer{get/set}`, `Cmaterial{get/set}`, `Cmljust{get/set}`, `Cmlscale{get/set}`, `CmlstyleID{get/set}`, `ColorDictionaryId{get}`, `ContinuousLinetype{get}`, `Cshadow{get/set}`, `CurrentSpaceId{get}`, `CurrentViewportTableRecordId{get}`, `DataLinkDictionaryId{get}`, `DataLinkManager{get}`, `DetailViewStyleDictionaryId{get}`, `DgnFrame{get/set}`, `Dimadec{get/set}`, `Dimalt{get/set}`, `Dimaltd{get/set}`, `Dimaltf{get/set}`, `Dimaltrnd{get/set}`, `Dimalttd{get/set}`, `Dimalttz{get/set}`, `Dimaltu{get/set}`, `Dimaltz{get/set}`, `Dimapost{get/set}`, `Dimarcsym{get/set}`, `Dimaso{get/set}`, `DimAssoc{get/set}`, `Dimasz{get/set}`, `Dimatfit{get/set}`, `Dimaunit{get/set}`, `Dimazin{get/set}`, `Dimblk{get/set}`, `Dimblk1{get/set}`, `Dimblk2{get/set}`, `Dimcen{get/set}`, `Dimclrd{get/set}`, `Dimclre{get/set}`, `Dimclrt{get/set}`, `Dimdec{get/set}`, `Dimdle{get/set}`, `Dimdli{get/set}`, `Dimdsep{get/set}`, `Dimexe{get/set}`, `Dimexo{get/set}`, `Dimfrac{get/set}`, `Dimfxl{get/set}`, `DimfxlenOn{get/set}`, `Dimgap{get/set}`, `Dimjogang{get/set}`, `Dimjust{get/set}`, `Dimldrblk{get/set}`, `Dimlfac{get/set}`, `Dimlim{get/set}`, `Dimltex1{get/set}`, `Dimltex2{get/set}`, `Dimltype{get/set}`, `Dimlunit{get/set}`, `Dimlwd{get/set}`, `Dimlwe{get/set}`, `Dimpost{get/set}`, `Dimrnd{get/set}`, `Dimsah{get/set}`, `Dimscale{get/set}`, `Dimsd1{get/set}`, `Dimsd2{get/set}`, `Dimse1{get/set}`, `Dimse2{get/set}`, `Dimsoxd{get/set}`, `Dimstyle{get/set}`, `DimStyleTableId{get}`, `Dimtad{get/set}`, `Dimtdec{get/set}`, `Dimtfac{get/set}`, `Dimtfill{get/set}`, `Dimtfillclr{get/set}`, `Dimtih{get/set}`, `Dimtix{get/set}`, `Dimtm{get/set}`, `Dimtmove{get/set}`, `Dimtofl{get/set}`, `Dimtoh{get/set}`, `Dimtol{get/set}`, `Dimtolj{get/set}`, `Dimtp{get/set}`, `Dimtsz{get/set}`, `Dimtvp{get/set}`, `Dimtxsty{get/set}`, `Dimtxt{get/set}`, `Dimtxtdirection{get/set}`, `Dimtzin{get/set}`, `Dimupt{get/set}`, `Dimzin{get/set}`, `DispSilh{get/set}`, `dragvs{get/set}`, `DrawOrderCtl{get/set}`, `DwfFrame{get/set}`, `Elevation{get/set}`, `EndCaps{get/set}`, `Extmax{get/set}`, `Extmin{get/set}`, `Facetres{get/set}`, `FileDependencyManager{get}`, `Filename{get}`, `Filletrad{get/set}`, `Fillmode{get/set}`, `FingerprintGuid{get/set}`, `GeoDataObject{get}`, `GroupDictionaryId{get}`, `HaloGap{get/set}`, `Handseed{get}`, `HasRedo{get}`, `HasUndo{get}`, `HideText{get/set}`, `HpInherit{get/set}`, `HpOrigin{get/set}`, `HyperlinkBase{get/set}`, `Indexctl{get/set}`, `Insbase{get/set}`, `Insunits{get/set}`, `Interferecolor{get/set}`, `Interfereobjvs{get/set}`, `Interferevpvs{get/set}`, `IntersectColor{get/set}`, `IntersectDisplay{get/set}`, `IsEmr{get}`, `Isolines{get/set}`, `IsPartiallyOpened{get}`, `JoinStyle{get/set}`, `LastSavedAsMaintenanceVersion{get}`, `LastSavedAsVersion{get}`, `Latitude{get/set}`, `LayerEval{get/set}`, `LayerFilters{get/set}`, `LayerNotify{get/set}`, `LayerStateManager{get}`, `LayerTableId{get}`, `LayerZero{get}`, `LayoutDictionaryId{get}`, `LensLength{get/set}`, `LightGlyphDisplay{get/set}`, `LightingUnits{get/set}`, `LightsInBlocks{get/set}`, `Limcheck{get/set}`, `Limmax{get/set}`, `Limmin{get/set}`, `LinetypeTableId{get}`, `LineWeightDisplay{get/set}`, `LoftAng1{get/set}`, `LoftAng2{get/set}`, `LoftMag1{get/set}`, `LoftMag2{get/set}`, `LoftNormals{get/set}`, `LoftParam{get/set}`, `Longitude{get/set}`, `Ltscale{get/set}`, `Lunits{get/set}`, `Luprec{get/set}`, `MaintenanceReleaseVersion{get}`, `MaterialDictionaryId{get}`, `Maxactvp{get/set}`, `Measurement{get/set}`, `Menu{get}`, `Mirrtext{get/set}`, `MLeaderstyle{get/set}`, `MLeaderStyleDictionaryId{get}`, `MLStyleDictionaryId{get}`, `MsLtScale{get/set}`, `MsOleScale{get/set}`, `NamedObjectsDictionaryId{get}`, `NorthDirection{get/set}`, `NumberOfSaves{get}`, `ObjectContextManager{get}`, `ObscuredColor{get/set}`, `OleStartUp{get/set}`, `OriginalFileMaintenanceVersion{get}`, `OriginalFileName{get}`, `OriginalFileSavedByMaintenanceVersion{get}`, `OriginalFileSavedByVersion{get}`, `OriginalFileVersion{get}`, `Orthomode{get/set}`, `PaperSpaceVportId{get}`, `Pdmode{get/set}`, `Pdsize{get/set}`, `Pelevation{get/set}`, `Pextmax{get/set}`, `Pextmin{get/set}`, `Pinsbase{get/set}`, `Plimcheck{get/set}`, `Plimmax{get/set}`, `Plimmin{get/set}`, `PlineEllipse{get/set}`, `Plinegen{get/set}`, `Plinewid{get/set}`, `PlotSettingsDictionaryId{get}`, `PlotStyleMode{get}`, `PlotStyleNameDictionaryId{get}`, `PlotStyleNameId{get/set}`, `ProjectName{get/set}`, `Psltscale{get/set}`, `PsolHeight{get/set}`, `PsolWidth{get/set}`, `PucsBase{get/set}`, `Pucsname{get}`, `Pucsorg{get}`, `Pucsxdir{get}`, `Pucsydir{get}`, `Qtextmode{get/set}`, `RegAppTableId{get}`, `Regenmode{get/set}`, `RetainOriginalThumbnailBitmap{get/set}`, `Saveproxygraphics{get/set}`, `SectionManagerId{get}`, `SectionViewStyleDictionaryId{get}`, `SecurityParameters{get/set}`, `Shadedge{get/set}`, `Shadedif{get/set}`, `ShadowPlaneLocation{get/set}`, `ShowHist{get/set}`, `Sketchinc{get/set}`, `Skpoly{get/set}`, `SolidHist{get/set}`, `SortEnts{get/set}`, `Splframe{get/set}`, `Splinesegs{get/set}`, `Splinetype{get/set}`, `StepSize{get/set}`, `StepsPerSec{get/set}`, `StyleSheet{get/set}`, `SummaryInfo{get/set}`, `Surftab1{get/set}`, `Surftab2{get/set}`, `Surftype{get/set}`, `Surfu{get/set}`, `Surfv{get/set}`, `Tablestyle{get/set}`, `TableStyleDictionaryId{get}`, `Tdcreate{get}`, `Tdindwg{get}`, `Tducreate{get}`, `Tdupdate{get}`, `Tdusrtimer{get}`, `Tduupdate{get}`, `Textsize{get/set}`, `Textstyle{get/set}`, `TextStyleTableId{get}`, `Thickness{get/set}`, `ThumbnailBitmap{get/set}`, `TileMode{get/set}`, `TileModeLightSynch{get/set}`, `TimeZone{get/set}`, `Tracewid{get/set}`, `TransactionManager{get}`, `Treedepth{get/set}`, `TStackAlign{get/set}`, `TstackSize{get/set}`, `UcsBase{get/set}`, `Ucsname{get}`, `Ucsorg{get}`, `UcsOrthographic{get}`, `UcsTableId{get}`, `Ucsxdir{get}`, `Ucsydir{get}`, `UndoRecording{get}`, `Unitmode{get/set}`, `UpdateThumbnail{get/set}`, `Useri1{get/set}`, `Useri2{get/set}`, `Useri3{get/set}`, `Useri4{get/set}`, `Useri5{get/set}`, `Userr1{get/set}`, `Userr2{get/set}`, `Userr3{get/set}`, `Userr4{get/set}`, `Userr5{get/set}`, `Usrtimer{get/set}`, `VersionGuid{get/set}`, `ViewportScaleDefault{get/set}`, `ViewportTableId{get}`, `ViewTableId{get}`, `Visretain{get/set}`, `VisualStyleDictionaryId{get}`, `Worldview{get/set}`, `XclipFrame{get/set}`, `XrefBlockId{get}`, `XrefEditEnabled{get/set}`；事件：`AbortDxfIn`, `AbortDxfOut`, `AbortSave`, `BeginDeepClone`, `BeginDeepCloneTranslation`, `BeginDxfIn`, `BeginDxfOut`, `BeginInsert`, `BeginSave`, `BeginWblockBlock`, `BeginWblockEntireDatabase`, `BeginWblockObjects`, `BeginWblockSelectedObjects`, `DatabaseConstructed`, `DatabaseToBeDestroyed`, `DeepCloneAborted`, `DeepCloneEnded`, `Disposed`, `DwgFileOpened`, `DxfInComplete`, `DxfOutComplete`, `InitialDwgFileOpenComplete`, `InsertAborted`, `InsertEnded`, `InsertMappingAvailable`, `ObjectAppended`, `ObjectErased`, `ObjectModified`, `ObjectOpenedForModify`, `ObjectReappended`, `ObjectUnappended`, `PartialOpenNotice`, `ProxyResurrectionCompleted`, `SaveComplete`, `SystemVariableChanged`, `SystemVariableWillChange`, `WblockAborted`, `WblockEnded`, `WblockMappingAvailable`, `WblockNotice`, `XrefAttachAborted`, `XrefAttachEnded`, `XrefBeginAttached`, `XrefBeginOtherAttached`, `XrefBeginRestore`, `XrefComandeered`, `XrefPreXrefLockFile`, `XrefRedirected`, `XrefRestoreAborted`, `XrefRestoreEnded`, `XrefSubCommandAborted`, `XrefSubCommandEnd`, `XrefSubCommandStart`
- `Teigha.DatabaseServices.DatabaseIOEventArgs` — class；构造器：0；属性：`FileName{get}`
- `Teigha.DatabaseServices.DatabaseIOEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.DatabaseSummaryInfo` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Author{get}`, `Comments{get}`, `CustomProperties{get}`, `HyperlinkBase{get}`, `Keywords{get}`, `LastSavedBy{get}`, `RevisionNumber{get}`, `Subject{get}`, `Title{get}`
- `Teigha.DatabaseServices.DatabaseSummaryInfoBuilder` — class；构造器：2；方法：`ToDatabaseSummaryInfo`；属性：`Author{get/set}`, `Comments{get/set}`, `CustomProperties{get}`, `CustomPropertyTable{get}`, `HyperlinkBase{get/set}`, `Keywords{get/set}`, `LastSavedBy{get/set}`, `RevisionNumber{get/set}`, `Subject{get/set}`, `Title{get/set}`
- `Teigha.DatabaseServices.DataCell` — class；构造器：1；方法：`Init`, `SetBool`, `SetDouble`, `SetHardOwnershipId`, `SetHardPointerId`, `SetInteger`, `SetObjectId`, `SetPoint`, `SetSoftOwnershipId`, `SetSoftPointerId`, `SetString`, `SetVector`；属性：`CellType{get}`, `Value{get}`
- `Teigha.DatabaseServices.DataCellCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.DataColumn` — class；构造器：3；方法：`AppendCell`, `Assign`, `GetCellAt`, `GetIndexAtCell`, `InsertCellAt`, `RemoveCellAt`, `SetCellAt`；属性：`ColumnName{get/set}`, `ColumnType{get/set}`, `GrowLength{get/set}`, `NumCells{get}`, `PhysicalLength{get/set}`
- `Teigha.DatabaseServices.DataLink` — class；构造器：1；方法：`GetSourceFiles`, `GetTargets`, `GetUpdateStatus`, `RepathSourceFiles`, `Update`；属性：`ConnectionString{get/set}`, `DataAdapterId{get/set}`, `DataLinkOption{get/set}`, `Description{get/set}`, `IsValid{get}`, `Name{get/set}`, `ToolTip{get/set}`, `UpdateOption{get/set}`
- `Teigha.DatabaseServices.DataLinkGetSourceContext` — enum；枚举值：6
- `Teigha.DatabaseServices.DataLinkManager` — class；构造器：0；方法：`AddDataLink`, `GetDataLink`×2, `RemoveDataLink`×2, `Update`×2；属性：`DataLinkCount{get}`
- `Teigha.DatabaseServices.DataLinkOption` — enum；枚举值：4
- `Teigha.DatabaseServices.DataTable` — class；构造器：1；方法：`AppendColumn`, `AppendRow`, `Assign`, `GetCellAt`, `GetColumnAt`, `GetColumnIndexAtName`, `GetColumnNameAt`, `GetColumnTypeAt`, `GetRowAt`, `InsertColumnAt`, `InsertRowAt`, `RemoveColumnAt`, `RemoveRowAt`, `SetCellAt`, `SetRowAt`；属性：`NumColsGrowSize{get/set}`, `NumColsPhysicalSize{get/set}`, `NumColumns{get}`, `NumRows{get}`, `NumRowsGrowSize{get/set}`, `NumRowsPhysicalSize{get/set}`, `TableName{get/set}`
- `Teigha.DatabaseServices.DataType` — enum；枚举值：11
- `Teigha.DatabaseServices.DataTypeParameter` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`；属性：`DataType{get/set}`, `UnitType{get/set}`
- `Teigha.DatabaseServices.DBDictionary` — class；构造器：1；方法：`Contains`×2, `CopyTo`, `GetAt`, `GetEnumerator`, `NameAt`, `Remove`×2, `SetAt`, `SetName`；属性：`Count{get}`, `IncludingErased{get}`, `Item{get/set}`, `MergeStyle{get/set}`, `TreatElementsAsHard{get/set}`
- `Teigha.DatabaseServices.DBDictionaryEntry` — struct；构造器：1；方法：`op_Explicit`×2, `ToString`×2；属性：`Key{get/set}`, `Value{get/set}`；字段：`m_key`, `m_value`
- `Teigha.DatabaseServices.DbDictionaryEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `Entry{get}`, `Key{get}`, `Value{get}`
- `Teigha.DatabaseServices.DbHomeView` — class；构造器：1；方法：`Clone`, `Equals`, `op_Equality`, `op_Inequality`, `ToggleDefaultSettings`
- `Teigha.DatabaseServices.DBObject` — abstract class；构造器：0；方法：`AddContext`, `AddPersistentReactor`, `ApplyPartialUndo`, `Audit`, `Cancel`, `Close`, `CloseAndPage`, `CreateExtensionDictionary`, `DecomposeForSave`, `DeepClone`, `DisableUndoRecording`, `DowngradeOpen`, `DowngradeToNotify`, `DwgIn`, `DwgOut`, `DxfIn`, `DxfOut`, `Erase`×2, `FromAcadObject`, `GetEventExtender`, `GetField`×2, `GetObjectSaveVersion`×2, `GetPersistentReactorIds`, `GetReactors`, `GetTransientReactors`, `GetXDataForApplication`, `HandOverTo`, `HasContext`, `HasPersistentReactor`, `IsCustomObject`, `ReleaseExtensionDictionary`, `RemoveContext`, `RemoveField`×3, `RemovePersistentReactor`, `ResetScaleDependentProperties`, `SetField`×2, `SetFromStyle`, `SetObjectIdsInFlux`, `SetPaperOrientation`, `SupportsCollection`, `SwapIdWith`, `SwapReferences`, `UpgradeFromNotify`, `UpgradeOpen`, `WblockClone`, `XDataTransformBy`；属性：`AcadObject{get}`, `Annotative{get/set}`, `ClassID{get}`, `Database{get}`, `Drawable{get}`, `ExtensionDictionary{get}`, `Handle{get}`, `HasFields{get}`, `HasSaveVersionOverride{get/set}`, `Id{get}`, `IsAProxy{get}`, `IsCancelling{get}`, `IsErased{get}`, `IsEraseStatusToggled{get}`, `IsModified{get}`, `IsModifiedGraphics{get}`, `IsModifiedXData{get}`, `IsNewObject{get}`, `IsNotifyEnabled{get}`, `IsNotifying{get}`, `IsObjectIdsInFlux{get}`, `IsPersistent{get}`, `IsReadEnabled{get}`, `IsReallyClosing{get}`, `IsTransactionResident{get}`, `IsUndoing{get}`, `IsWriteEnabled{get}`, `MergeStyle{get/set}`, `ObjectBirthVersion{get}`, `ObjectId{get}`, `OwnerId{get}`, `PaperOrientation{get}`, `UndoFiler{get}`, `XData{get/set}`；事件：`Cancelled`, `Copied`, `Erased`, `Goodbye`, `Modified`, `ModifiedXData`, `ModifyUndone`, `ObjectClosed`, `OpenedForModify`, `Reappended`, `SubObjectModified`, `Unappended`
- `Teigha.DatabaseServices.DBObjectCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.DBObjectReference` — struct；构造器：1；属性：`Kind{get}`, `ObjectId{get}`
- `Teigha.DatabaseServices.DBObjectReferenceCollection` — class；构造器：0；方法：`Add`, `Contains`, `CopyTo`, `IndexOf`, `Insert`, `Remove`；属性：`Item{get/set}`
- `Teigha.DatabaseServices.DBPoint` — class；构造器：2；属性：`EcsRotation{get/set}`, `Normal{get/set}`, `Position{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.DBText` — class；构造器：1；方法：`AdjustAlignment`, `ConvertFieldToText`, `CorrectSpelling`, `getTextWithFieldCodes`；属性：`AlignmentPoint{get/set}`, `Height{get/set}`, `HorizontalMode{get/set}`, `IsDefaultAlignment{get}`, `IsMirroredInX{get/set}`, `IsMirroredInY{get/set}`, `Justify{get/set}`, `Normal{get/set}`, `Oblique{get/set}`, `Position{get/set}`, `Rotation{get/set}`, `TextString{get/set}`, `TextStyleId{get/set}`, `TextStyleName{get}`, `Thickness{get/set}`, `VerticalMode{get/set}`, `WidthFactor{get/set}`
- `Teigha.DatabaseServices.DBVisualStyle` — class；构造器：1；方法：`CopyFrom`, `CopyTo`, `GetTrait`, `GetTraitFlag`, `SetTrait`×6, `SetTraitFlag`；属性：`Description{get/set}`, `InternalUseOnly{get/set}`, `Name{get}`, `Type{get/set}`
- `Teigha.DatabaseServices.DecomposeForSaveReplacementRecord` — struct；构造器：2；属性：`ExchangeXData{get}`, `ReplacementId{get}`, `ReplacementObject{get}`
- `Teigha.DatabaseServices.DeepCloneType` — enum；枚举值：11
- `Teigha.DatabaseServices.DefaultLightingType` — enum；枚举值：2
- `Teigha.DatabaseServices.DgnDefinition` — class；构造器：1；属性：`SetShowRasterRef{set}`, `ShowRasterRef{get}`, `UseMasterUnits{get/set}`, `XrefDepth{get/set}`
- `Teigha.DatabaseServices.DgnReference` — class；构造器：1
- `Teigha.DatabaseServices.DgnUnderlayItem` — class；构造器：0；属性：`SetShowRasterRef{set}`, `ShowRasterRef{get}`, `UseMasterUnits{get/set}`
- `Teigha.DatabaseServices.DiametricDimension` — class；构造器：2；属性：`ChordPoint{get/set}`, `FarChordPoint{get/set}`, `LeaderLength{get/set}`
- `Teigha.DatabaseServices.DictionaryWithDefaultDictionary` — class；构造器：1；属性：`DefaultId{get/set}`
- `Teigha.DatabaseServices.DimArrowFlag` — enum；枚举值：2
- `Teigha.DatabaseServices.DimAssoc` — class；构造器：1；方法：`AddToDimensionReactor`×2, `AddToPointRefReactor`, `Copied`, `Erased`×2, `GetDimAssocGeomIds`, `IsAllGeomErased`, `ModifiedGraphics`, `OpenedForModify`, `PointRef`, `Post`×2, `RemoveAssociativity`×2, `RemovePointRef`×2, `SetPointRef`, `UpdateDimension`×3；属性：`AssocFlag{get}`, `DimObjId{get/set}`, `RotatedType{get/set}`, `TransSpatial{get/set}`
- `Teigha.DatabaseServices.DimAssocPointType` — enum；枚举值：17
- `Teigha.DatabaseServices.Dimension` — abstract class；构造器：0；方法：`FieldFromMText`, `FieldToMText`, `FormatMeasurement`, `GenerateLayout`, `GetDimstyleData`, `RecomputeDimensionBlock`, `RemoveTextField`, `SetDimstyleData`；属性：`AlternatePrefix{get/set}`, `AlternateSuffix{get/set}`, `AltSuppressLeadingZeros{get/set}`, `AltSuppressTrailingZeros{get/set}`, `AltSuppressZeroFeet{get/set}`, `AltSuppressZeroInches{get/set}`, `AltToleranceSuppressLeadingZeros{get/set}`, `AltToleranceSuppressTrailingZeros{get/set}`, `AltToleranceSuppressZeroFeet{get/set}`, `AltToleranceSuppressZeroInches{get/set}`, `CenterMarkSize{get}`, `CenterMarkType{get}`, `CurrentMeasurement{get}`, `Dimadec{get/set}`, `Dimalt{get/set}`, `Dimaltd{get/set}`, `Dimaltf{get/set}`, `Dimaltrnd{get/set}`, `Dimalttd{get/set}`, `Dimalttz{get/set}`, `Dimaltu{get/set}`, `Dimaltz{get/set}`, `Dimapost{get/set}`, `Dimarcsym{get/set}`, `Dimasz{get/set}`, `Dimatfit{get/set}`, `Dimaunit{get/set}`, `Dimazin{get/set}`, `Dimblk{get/set}`, `Dimblk1{get/set}`, `Dimblk1s{get/set}`, `Dimblk2{get/set}`, `Dimblk2s{get/set}`, `Dimblks{get/set}`, `DimBlockId{get/set}`, `DimBlockPosition{get}`, `Dimcen{get/set}`, `Dimclrd{get/set}`, `Dimclre{get/set}`, `Dimclrt{get/set}`, `Dimdec{get/set}`, `Dimdle{get/set}`, `Dimdli{get/set}`, `Dimdsep{get/set}`, `DimensionStyle{get/set}`, `DimensionStyleName{get/set}`, `DimensionText{get/set}`, `Dimexe{get/set}`, `Dimexo{get/set}`, `Dimfrac{get/set}`, `Dimfxlen{get/set}`, `DimfxlenOn{get/set}`, `Dimgap{get/set}`, `Dimjogang{get/set}`, `Dimjust{get/set}`, `Dimldrblk{get/set}`, `Dimldrblks{get/set}`, `Dimlfac{get/set}`, `Dimlim{get/set}`, `Dimltex1{get/set}`, `Dimltex2{get/set}`, `Dimltype{get/set}`, `Dimlunit{get/set}`, `Dimlwd{get/set}`, `Dimlwe{get/set}`, `Dimpost{get/set}`, `Dimrnd{get/set}`, `Dimsah{get/set}`, `Dimscale{get/set}`, `Dimsd1{get/set}`, `Dimsd2{get/set}`, `Dimse1{get/set}`, `Dimse2{get/set}`, `Dimsoxd{get/set}`, `Dimtad{get/set}`, `Dimtdec{get/set}`, `Dimtfac{get/set}`, `Dimtfill{get/set}`, `Dimtfillclr{get/set}`, `Dimtih{get/set}`, `Dimtix{get/set}`, `Dimtm{get/set}`, `Dimtmove{get/set}`, `Dimtofl{get/set}`, `Dimtoh{get/set}`, `Dimtol{get/set}`, `Dimtolj{get/set}`, `Dimtp{get/set}`, `Dimtsz{get/set}`, `Dimtvp{get/set}`, `Dimtxt{get/set}`, `Dimtzin{get/set}`, `Dimupt{get/set}`, `Dimzin{get/set}`, `DynamicDimension{get/set}`, `Elevation{get/set}`, `HorizontalRotation{get/set}`, `Measurement{get}`, `Normal{get/set}`, `Prefix{get/set}`, `Suffix{get/set}`, `SuppressAngularLeadingZeros{get/set}`, `SuppressAngularTrailingZeros{get/set}`, `SuppressLeadingZeros{get/set}`, `SuppressTrailingZeros{get/set}`, `SuppressZeroFeet{get/set}`, `SuppressZeroInches{get/set}`, `TextAttachment{get/set}`, `TextLineSpacingFactor{get/set}`, `TextLineSpacingStyle{get/set}`, `TextPosition{get/set}`, `TextRotation{get/set}`, `TextStyleId{get/set}`, `ToleranceSuppressLeadingZeros{get/set}`, `ToleranceSuppressTrailingZeros{get/set}`, `ToleranceSuppressZeroFeet{get/set}`, `ToleranceSuppressZeroInches{get/set}`, `UsingDefaultTextPosition{get/set}`
- `Teigha.DatabaseServices.DimensionCenterMarkType` — enum；枚举值：3
- `Teigha.DatabaseServices.DimStyleTable` — class；构造器：0
- `Teigha.DatabaseServices.DimStyleTableRecord` — class；构造器：1；方法：`GetArrowId`；属性：`Dimadec{get/set}`, `Dimalt{get/set}`, `Dimaltd{get/set}`, `Dimaltf{get/set}`, `Dimaltrnd{get/set}`, `Dimalttd{get/set}`, `Dimalttz{get/set}`, `Dimaltu{get/set}`, `Dimaltz{get/set}`, `Dimapost{get/set}`, `Dimarcsym{get/set}`, `Dimasz{get/set}`, `Dimatfit{get/set}`, `Dimaunit{get/set}`, `Dimazin{get/set}`, `Dimblk{get/set}`, `Dimblk1{get/set}`, `Dimblk1s{get/set}`, `Dimblk2{get/set}`, `Dimblk2s{get/set}`, `Dimblks{get/set}`, `Dimcen{get/set}`, `Dimclrd{get/set}`, `Dimclre{get/set}`, `Dimclrt{get/set}`, `Dimdec{get/set}`, `Dimdle{get/set}`, `Dimdli{get/set}`, `Dimdsep{get/set}`, `Dimexe{get/set}`, `Dimexo{get/set}`, `Dimfrac{get/set}`, `Dimfxlen{get/set}`, `DimfxlenOn{get/set}`, `Dimgap{get/set}`, `Dimjogang{get/set}`, `Dimjust{get/set}`, `Dimldrblk{get/set}`, `Dimldrblks{get/set}`, `Dimlfac{get/set}`, `Dimlim{get/set}`, `Dimltex1{get/set}`, `Dimltex2{get/set}`, `Dimltype{get/set}`, `Dimlunit{get/set}`, `Dimlwd{get/set}`, `Dimlwe{get/set}`, `Dimpost{get/set}`, `Dimrnd{get/set}`, `Dimsah{get/set}`, `Dimscale{get/set}`, `Dimsd1{get/set}`, `Dimsd2{get/set}`, `Dimse1{get/set}`, `Dimse2{get/set}`, `Dimsoxd{get/set}`, `Dimtad{get/set}`, `Dimtdec{get/set}`, `Dimtfac{get/set}`, `Dimtfill{get/set}`, `Dimtfillclr{get/set}`, `Dimtih{get/set}`, `Dimtix{get/set}`, `Dimtm{get/set}`, `Dimtmove{get/set}`, `Dimtofl{get/set}`, `Dimtoh{get/set}`, `Dimtol{get/set}`, `Dimtolj{get/set}`, `Dimtp{get/set}`, `Dimtsz{get/set}`, `Dimtvp{get/set}`, `Dimtxsty{get/set}`, `Dimtxt{get/set}`, `Dimtzin{get/set}`, `Dimupt{get/set}`, `Dimzin{get/set}`, `IsModifiedForRecompute{get}`
- `Teigha.DatabaseServices.DragStatus` — enum；枚举值：3
- `Teigha.DatabaseServices.DrawLeaderOrderType` — enum；枚举值：2
- `Teigha.DatabaseServices.DrawMLeaderOrderType` — enum；枚举值：2
- `Teigha.DatabaseServices.DrawOrderTable` — class；构造器：0；方法：`FirstEntityIsDrawnBeforeSecond`, `GetFullDrawOrder`, `GetRelativeDrawOrder`, `GetSortHandle`, `MoveAbove`, `MoveBelow`, `MoveToBottom`, `MoveToTop`, `SetRelativeDrawOrder`, `SwapOrder`；属性：`BlockId{get/set}`
- `Teigha.DatabaseServices.DuplicateRecordCloning` — enum；枚举值：6
- `Teigha.DatabaseServices.DwfDefinition` — class；构造器：1；属性：`isDWFx{get}`
- `Teigha.DatabaseServices.DwfReference` — class；构造器：1
- `Teigha.DatabaseServices.DwgFiler` — abstract class；构造器：0；方法：`ReadAddress`, `ReadBinaryChunk`, `ReadBoolean`, `ReadByte`, `ReadBytes`, `ReadDouble`, `ReadHandle`, `ReadHardOwnershipId`, `ReadHardPointerId`, `ReadInt16`, `ReadInt32`, `ReadInt64`, `ReadPoint2d`, `ReadPoint3d`, `ReadScale3d`, `ReadSoftOwnershipId`, `ReadSoftPointerId`, `ReadString`, `ReadUInt16`, `ReadUInt32`, `ReadUInt64`, `ReadVector2d`, `ReadVector3d`, `ResetFilerStatus`, `Seek`, `WriteAddress`, `WriteBinaryChunk`, `WriteBoolean`, `WriteByte`, `WriteBytes`, `WriteDouble`, `WriteHandle`, `WriteHardOwnershipId`, `WriteHardPointerId`, `WriteInt16`, `WriteInt32`, `WriteInt64`, `WritePoint2d`, `WritePoint3d`, `WriteScale3d`, `WriteSoftOwnershipId`, `WriteSoftPointerId`, `WriteString`, `WriteUInt16`, `WriteUInt32`, `WriteUInt64`, `WriteVector2d`, `WriteVector3d`；属性：`Database{get}`, `DwgVersion{get}`, `FilerStatus{get/set}`, `FilerType{get}`, `Position{get}`
- `Teigha.DatabaseServices.DwgVersion` — enum；枚举值：52
- `Teigha.DatabaseServices.DxfCode` — enum；枚举值：148
- `Teigha.DatabaseServices.DxfFiler` — abstract class；构造器：0；方法：`AtSubclassData`, `HaltAtClassBoundaries`, `PushBackItem`, `ReadAngle`, `ReadBoolean`, `ReadByte`, `ReadBytes`, `ReadDouble`, `ReadHandle`, `ReadInt16`, `ReadInt32`, `ReadInt64`, `ReadObjectId`, `ReadPoint2d`, `ReadPoint3d`, `ReadResultBuffer`, `ReadScale3d`, `ReadString`, `ReadUInt16`, `ReadUInt32`, `ReadUInt64`, `ReadVector2d`, `ReadVector3d`, `ResetFilerStatus`, `RewindFiler`, `Seek`, `SetError`×2, `WriteAngle`, `WriteBoolean`, `WriteByte`, `WriteBytes`, `WriteDouble`, `WriteEmbeddedObjectStart`, `WriteHandle`, `WriteInt16`, `WriteInt32`, `WriteInt64`, `WriteName`, `WriteObjectId`, `WritePoint2d`, `WritePoint3d`, `WriteResultBuffer`, `WriteScale3d`, `WriteString`, `WriteUInt16`, `WriteUInt32`, `WriteUInt64`, `WriteVector2d`, `WriteVector3d`, `WriteXDataStart`；属性：`AtEmbeddedObjectStart{get}`, `AtEndOfFile{get}`, `AtEndOfObject{get}`, `AtExtendedData{get}`, `Database{get}`, `DwgVersion{get}`, `Elevation{get}`, `ErrorMessage{get}`, `FilerStatus{get/set}`, `FilerType{get}`, `IncludesDefaultValues{get}`, `IsModifyingExistingObject{get}`, `Position{get}`, `Precision{get/set}`, `Thickness{get}`
- `Teigha.DatabaseServices.DynamicBlockReferenceProperty` — class；构造器：0；方法：`GetAllowedValues`；属性：`BlockId{get}`, `Description{get}`, `PropertyName{get}`, `PropertyTypeCode{get}`, `ReadOnly{get}`, `Show{get}`, `UnitsType{get}`, `Value{get/set}`, `VisibleInCurrentVisibilityState{get}`
- `Teigha.DatabaseServices.DynamicBlockReferencePropertyCollection` — class；构造器：0；方法：`CopyTo`, `GetEnumerator`；属性：`Count{get}`, `Item{get}`
- `Teigha.DatabaseServices.DynamicBlockReferencePropertyCollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.DynamicBlockReferencePropertyUnitsType` — enum；枚举值：4
- `Teigha.DatabaseServices.DynamicDimensionChangedEventArgs` — class；构造器：1；属性：`Index{get}`, `Value{get}`
- `Teigha.DatabaseServices.DynamicDimensionData` — class；构造器：4；方法：`Create`；属性：`ApplicationData{get/set}`, `Dimension{get/set}`, `Editable{get/set}`, `Focal{get/set}`, `HideIfValueIsZero{get/set}`, `Visible{get/set}`
- `Teigha.DatabaseServices.DynamicDimensionDataCollection` — class；构造器：1；方法：`Add`, `Clear`, `CopyTo`, `GetEnumerator`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.Ellipse` — class；构造器：2；方法：`GetAngleAtParameter`, `GetParameterAtAngle`, `Set`；属性：`Center{get/set}`, `EndAngle{get/set}`, `EndParam{get/set}`, `IsNull{get}`, `MajorAxis{get}`, `MajorRadius{get}`, `MinorAxis{get}`, `MinorRadius{get}`, `Normal{get}`, `RadiusRatio{get/set}`, `StartAngle{get/set}`, `StartParam{get/set}`
- `Teigha.DatabaseServices.EndCap` — enum；枚举值：4
- `Teigha.DatabaseServices.Entity` — abstract class；构造器：0；方法：`AddSubentityPaths`, `BoundingBoxIntersectWith`×4, `DeleteSubentityPaths`, `Draw`, `Explode`, `ExplodeGeometry`, `ExplodeGeometryToBlock`×2, `ExplodeGeometryToOwnerSpace`, `GetGraphicsMarkersAtSubentityPathIntPtr`, `GetGripPoints`×2, `GetGripPointsAtSubentityPath`, `GetObjectSnapPoints`×2, `GetPlane`, `GetStretchPoints`, `GetSubentity`, `GetSubentityGeometricExtents`, `GetSubentityPathsAtGraphicsMarker`×2, `GetTransformedCopy`, `Highlight`×2, `IntersectWith`×4, `IsContentSnappable`, `JoinEntities`, `JoinEntity`, `List`, `MoveGripPointsAt`×2, `MoveGripPointsAtSubentityPaths`, `MoveStretchPointsAt`, `RecordGraphicsModified`, `SaveAs`, `SetDatabaseDefaults`×2, `SetDragStatus`, `SetGripStatus`, `SetLayerId`, `SetPropertiesFrom`, `SetSubentityGripStatus`, `TransformBy`, `TransformSubentityPathsBy`, `Unhighlight`×2；属性：`BlockId{get}`, `BlockName{get}`, `CastShadows{get/set}`, `CloneMeForDragging{get}`, `CollisionType{get}`, `Color{get/set}`, `ColorIndex{get/set}`, `CompoundObjectTransform{get}`, `Ecs{get}`, `EdgeStyleId{get/set}`, `EntityColor{get}`, `FaceStyleId{get/set}`, `ForceAnnoAllVisible{get/set}`, `GeometricExtents{get}`, `Hyperlinks{get}`, `IsPlanar{get}`, `Layer{get/set}`, `LayerId{get/set}`, `Linetype{get/set}`, `LinetypeId{get/set}`, `LinetypeScale{get/set}`, `LineWeight{get/set}`, `Material{get/set}`, `MaterialId{get/set}`, `MaterialMapper{get/set}`, `PlotStyleName{get/set}`, `PlotStyleNameId{get/set}`, `ReceiveShadows{get/set}`, `Transparency{get/set}`, `Visible{get/set}`, `VisualStyleId{get/set}`
- `Teigha.DatabaseServices.EntityVisualStyleType` — enum；枚举值：3
- `Teigha.DatabaseServices.EraseFlags` — enum；枚举值：3
- `Teigha.DatabaseServices.EvalFields` — enum；枚举值：2
- `Teigha.DatabaseServices.ExposureType` — enum；枚举值：2
- `Teigha.DatabaseServices.Extents2d` — struct；构造器：2；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×3；属性：`MaxPoint{get}`, `MinPoint{get}`
- `Teigha.DatabaseServices.Extents3d` — struct；构造器：1；方法：`AddBlockExtents`, `AddExtents`, `AddPoint`, `Equals`, `ExpandBy`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `Set`, `ToString`×3, `TransformBy`；属性：`MaxPoint{get}`, `MinPoint{get}`
- `Teigha.DatabaseServices.ExtrudedSurface` — class；构造器：1；方法：`CreateExtrudedSurface`, `SetExtrude`；属性：`Height{get/set}`, `SweepEntity{get}`, `SweepOptions{get/set}`, `SweepVec{get/set}`, `TaperAngle{get/set}`
- `Teigha.DatabaseServices.Face` — class；构造器：3；方法：`GetVertexAt`, `IsEdgeVisibleAt`, `MakeEdgeInvisibleAt`, `MakeEdgeVisibleAt`, `SetVertexAt`
- `Teigha.DatabaseServices.FaceRecord` — class；构造器：2；方法：`GetVertexAt`, `IsEdgeVisibleAt`, `MakeEdgeInvisibleAt`, `MakeEdgeVisibleAt`, `SetVertexAt`
- `Teigha.DatabaseServices.FeatureControlFrame` — class；构造器：2；方法：`GetBoundingPoints`, `GetBoundingPolyline`, `GetDimstyleData`, `SetDimstyleData`, `SetOrientation`；属性：`Dimclrd{get/set}`, `Dimclrt{get/set}`, `DimensionStyle{get/set}`, `DimensionStyleName{get/set}`, `Dimgap{get/set}`, `Dimscale{get/set}`, `Dimtxsty{get/set}`, `Dimtxt{get/set}`, `Direction{get}`, `Location{get/set}`, `Normal{get}`, `Text{get/set}`, `TextStyleId{get/set}`, `TextStyleName{get/set}`
- `Teigha.DatabaseServices.Field` — class；构造器：3；方法：`ConvertToTextField`, `Evaluate`×2, `GetChildren`, `GetData`, `GetFieldCode`×2, `GetFieldCodeWithChildren`×2, `GetStringValue`, `SetData`×2, `SetFieldCode`, `SetFieldCodeWithChildren`×2；属性：`DataType{get}`, `EvaluationOption{get/set}`, `EvaluationStatus{get}`, `EvaluatorId{get/set}`, `FilingOption{get/set}`, `Format{get/set}`, `HyperLink{get/set}`, `IsTextField{get}`, `State{get}`, `Value{get}`
- `Teigha.DatabaseServices.FieldCodeFlags` — enum；枚举值：9
- `Teigha.DatabaseServices.FieldCodeWithChildren` — class；构造器：0；方法：`Add`；属性：`Children{get}`, `FieldCode{get/set}`
- `Teigha.DatabaseServices.FieldEngine` — class；构造器：0；方法：`EvaluateFields`, `FindEvaluator`, `GetEvaluator`, `GetEvaluatorLoader`, `RegisterEvaluatorLoader`, `UnregisterEvaluatorLoader`；属性：`EvaluatorLoaderCount{get}`, `Global{get}`
- `Teigha.DatabaseServices.FieldEvaluationContext` — enum；枚举值：7
- `Teigha.DatabaseServices.FieldEvaluationOptions` — enum；枚举值：8
- `Teigha.DatabaseServices.FieldEvaluationResult` — struct；构造器：0；属性：`Evaluated{get}`, `Found{get}`
- `Teigha.DatabaseServices.FieldEvaluationStatus` — enum；枚举值：7
- `Teigha.DatabaseServices.FieldEvaluationStatusResult` — struct；构造器：1；属性：`ErrorCode{get}`, `ErrorMessage{get}`, `Status{get}`
- `Teigha.DatabaseServices.FieldEvaluator` — abstract class；构造器：1；方法：`Compile`, `Evaluate`, `EvaluatorId`×2, `Format`, `Initialize`
- `Teigha.DatabaseServices.FieldEvaluatorLoader` — abstract class；构造器：1；方法：`FindEvaluator`, `GetEvaluator`
- `Teigha.DatabaseServices.FieldFilingOptions` — enum；枚举值：1
- `Teigha.DatabaseServices.FieldResult` — abstract class；构造器：0；方法：`setEvaluationStatus`, `SetFieldValue`
- `Teigha.DatabaseServices.FieldResultImp` — class；构造器：1；方法：`GetImpObj`, `setEvaluationStatus`, `SetFieldValue`
- `Teigha.DatabaseServices.FieldState` — enum；枚举值：6
- `Teigha.DatabaseServices.FieldUpdateResult` — struct；构造器：0；字段：`NumEvaluated`, `NumFound`
- `Teigha.DatabaseServices.FileDependencyInfo` — struct；构造器：0；方法：`ToString`×2；属性：`Feature{get}`, `FileName{get}`, `FileSize{get}`, `FingerprintGuid{get}`, `FoundPath{get}`, `FullFileName{get}`, `Index{get}`, `IsAffectsGraphics{get}`, `IsModified{get}`, `ReferenceCount{get}`, `TimeStamp{get}`, `VersionGuid{get}`
- `Teigha.DatabaseServices.FileDependencyManager` — class；构造器：0；方法：`CreateEntry`, `EraseEntry`×2, `GetEntry`×4, `IteratorInitialize`, `UpdateEntry`×2；属性：`CountEntries{get}`, `IteratorNext{get}`
- `Teigha.DatabaseServices.FileOpenMode` — enum；枚举值：4
- `Teigha.DatabaseServices.FilerType` — enum；枚举值：10
- `Teigha.DatabaseServices.FillStyle` — enum；枚举值：11
- `Teigha.DatabaseServices.FindFileHint` — enum；枚举值：11
- `Teigha.DatabaseServices.FitData` — struct；构造器：0；方法：`Equals`, `GetFitPoints`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`；属性：`Degree{get}`, `EndTangent{get}`, `FitTolerance{get}`, `KnotParam{get}`, `StartTangent{get}`, `TangentsExist{get}`
- `Teigha.DatabaseServices.FlowDirection` — enum；枚举值：6
- `Teigha.DatabaseServices.FormatOption` — enum；枚举值：5
- `Teigha.DatabaseServices.FormattedTableData` — class；构造器：1；方法：`GetAlignment`, `GetBackgroundColor`, `GetContentColor`, `GetGridColor`, `GetGridLinetype`, `GetGridLineWeight`, `GetGridVisibility`, `GetMargin`, `GetMergeRange`, `GetOverride`×2, `GetRotation`, `GetScale`, `GetTextHeight`, `GetTextStyle`, `IsFormatEditable`, `IsMerged`, `Merge`, `RemoveAllOverrides`, `SetAlignment`, `SetBackgroundColor`, `SetContentColor`, `SetGridColor`, `SetGridLinetype`, `SetGridLineWeight`, `SetGridVisibility`, `SetMargin`, `SetOverride`×2, `SetRotation`, `SetScale`, `SetTextHeight`, `SetTextStyle`, `Unmerge`
- `Teigha.DatabaseServices.FrameSetting` — enum；枚举值：5
- `Teigha.DatabaseServices.FullDwgVersion` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`；属性：`MajorVersion{get}`, `MinorVersion{get}`
- `Teigha.DatabaseServices.FullSubentityPath` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `GetObjectIds`, `op_Equality`, `op_Inequality`；属性：`IsNull{get}`, `Null{get}`, `SubentId{get}`
- `Teigha.DatabaseServices.GeoCoordinateCategory` — class；构造器：0；方法：`CreateAll`, `GetCoordinateAt`, `NumOfCoordinate`；属性：`ID{get}`
- `Teigha.DatabaseServices.GeoCoordinateSystem` — class；构造器：0；方法：`Create`, `CreateAll`×3, `GetProjectionParamList`；属性：`CartesianExtents{get}`, `Datum{get}`, `Description{get}`, `Ellipsoid{get}`, `EPSGcode{get}`, `GeodeticExtents{get}`, `GeoUnit{get}`, `ID{get}`, `Offset{get}`, `ProjectionCode{get}`, `Type{get}`, `Unit{get}`, `UnitScale{get}`, `WktRepresentation{get}`, `XmlRepresentation{get}`
- `Teigha.DatabaseServices.GeoCoordinateTransformer` — class；构造器：0；方法：`Create`, `TransformPoint`×2, `TransformPoints`×2；属性：`SourceCSid{get}`, `TargetCSid{get}`
- `Teigha.DatabaseServices.GeoCSProjectionCode` — enum；枚举值：73
- `Teigha.DatabaseServices.GeoCSType` — enum；枚举值：4
- `Teigha.DatabaseServices.GeoCSUnit` — enum；枚举值：62
- `Teigha.DatabaseServices.GeoDatum` — struct；构造器：0；字段：`Desc`, `Id`
- `Teigha.DatabaseServices.GeoEllipsoid` — struct；构造器：0；字段：`Desc`, `Eccentricity`, `Id`, `PolarRadius`
- `Teigha.DatabaseServices.GeoLocationData` — class；构造器：1；方法：`AddMeshPointMap`, `EraseFromDb`, `GetMeshPointMap`, `GetMeshPointMaps`, `PostToDb`, `ResetMeshPointMaps`, `SetMeshPointMaps`, `TransformFromLonLatAlt`, `TransformToLonLatAlt`×2；属性：`BlockTableRecordId{get/set}`, `CoordinateProjectionRadius{get/set}`, `CoordinateSystem{get/set}`, `DesignPoint{get/set}`, `DoSeaLevelCorrection{get/set}`, `GeoRSSTag{get/set}`, `HorizontalUnits{get/set}`, `HorizontalUnitsScale{get/set}`, `NorthDirection{get}`, `NorthDirectionVector{get/set}`, `NumMeshPoints{get}`, `ReferencePoint{get/set}`, `ScaleEstimationMethod{get/set}`, `ScaleFactor{get/set}`, `SeaLevelElevation{get/set}`, `TypeOfCoordinates{get/set}`, `UpDirection{get/set}`, `VerticalUnits{get/set}`, `VerticalUnitsScale{get/set}`
- `Teigha.DatabaseServices.GeometryOverrule` — abstract class；构造器：0；方法：`GetGeomExtents`, `IntersectWith`×2, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`
- `Teigha.DatabaseServices.GeoPositionMarker` — class；构造器：2；属性：`EnableFrameText{get/set}`, `GeoPosition{get/set}`, `LandingGap{get/set}`, `MText{get/set}`, `MTextVisible{get/set}`, `Normal{get}`, `Notes{get/set}`, `Position{get/set}`, `Radius{get/set}`, `Text{get/set}`, `TextAlignmentType{get/set}`, `TextStyle{get}`
- `Teigha.DatabaseServices.GeoProjectionParam` — struct；构造器：0；字段：`Name`, `Value`
- `Teigha.DatabaseServices.GetGripPointsFlags` — enum；枚举值：3
- `Teigha.DatabaseServices.GlyphDisplayType` — enum；枚举值：3
- `Teigha.DatabaseServices.GradientBackground` — class；构造器：1；属性：`ColorBottom{get/set}`, `ColorMiddle{get/set}`, `ColorTop{get/set}`, `Height{get/set}`, `Horizon{get/set}`, `Rotation{get/set}`
- `Teigha.DatabaseServices.GradientColor` — struct；构造器：1；方法：`get_Color`, `get_Value`
- `Teigha.DatabaseServices.GradientPatternType` — enum；枚举值：2
- `Teigha.DatabaseServices.Graph` — class；构造器：1；方法：`AddEdge`, `AddNode`, `BreakCycleEdge`, `ClearAll`, `Create`, `DelNode`, `FindCycles`, `GetOutgoing`, `Node`, `Reset`, `SetNodeGrowthRate`；属性：`IsEmpty{get}`, `NumNodes{get}`, `RootNode{get}`
- `Teigha.DatabaseServices.GraphicsMetafileType` — enum；枚举值：3
- `Teigha.DatabaseServices.GraphNode` — class；构造器：1；方法：`AddRefTo`, `Clear`, `CycleIn`, `CycleOut`, `DisconnectAll`, `In`, `IsMarkedAs`, `MarkAs`, `MarkTree`, `Out`, `RemoveRefTo`, `SetEdgeGrowthRate`；属性：`Data{get/set}`, `IsCycleNode{get}`, `NextCycleNode{get}`, `NumCycleIn{get}`, `NumCycleOut{get}`, `NumIn{get}`, `NumOut{get}`, `Owner{get}`
- `Teigha.DatabaseServices.GraphNodeCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.GridLineStyle` — enum；枚举值：2
- `Teigha.DatabaseServices.GridLineType` — enum；枚举值：12
- `Teigha.DatabaseServices.GridProperties` — enum；枚举值：7
- `Teigha.DatabaseServices.GridPropertyParameter` — struct；构造器：0；字段：`Color`, `DoubleLineSpacing`, `LineStyle`, `Linetype`, `LineWeight`, `PropertyMask`, `Visibility`
- `Teigha.DatabaseServices.GripData` — class；构造器：1；方法：`CallHotGrip`, `CallHoverGrip`, `CallRightClick`, `CallTooltip`, `CallViewportDraw`, `CallWorldDraw`, `ChangeGripStatus`, `GetHotGripDimensionData`, `GetHoverDimensionData`, `GetTooltip`, `OnGripStatusChanged`, `OnHotGrip`, `OnHover`, `OnRightClick`, `ViewportDraw`, `WorldDraw`；属性：`AlternateBasePoint{get/set}`, `AppData{get}`, `DrawAtDragImageGripPoint{get/set}`, `ForcedPickOn{get/set}`, `GizmosEnabled{get/set}`, `GripPoint{get/set}`, `HotGripInvokesRightClick{get/set}`, `IsPerViewport{get/set}`, `ModeKeywordsDisabled{get/set}`, `RubberBandLineDisabled{get/set}`, `SkipWhenShared{get/set}`, `TriggerGrip{get/set}`
- `Teigha.DatabaseServices.GripData+Context` — enum；枚举值：2
- `Teigha.DatabaseServices.GripData+DrawType` — enum；枚举值：4
- `Teigha.DatabaseServices.GripData+ReturnValue` — enum；枚举值：5
- `Teigha.DatabaseServices.GripData+Status` — enum；枚举值：10
- `Teigha.DatabaseServices.GripDataCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `Remove`；属性：`Count{get}`, `IsReadOnly{get}`, `Item{get}`
- `Teigha.DatabaseServices.GripOverrule` — abstract class；构造器：0；方法：`GetGripPoints`×2, `GetStretchPoints`, `MoveGripPointsAt`×2, `MoveStretchPointsAt`, `OnGripStatusChanged`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`
- `Teigha.DatabaseServices.GripStatus` — enum；枚举值：3
- `Teigha.DatabaseServices.GroundPlaneBackground` — class；构造器：1；属性：`ColorGroundPlaneFar{get/set}`, `ColorGroundPlaneNear{get/set}`, `ColorSkyHorizon{get/set}`, `ColorSkyZenith{get/set}`, `ColorUndergroundAzimuth{get/set}`, `ColorUndergroundHorizon{get/set}`
- `Teigha.DatabaseServices.Group` — class；构造器：2；方法：`Append`×2, `Clear`, `GetAllEntityIds`, `GetIndex`, `Has`, `InsertAt`×2, `Prepend`×2, `Remove`×2, `RemoveAt`×2, `Replace`, `Reverse`, `SetAnonymous`, `SetColor`, `SetColorIndex`, `SetHighlight`, `SetLayer`×2, `SetLinetype`×2, `SetLinetypeScale`, `SetVisibility`, `Transfer`；属性：`Description{get/set}`, `IsAnonymous{get}`, `IsNotAccessible{get}`, `Name{get/set}`, `NumEntities{get}`, `Selectable{get/set}`
- `Teigha.DatabaseServices.GsMarkType` — enum；枚举值：8
- `Teigha.DatabaseServices.Handle` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`IsOne{get}`, `Value{get}`
- `Teigha.DatabaseServices.Hatch` — class；构造器：1；方法：`AppendLoop`×4, `EvaluateGradientColorAt`, `EvaluateHatch`, `GetAssociatedObjectIds`, `GetAssociatedObjectIdsAt`, `GetGradientColors`, `GetHatchLineDataAt`, `GetHatchLinesData`, `GetLoopAt`, `GetPatternDefinitionAt`, `InsertLoopAt`×2, `LoopTypeAt`, `RemoveAssociatedObjectIds`, `RemoveLoopAt`, `SetGradient`, `SetGradientColors`, `SetHatchPattern`；属性：`Area{get}`, `Associative{get/set}`, `BackgroundColor{get/set}`, `Elevation{get/set}`, `GradientAngle{get/set}`, `GradientName{get}`, `GradientOneColorMode{get/set}`, `GradientShift{get/set}`, `GradientType{get}`, `HatchObjectType{get/set}`, `HatchStyle{get/set}`, `IsGradient{get}`, `IsHatch{get}`, `IsSolidFill{get}`, `Normal{get/set}`, `NumberOfHatchLines{get}`, `NumberOfLoops{get}`, `NumberOfPatternDefinitions{get}`, `Origin{get/set}`, `PatternAngle{get/set}`, `PatternDouble{get/set}`, `PatternName{get}`, `PatternScale{get/set}`, `PatternSpace{get/set}`, `PatternType{get}`, `ShadeTintValue{get/set}`
- `Teigha.DatabaseServices.HatchEdgeType` — enum；枚举值：4
- `Teigha.DatabaseServices.HatchLoop` — class；构造器：1；属性：`Curves{get}`, `IsPolyline{get}`, `LoopType{get}`, `Polyline{get}`
- `Teigha.DatabaseServices.HatchLoopTypes` — enum；枚举值：10
- `Teigha.DatabaseServices.HatchObjectType` — enum；枚举值：2
- `Teigha.DatabaseServices.HatchPatternType` — enum；枚举值：3
- `Teigha.DatabaseServices.HatchStyle` — enum；枚举值：3
- `Teigha.DatabaseServices.Helix` — class；构造器：1；方法：`CreateHelix`, `GetAxisPoint`, `SetAxisPoint`；属性：`AxisVector{get/set}`, `BaseRadius{get/set}`, `Constrain{get/set}`, `Height{get/set}`, `StartPoint{get/set}`, `TopRadius{get/set}`, `TotalLength{get}`, `TurnHeight{get/set}`, `Turns{get/set}`, `TurnSlope{get}`, `Twist{get/set}`
- `Teigha.DatabaseServices.HighlightOverrule` — abstract class；构造器：0；方法：`Highlight`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`, `Unhighlight`
- `Teigha.DatabaseServices.HostApplicationServices` — abstract class；构造器：0；方法：`BitmapDevice`, `FindFile`, `FindFileEx`, `GetPassword`×2, `GetRemoteFile`, `GetSystemFontFolders`, `GetUrl`, `IsUrl`, `LoadApplication`, `NewProgressMeter`, `PutRemoteFile`, `recoverFile`, `RegisterTrueTypeFonts`×2, `TtfFileNameByDescriptor`, `UserBreak`；属性：`AlternateFontName{get}`, `CompanyName{get}`, `Current{get/set}`, `FontMapFileName{get}`, `GRIPCOLOR{get/set}`, `GRIPHOT{get/set}`, `GRIPHOVER{get/set}`, `GRIPOBJLIMIT{get/set}`, `GRIPSIZE{get/set}`, `LocalRootFolder{get}`, `MachineRegistryProductRootKey{get}`, `ModelerFlavor{get}`, `Product{get}`, `Program{get}`, `RegistryProductRootKey{get}`, `ReleaseMajorVersion{get}`, `ReleaseMinorVersion{get}`, `RoamableRootFolder{get}`, `TEXTFILL{get/set}`, `UserRegistryProductRootKey{get}`, `VersionString{get}`, `WorkingDatabase{get/set}`
- `Teigha.DatabaseServices.HyperLink` — class；构造器：1；方法：`Equals`, `GetHashCode`；属性：`Description{get/set}`, `DisplayString{get}`, `IsOutermostContainer{get}`, `Name{get/set}`, `NestedLevel{get}`, `SubLocation{get/set}`
- `Teigha.DatabaseServices.HyperLinkCollection` — class；构造器：0；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.IdMapping` — class；构造器：1；方法：`Add`, `Change`, `Contains`, `Delete`, `GetEnumerator`, `Lookup`；属性：`DeepCloneContext{get}`, `DestinationDatabase{get/set}`, `DuplicateRecordCloning{get}`, `Item{get/set}`, `OriginalDatabase{get}`
- `Teigha.DatabaseServices.IdMappingEventArgs` — class；构造器：0；属性：`IdMapping{get}`
- `Teigha.DatabaseServices.IdMappingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.IdPair` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`IsCloned{get}`, `IsOwnerTranslated{get}`, `IsPrimary{get}`, `Key{get}`, `Value{get}`
- `Teigha.DatabaseServices.Image` — class；构造器：0
- `Teigha.DatabaseServices.ImageBackground` — class；构造器：1；属性：`FitToScreen{get/set}`, `ImageFileName{get/set}`, `MaintainAspectRatio{get/set}`, `Offset{get/set}`, `Scale{get/set}`, `UseTiling{get/set}`
- `Teigha.DatabaseServices.ImageDisplayOptions` — enum；枚举值：4
- `Teigha.DatabaseServices.ImageOrg` — enum；枚举值：9
- `Teigha.DatabaseServices.ImageQuality` — enum；枚举值：3
- `Teigha.DatabaseServices.IndexCreation` — enum；枚举值：3
- `Teigha.DatabaseServices.Intersect` — enum；枚举值：4
- `Teigha.DatabaseServices.IParameter` — interface；构造器：0；方法：`IsNameUnique`；属性：`Angular{get}`, `DataType{get}`, `Description{get/set}`, `Expression{get/set}`, `Name{get/set}`, `ParameterObject{get/set}`, `ReadOnly{get}`, `Value{get/set}`
- `Teigha.DatabaseServices.ISubObject` — interface；构造器：0；属性：`Parent{get/set}`
- `Teigha.DatabaseServices.JoinStyle` — enum；枚举值：4
- `Teigha.DatabaseServices.LampColorPreset` — enum；枚举值：15
- `Teigha.DatabaseServices.LampColorType` — enum；枚举值：2
- `Teigha.DatabaseServices.LayerEvaluation` — enum；枚举值：3
- `Teigha.DatabaseServices.LayerStateDeletedEventArgs` — class；构造器：0；属性：`Name{get}`
- `Teigha.DatabaseServices.LayerStateDeletedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.LayerStateEventArgs` — class；构造器：0；属性：`Id{get}`, `Name{get}`
- `Teigha.DatabaseServices.LayerStateEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.LayerStateManager` — class；构造器：1；方法：`CompareLayerStateToDb`, `DeleteLayerState`, `ExportLayerState`, `GetLayerStateDescription`, `GetLayerStateLayers`, `GetLayerStateMask`, `GetLayerStateNames`, `HasLayerState`, `ImportLayerState`, `ImportLayerStateFromDb`, `LayerStateHasViewportData`, `LayerStatesDictionaryId`, `RenameLayerState`, `RestoreLayerState`, `SaveLayerState`, `SetLayerStateDescription`, `SetLayerStateMask`；属性：`LastRestoredLayerState{get}`；事件：`AbortLayerStateDelete`, `AbortLayerStateRename`, `AbortLayerStateRestore`, `LayerStateCompareFailed`, `LayerStateCreated`, `LayerStateDeleted`, `LayerStateRenamed`, `LayerStateRestored`, `LayerStateToBeDeleted`, `LayerStateToBeRenamed`, `LayerStateToBeRestored`；字段：`m_pAbortLayerStateDelete`, `m_pAbortLayerStateRename`, `m_pAbortLayerStateRestore`, `m_pLayerStateCompareFailed`, `m_pLayerStateCreated`, `m_pLayerStateDeleted`, `m_pLayerStateRenamed`, `m_pLayerStateRestored`, `m_pLayerStateToBeDeleted`, `m_pLayerStateToBeRenamed`, `m_pLayerStateToBeRestored`
- `Teigha.DatabaseServices.LayerStateMasks` — enum；枚举值：13
- `Teigha.DatabaseServices.LayerStateRenameEventArgs` — class；构造器：0；属性：`Name{get}`, `NewName{get}`
- `Teigha.DatabaseServices.LayerStateRenameEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.LayerTable` — class；构造器：0；方法：`GenerateUsageData`, `GetEnumerator`；属性：`IncludingHidden{get}`, `SkippingReconciled{get}`
- `Teigha.DatabaseServices.LayerTableRecord` — class；构造器：1；方法：`GetViewportOverrides`, `HasViewportOverrides`, `RemoveAllOverrides`；属性：`Color{get/set}`, `Description{get/set}`, `EntityColor{get}`, `HasOverrides{get}`, `IsFrozen{get/set}`, `IsHidden{get/set}`, `IsLocked{get/set}`, `IsOff{get/set}`, `IsPlottable{get/set}`, `IsReconciled{get/set}`, `IsUsed{get}`, `LinetypeObjectId{get/set}`, `LineWeight{get/set}`, `MaterialId{get/set}`, `PlotStyleName{get/set}`, `PlotStyleNameId{get/set}`, `Transparency{get/set}`, `ViewportVisibilityDefault{get/set}`
- `Teigha.DatabaseServices.LayerViewportProperties` — class；构造器：0；方法：`RemoveOverrides`；属性：`Color{get/set}`, `IsColorOverridden{get/set}`, `IsLinetypeOverridden{get/set}`, `IsLineWeightOverridden{get/set}`, `IsPlotStyleOverridden{get/set}`, `LinetypeObjectId{get/set}`, `LineWeight{get/set}`, `PlotStyleName{get/set}`, `PlotStyleNameId{get/set}`
- `Teigha.DatabaseServices.Layout` — class；构造器：1；方法：`AddToLayoutDictionary`, `GetViewports`, `Initialize`；属性：`AnnoAllVisible{get/set}`, `BlockTableRecordId{get/set}`, `CurrentViewportId{get}`, `Extents{get}`, `LayoutName{get/set}`, `Limits{get}`, `TabOrder{get/set}`, `TabSelected{get/set}`, `Thumbnail{get/set}`
- `Teigha.DatabaseServices.LayoutCopiedEventArgs` — class；构造器：0；属性：`Id{get}`, `Name{get}`, `NewId{get}`, `NewName{get}`
- `Teigha.DatabaseServices.LayoutCopiedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.LayoutEventArgs` — class；构造器：0；属性：`Id{get}`, `Name{get}`
- `Teigha.DatabaseServices.LayoutEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.LayoutManager` — class；构造器：0；方法：`CloneLayout`, `CopyLayout`, `CreateLayout`, `DeleteLayout`, `GetLayoutId`, `GetNonRectangularViewportIdFromClipId`, `RenameLayout`；属性：`Current{get}`, `CurrentLayout{get/set}`, `LayoutCount{get}`；事件：`AbortLayoutCopied`, `AbortLayoutRemoved`, `AbortLayoutRename`, `LayoutCopied`, `LayoutCreated`, `LayoutRemoved`, `LayoutRenamed`, `LayoutsReordered`, `LayoutSwitched`, `LayoutToBeCopied`, `LayoutToBeRemoved`, `LayoutToBeRenamed`, `PlotStyleTableChanged`；字段：`m_pAbortLayoutCopied`, `m_pAbortLayoutRemoved`, `m_pAbortLayoutRename`, `m_pLayoutCopied`, `m_pLayoutCreated`, `m_pLayoutRemoved`, `m_pLayoutRenamed`, `m_pLayoutsReordered`, `m_pLayoutSwitched`, `m_pLayoutToBeCopied`, `m_pLayoutToBeRemoved`, `m_pLayoutToBeRenamed`, `m_pPlotStyleTableChanged`
- `Teigha.DatabaseServices.LayoutPaperPE` — abstract class；构造器：0；方法：`DrawBorder`, `DrawMargins`, `DrawPaper`, `GetClass`
- `Teigha.DatabaseServices.LayoutRenamedEventArgs` — class；构造器：0；属性：`Id{get}`, `Name{get}`, `NewName{get}`
- `Teigha.DatabaseServices.LayoutRenamedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.Leader` — class；构造器：1；方法：`AppendVertex`, `EvaluateLeader`, `GetDimstyleData`, `RemoveLastVertex`, `SetDimstyleData`, `SetPlane`, `SetVertexAt`, `VertexAt`；属性：`AnnoHeight{get}`, `Annotation{get/set}`, `AnnotationOffset{get/set}`, `AnnoType{get}`, `AnnoWidth{get}`, `Dimasz{get/set}`, `Dimclrd{get/set}`, `DimensionStyle{get/set}`, `DimensionStyleName{get/set}`, `Dimgap{get/set}`, `Dimldrblk{get/set}`, `Dimlwd{get/set}`, `Dimsah{get/set}`, `Dimscale{get/set}`, `Dimtad{get/set}`, `Dimtxsty{get/set}`, `Dimtxt{get/set}`, `FirstVertex{get}`, `HasArrowHead{get/set}`, `HasHookLine{get}`, `IsSplined{get/set}`, `LastVertex{get}`, `Normal{get}`, `NumVertices{get}`, `TextStyleId{get/set}`
- `Teigha.DatabaseServices.LeaderDirectionType` — enum；枚举值：5
- `Teigha.DatabaseServices.LeaderType` — enum；枚举值：3
- `Teigha.DatabaseServices.Light` — class；构造器：1；方法：`ResultingColor`, `SetHotspotAndFalloff`；属性：`Attenuation{get/set}`, `AttenuationType{get/set}`, `Direction{get/set}`, `EndLimitOffset{get/set}`, `FalloffAngle{get}`, `GlyphDisplayType{get/set}`, `HasTarget{get/set}`, `HotspotAngle{get}`, `IlluminanceDistance{get/set}`, `Intensity{get/set}`, `IsOn{get/set}`, `IsPlottable{get/set}`, `LampColorPreset{get/set}`, `LampColorRGB{get/set}`, `LampColorTemp{get/set}`, `LampColorType{get/set}`, `LightColor{get/set}`, `LightType{get/set}`, `MapSize{get/set}`, `Name{get/set}`, `PhysicalIntensity{get/set}`, `PhysicalIntensityMethod{get/set}`, `Position{get/set}`, `Shadow{get/set}`, `ShadowType{get/set}`, `Softness{get/set}`, `StartLimitOffset{get/set}`, `TargetLocation{get/set}`, `UseLimits{get/set}`, `WebFile{get/set}`, `WebRotation{get/set}`
- `Teigha.DatabaseServices.LightingUnits` — enum；枚举值：3
- `Teigha.DatabaseServices.Line` — class；构造器：2；属性：`Angle{get}`, `Delta{get}`, `EndPoint{get/set}`, `Length{get}`, `Normal{get/set}`, `StartPoint{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.LineAngularDimension2` — class；构造器：2；属性：`ArcPoint{get/set}`, `XLine1End{get/set}`, `XLine1Start{get/set}`, `XLine2End{get/set}`, `XLine2Start{get/set}`
- `Teigha.DatabaseServices.LineEndStyle` — enum；枚举值：5
- `Teigha.DatabaseServices.LineJoinStyle` — enum；枚举值：5
- `Teigha.DatabaseServices.LineSpacingStyle` — enum；枚举值：2
- `Teigha.DatabaseServices.LineType` — enum；枚举值：33
- `Teigha.DatabaseServices.LinetypeTable` — class；构造器：0
- `Teigha.DatabaseServices.LinetypeTableRecord` — class；构造器：1；方法：`DashLengthAt`, `SetDashLengthAt`, `SetShapeIsUcsOrientedAt`, `SetShapeNumberAt`, `SetShapeOffsetAt`, `SetShapeRotationAt`, `SetShapeScaleAt`, `SetShapeStyleAt`, `SetTextAt`, `ShapeIsUcsOrientedAt`, `ShapeNumberAt`, `ShapeOffsetAt`, `ShapeRotationAt`, `ShapeScaleAt`, `ShapeStyleAt`, `TextAt`；属性：`AsciiDescription{get/set}`, `Comments{get/set}`, `IsScaledToFit{get/set}`, `NumDashes{get/set}`, `PatternLength{get/set}`
- `Teigha.DatabaseServices.LineWeight` — enum；枚举值：27
- `Teigha.DatabaseServices.LineWeightConverter` — class；构造器：1；方法：`CanConvertFrom`, `ConvertFrom`, `ConvertTo`
- `Teigha.DatabaseServices.LinkedData` — abstract class；构造器：0；方法：`Clear`；属性：`IsEmpty{get}`, `Name{get/set}`
- `Teigha.DatabaseServices.LinkedTableData` — class；构造器：1；方法：`AppendColumn`, `AppendRow`, `DataType`, `DeleteColumn`, `DeleteContent`, `DeleteRow`, `GetBlockAttributeValue`, `GetBlockTableRecordId`, `GetCellState`, `GetColumnName`, `GetContentTypes`, `GetCustomData`, `GetDataFormat`, `GetDataLink`×3, `GetEnumerator`×2, `GetFieldId`, `GetToolTip`, `GetValue`×2, `InsertColumn`, `InsertRow`, `IsContentEditable`, `IsLinked`, `SetBlockAttributeValue`, `SetBlockTableRecordId`, `SetCellState`, `SetColumnName`, `SetCustomData`, `SetDataFormat`, `SetDataLink`×2, `SetDataType`, `SetFieldId`, `SetSize`, `SetToolTip`, `SetValue`×2, `UnitType`, `UpdateDataLink`×2；属性：`NumberOfColumns{get}`, `NumberOfRows{get}`
- `Teigha.DatabaseServices.LinkedTableEnumerator` — class；构造器：1；方法：`MoveNext`, `Reset`
- `Teigha.DatabaseServices.LoftedSurface` — class；构造器：1；方法：`CreateLoftedSurface`；属性：`Closed{get/set}`, `CrossSections{get}`, `GuideCurves{get}`, `LoftOptions{get/set}`, `NumberOfCrossSections{get}`, `PathEntity{get}`
- `Teigha.DatabaseServices.LoftOptions` — class；构造器：2；方法：`CheckCrossSectionCurves`, `CheckGuideCurves`, `CheckLoftCurves`, `CheckPathCurve`, `Clone`；属性：`AlignDirection{get}`, `ArcLengthParam{get}`, `Closed{get}`, `DraftEnd{get}`, `DraftEndMag{get}`, `DraftStart{get}`, `DraftStartMag{get}`, `NormalOption{get}`, `NoTwist{get}`, `Ruled{get}`, `Simplify{get}`, `VirtualGuide{get}`
- `Teigha.DatabaseServices.LoftOptionsBuilder` — class；构造器：2；方法：`SetOptionsFromSysvars`, `ToLoftOptions`；属性：`AlignDirection{get/set}`, `ArcLengthParam{get/set}`, `Closed{get/set}`, `DraftEnd{get/set}`, `DraftEndMag{get/set}`, `DraftStart{get/set}`, `DraftStartMag{get/set}`, `NormalOption{get/set}`, `NoTwist{get/set}`, `Ruled{get/set}`, `Simplify{get/set}`, `VirtualGuide{get/set}`
- `Teigha.DatabaseServices.LoftOptionsCheckCurvesOut` — class；构造器：1；属性：`AllClosed{get}`, `AllOpen{get}`, `AllPlanar{get}`
- `Teigha.DatabaseServices.LoftOptionsNormalOption` — enum；枚举值：6
- `Teigha.DatabaseServices.MaintenanceReleaseVersion` — enum；枚举值：53
- `Teigha.DatabaseServices.MatchProperties` — class；构造器：0；方法：`CopyProperties`
- `Teigha.DatabaseServices.Material` — class；构造器：1；属性：`Ambient{get/set}`, `Anonymous{get/set}`, `Bump{get/set}`, `ChannelFlags{get/set}`, `ColorBleedScale{get/set}`, `Description{get/set}`, `Diffuse{get/set}`, `FinalGather{get/set}`, `GlobalIllumination{get/set}`, `IlluminationModel{get/set}`, `IndirectBumpScale{get/set}`, `Luminance{get/set}`, `LuminanceMode{get/set}`, `Mode{get/set}`, `Name{get/set}`, `NormalMap{get/set}`, `Opacity{get/set}`, `ReflectanceScale{get/set}`, `Reflection{get/set}`, `Reflectivity{get/set}`, `Refraction{get/set}`, `SelfIllumination{get/set}`, `Specular{get/set}`, `Translucence{get/set}`, `TransmittanceScale{get/set}`, `TwoSided{get/set}`
- `Teigha.DatabaseServices.MeasurementValue` — enum；枚举值：2
- `Teigha.DatabaseServices.MentalRayRenderSettings` — class；构造器：1；属性：`DiagnosticBSPMode{get/set}`, `DiagnosticGridMode{get/set}`, `DiagnosticMode{get/set}`, `DiagnosticPhotonMode{get/set}`, `EnergyMultiplier{get/set}`, `ExportMIEnabled{get/set}`, `ExportMIFileName{get/set}`, `FGRayCount{get/set}`, `FGSampleRadius{get/set}`, `FGSampleRadiusState{get/set}`, `FinalGatheringEnabled{get/set}`, `FinalGatheringMode{get/set}`, `GIPhotonsPerLight{get/set}`, `GISampleCount{get/set}`, `GISampleRadius{get/set}`, `GISampleRadiusEnabled{get/set}`, `GlobalIlluminationEnabled{get/set}`, `LightLuminanceScale{get/set}`, `MemoryLimit{get/set}`, `PhotonTraceDepth{get/set}`, `RayTraceDepth{get/set}`, `RayTracingEnabled{get/set}`, `Sampling{get/set}`, `SamplingContrastColor{get/set}`, `SamplingFilter{get/set}`, `ShadowMapsEnabled{get/set}`, `ShadowMode{get/set}`, `ShadowSamplingMultiplier{get/set}`, `TileOrder{get/set}`, `TileSize{get/set}`
- `Teigha.DatabaseServices.MergeCellStyleOption` — enum；枚举值：5
- `Teigha.DatabaseServices.MeshDataCollection` — struct；构造器：1；属性：`ColorArray{get/set}`, `FaceArray{get/set}`, `MaterialIdArray{get/set}`, `VertexArray{get/set}`
- `Teigha.DatabaseServices.MeshFaceterData` — struct；构造器：1；属性：`FaceterDevNormal{get/set}`, `FaceterDevSurface{get/set}`, `FaceterGridRatio{get/set}`, `FaceterMaxEdgeLength{get/set}`, `FaceterMaxGrid{get/set}`, `FaceterMeshType{get/set}`, `FaceterMinUGrid{get/set}`, `FaceterMinVGrid{get/set}`
- `Teigha.DatabaseServices.MeshPointMap` — struct；构造器：1；属性：`DestPoint{get/set}`, `SourcePoint{get/set}`
- `Teigha.DatabaseServices.MeshPointMaps` — struct；构造器：1；属性：`DestPonints{get/set}`, `SourcePonints{get/set}`
- `Teigha.DatabaseServices.MInsertBlock` — class；构造器：2；属性：`Columns{get/set}`, `ColumnSpacing{get/set}`, `Rows{get/set}`, `RowSpacing{get/set}`
- `Teigha.DatabaseServices.MLeader` — class；构造器：1；方法：`AddFirstVertex`, `AddLastVertex`, `AddLeader`, `AddLeaderLine`×2, `ConnectionPoint`×2, `GetArrowSize`, `GetArrowSymbolId`, `GetBlockAttribute`, `GetContentGeomExtents`, `getContextDataManager`, `GetDogleg`, `GetDoglegLength`, `GetFirstVertex`, `GetLastVertex`, `GetLeaderIndex`, `GetLeaderIndexes`, `GetLeaderLineColor`, `GetLeaderLineIndexes`, `GetLeaderLineType`, `GetLeaderLineTypeId`, `GetLeaderLineWeight`, `getOverridedMLeaderStyle`, `GetPlane`, `GetTextAttachmentType`, `GetVertex`, `HasContent`, `MoveMLeader`, `PostMLeaderToDb`, `recomputeBreakPoints`, `RemoveFirstVertex`, `RemoveLastVertex`, `RemoveLeader`, `RemoveLeaderLine`, `SetArrowSize`, `SetArrowSymbolId`, `SetBlockAttribute`, `SetContextDataManager`, `SetDogleg`, `SetDoglegLength`, `SetFirstVertex`, `SetLastVertex`, `SetLeaderLineColor`, `SetLeaderLineType`, `SetLeaderLineTypeId`, `SetLeaderLineWeight`, `SetPlane`, `SetTextAttachmentType`, `SetVertex`, `VerticesCount`；属性：`ArrowSize{get/set}`, `ArrowSymbolId{get/set}`, `BlockColor{get/set}`, `BlockConnectionType{get/set}`, `BlockContentId{get/set}`, `BlockPosition{get/set}`, `BlockRotation{get/set}`, `BlockScale{get/set}`, `ContentType{get/set}`, `DoglegLength{get/set}`, `EnableAnnotationScale{get/set}`, `EnableDogleg{get/set}`, `EnableFrameText{get/set}`, `EnableLanding{get/set}`, `ExtendLeaderToText{get/set}`, `LandingGap{get/set}`, `LeaderCount{get}`, `LeaderLineColor{get/set}`, `LeaderLineCount{get}`, `LeaderLineType{get/set}`, `LeaderLineTypeId{get/set}`, `LeaderLineWeight{get/set}`, `MLeaderStyle{get/set}`, `MText{get/set}`, `Normal{get}`, `Scale{get/set}`, `TextAlignmentType{get/set}`, `TextAngleType{get/set}`, `TextAttachmentDirection{get/set}`, `TextAttachmentType{get/set}`, `TextColor{get/set}`, `TextHeight{get/set}`, `TextLocation{get/set}`, `TextStyleId{get/set}`, `ToleranceLocation{get/set}`
- `Teigha.DatabaseServices.MLeaderStyle` — class；构造器：2；方法：`GetTextAttachmentType`, `OverwritePropChanged`, `PostMLeaderStyleToDb`, `SetTextAttachmentType`；属性：`Annotative{get/set}`, `ArrowSize{get/set}`, `ArrowSymbolId{get/set}`, `BlockColor{get/set}`, `BlockConnectionType{get/set}`, `BlockId{get/set}`, `BlockRotation{get/set}`, `BlockScale{get/set}`, `BreakSize{get/set}`, `ContentType{get/set}`, `DefaultMText{get/set}`, `DoglegLength{get/set}`, `DrawLeaderOrderType{get/set}`, `DrawMLeaderOrderType{get/set}`, `EnableBlockRotation{get/set}`, `EnableBlockScale{get/set}`, `EnableDogleg{get/set}`, `EnableFrameText{get/set}`, `EnableLanding{get/set}`, `FirstSegmentAngleConstraint{get/set}`, `LandingGap{get/set}`, `LeaderLineColor{get/set}`, `LeaderLineType{get/set}`, `LeaderLineTypeId{get/set}`, `LeaderLineWeight{get/set}`, `MaxLeaderSegmentsPoints{get/set}`, `Name{get/set}`, `Scale{get/set}`, `SecondSegmentAngleConstraint{get/set}`, `TextAlignAlwaysLeft{get/set}`, `TextAlignmentType{get/set}`, `TextAngleType{get/set}`, `TextAttachmentDirection{get/set}`, `TextAttachmentType{get/set}`, `TextColor{get/set}`, `TextHeight{get/set}`, `TextStyleId{get/set}`
- `Teigha.DatabaseServices.Mline` — class；构造器：1；方法：`AppendSegment`, `Element`, `GetClosestPointTo`×2, `MoveVertexAt`, `RemoveLastSegment`, `VertexAt`；属性：`IsClosed{get/set}`, `Justification{get/set}`, `Normal{get/set}`, `NumberOfVertices{get}`, `Scale{get/set}`, `Style{get/set}`, `SupressEndCaps{get/set}`, `SupressStartCaps{get/set}`
- `Teigha.DatabaseServices.MlineJustification` — enum；枚举值：3
- `Teigha.DatabaseServices.MlineStyle` — class；构造器：1；方法：`Reset`, `Set`；属性：`Description{get/set}`, `Elements{get}`, `EndAngle{get/set}`, `EndInnerArcs{get/set}`, `EndRoundCap{get/set}`, `EndSquareCap{get/set}`, `FillColor{get/set}`, `Filled{get/set}`, `Name{get/set}`, `ShowMiters{get/set}`, `StartAngle{get/set}`, `StartInnerArcs{get/set}`, `StartRoundCap{get/set}`, `StartSquareCap{get/set}`
- `Teigha.DatabaseServices.MlineStyleElement` — struct；构造器：1；方法：`ToString`×2；属性：`Color{get}`, `LinetypeId{get}`, `Offset{get}`
- `Teigha.DatabaseServices.MlineStyleElementCollection` — class；构造器：0；方法：`Add`, `CopyTo`, `GetEnumerator`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.MlineStyleElementCollectionEnumerator` — class；构造器：1；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.ModelerFlavor` — enum；枚举值：3
- `Teigha.DatabaseServices.MoveGripPointsFlags` — enum；枚举值：5
- `Teigha.DatabaseServices.MoveType` — enum；枚举值：3
- `Teigha.DatabaseServices.MPolygon` — class；构造器：1；方法：`AppendLoopFromBoundary`×3, `AppendMPolygonLoop`, `EvaluateHatch`, `GetLoopDirection`, `GetMPolygonLoopAt`, `GetPatternDefinitionAt`, `InsertMPolygonLoopAt`, `IsPointInsideMPolygon`, `IsPointOnLoopBoundary`, `RemoveMPolygonLoopAt`, `SetLoopDirection`, `SetPattern`；属性：`Area{get}`, `Elevation{get/set}`, `Hatch{get}`, `Normal{get/set}`, `NumMPolygonLoops{get}`, `NumPatternDefinitions{get}`, `OffsetVector{get}`, `PatternAngle{get/set}`, `PatternColor{get/set}`, `PatternDouble{get/set}`, `PatternName{get}`, `PatternScale{get/set}`, `PatternSpace{get/set}`, `PatternType{get}`
- `Teigha.DatabaseServices.MPolygon+LoopDirection` — enum；枚举值：3
- `Teigha.DatabaseServices.MText` — class；构造器：1；方法：`ConvertFieldToText`, `CorrectSpelling`, `ExplodeFragments`×3, `GetBoundingPoints`, `GetColumnHeight`, `getMTextWithFieldCodes`, `SetAttachmentMovingLocation`, `SetColumnHeight`, `SetContentsRtf`, `SetDynamicColumns`, `SetStaticColumns`；属性：`ActualHeight{get}`, `ActualWidth{get}`, `AlignChange{get}`, `Ascent{get}`, `Attachment{get/set}`, `BackgroundFill{get/set}`, `BackgroundFillColor{get/set}`, `BackgroundScaleFactor{get/set}`, `BackgroundTransparency{get/set}`, `BlockBegin{get}`, `BlockEnd{get}`, `ColorChange{get}`, `ColumnAutoHeight{get/set}`, `ColumnCount{get/set}`, `ColumnFlowReversed{get/set}`, `ColumnGutterWidth{get/set}`, `ColumnType{get/set}`, `ColumnWidth{get/set}`, `Contents{get/set}`, `Descent{get}`, `Direction{get/set}`, `FlowDirection{get/set}`, `FontChange{get}`, `Height{get/set}`, `HeightChange{get}`, `LineBreak{get}`, `LineSpaceDistance{get/set}`, `LineSpacingFactor{get/set}`, `LineSpacingStyle{get/set}`, `Location{get/set}`, `NonBreakSpace{get}`, `Normal{get/set}`, `ObliqueChange{get}`, `OverlineOff{get}`, `OverlineOn{get}`, `ParagraphBreak{get}`, `Rotation{get/set}`, `ShowBorders{get/set}`, `StackStart{get}`, `Text{get}`, `TextHeight{get/set}`, `TextStyle{get/set}`, `TextStyleId{get/set}`, `TextStyleName{get}`, `TrackChange{get}`, `UnderlineOff{get}`, `UnderlineOn{get}`, `UseBackgroundColor{get/set}`, `Width{get/set}`, `WidthChange{get}`
- `Teigha.DatabaseServices.MTextFragment` — class；构造器：0；方法：`GetOverLinePoints`, `GetUnderLinePoints`；属性：`BigFont{get}`, `Bold{get}`, `CapsHeight{get}`, `Color{get}`, `Direction{get}`, `Extents{get}`, `Italic{get}`, `LineBreak{get}`, `Location{get}`, `NewParagraph{get}`, `Normal{get}`, `ObliqueAngle{get}`, `Overlined{get}`, `ShxFont{get}`, `StackBottom{get}`, `StackTop{get}`, `Text{get}`, `TrackingFactor{get}`, `TrueTypeFont{get}`, `Underlined{get}`, `WidthFactor{get}`
- `Teigha.DatabaseServices.MTextFragmentCallback` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.MTextFragmentCallbackStatus` — enum；枚举值：2
- `Teigha.DatabaseServices.NewLayerNotification` — enum；枚举值：7
- `Teigha.DatabaseServices.NurbsData` — struct；构造器：0；方法：`Equals`, `GetControlPoints`, `GetHashCode`, `GetKnots`, `GetWeights`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`；属性：`Closed{get}`, `ControlPointTolerance{get}`, `Degree{get}`, `KnotTolerance{get}`, `Periodic{get}`, `Rational{get}`
- `Teigha.DatabaseServices.NurbSurface` — class；构造器：2；方法：`Evaluate`×4, `GetControlPointAt`, `GetIsolineAtU`, `GetIsolineAtV`, `GetNormal`, `GetParameterOfPoint`, `GetWeight`, `InsertControlPointsAtU`, `InsertControlPointsAtV`, `InsertKnotAtU`, `InsertKnotAtV`, `IsPlanar`, `IsPointOnSurface`, `ModifyPosition`, `ModifyPositionAndTangent`, `Rebuild`×2, `RemoveControlPointsAtU`, `RemoveControlPointsAtV`, `Set`, `SetControlPointAt`, `SetControlPoints`, `SetWeight`；属性：`ControlPoints{get}`, `DegreeInU{get}`, `DegreeInV{get}`, `IsClosedInU{get}`, `IsClosedInV{get}`, `IsPeriodicInU{get}`, `IsPeriodicInV{get}`, `IsRational{get}`, `NumberOfControlPointsInU{get}`, `NumberOfControlPointsInV{get}`, `NumberOfKnotsInU{get}`, `NumberOfKnotsInV{get}`, `NumberOfSpansInU{get}`, `NumberOfSpansInV{get}`, `PeriodInU{get}`, `PeriodInV{get}`, `UKnots{get}`, `VKnots{get}`
- `Teigha.DatabaseServices.ObjectClosedEventArgs` — class；构造器：0；属性：`Id{get}`
- `Teigha.DatabaseServices.ObjectClosedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.ObjectContext` — abstract class；构造器：0；属性：`CollectionName{get}`, `Name{get/set}`, `UniqueIdentifier{get}`
- `Teigha.DatabaseServices.ObjectContextCollection` — abstract class；构造器：0；方法：`AddContext`, `GetContext`, `GetEnumerator`, `HasContext`, `IEnumerable_GetEnumerator`, `RemoveContext`；属性：`CurrentContext{get/set}`, `Name{get}`
- `Teigha.DatabaseServices.ObjectContextCollectionEnumerator` — class；构造器：0；方法：`IEnumerator_get_Current`, `MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.ObjectContextManager` — class；构造器：1；方法：`GetContextCollection`, `RegisterContextCollection`, `UnregisterContextCollection`
- `Teigha.DatabaseServices.ObjectErasedEventArgs` — class；构造器：0；属性：`DBObject{get}`, `Erased{get}`
- `Teigha.DatabaseServices.ObjectErasedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.ObjectEventArgs` — class；构造器：0；属性：`DBObject{get}`
- `Teigha.DatabaseServices.ObjectEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.ObjectId` — struct；构造器：1；方法：`Compare`, `ConvertToRedirectedId`, `Equals`, `GetHashCode`, `GetObject`×3, `op_Equality`, `op_GreaterThan`, `op_Inequality`, `op_LessThan`, `Open`×3, `ToString`×2；属性：`Database{get}`, `Handle{get}`, `IsEffectivelyErased{get}`, `IsErased{get}`, `IsNull{get}`, `IsResident{get}`, `IsValid{get}`, `NonForwardedHandle{get}`, `Null{get}`, `ObjectClass{get}`, `ObjectLeftOnDisk{get}`, `OldId{get}`, `OldIdPtr{get}`, `OriginalDatabase{get}`
- `Teigha.DatabaseServices.ObjectIdCollection` — class；构造器：2；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.ObjectIdGraph` — class；构造器：0
- `Teigha.DatabaseServices.ObjectIterator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.ObjectOverrule` — abstract class；构造器：0；方法：`Cancel`, `Close`, `DeepClone`, `Erase`, `Open`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`, `WblockClone`
- `Teigha.DatabaseServices.ObjectSnapModes` — enum；枚举值：13
- `Teigha.DatabaseServices.ObjectTypeAttribute` — class；构造器：1；属性：`ObjectType{get}`
- `Teigha.DatabaseServices.Ole2Frame` — class；构造器：1；方法：`CreateFromFile`, `getCompoundDocument`, `setCompoundDocument`, `setHimetricSize`；属性：`AutoOutputQuality{get/set}`, `DrawAspect{get/set}`, `HimetricHeight{get}`, `HimetricWidth{get}`, `IsLinked{get}`, `LinkName{get}`, `LinkPath{get}`, `Location{get}`, `LockAspect{get/set}`, `OleObject{get}`, `OutputQuality{get/set}`, `Position2d{get/set}`, `Position3d{get/set}`, `Rotation{get/set}`, `ScaleHeight{get/set}`, `ScaleWidth{get/set}`, `Type{get}`, `UserType{get}`, `WcsHeight{get/set}`, `WcsWidth{get/set}`
- `Teigha.DatabaseServices.Ole2Frame+ItemType` — enum；枚举值：3
- `Teigha.DatabaseServices.OleDvAspect` — enum；枚举值：4
- `Teigha.DatabaseServices.OpenCloseTransaction` — class；构造器：1；方法：`Abort`, `AddNewlyCreatedDBObject`, `Commit`, `GetObject`×3；属性：`TransactionManager{get}`
- `Teigha.DatabaseServices.OpenMode` — enum；枚举值：3
- `Teigha.DatabaseServices.OpenModeAttribute` — class；构造器：1；属性：`OpenMode{get}`
- `Teigha.DatabaseServices.OrdinateDimension` — class；构造器：2；属性：`DefiningPoint{get/set}`, `LeaderEndPoint{get/set}`, `Origin{get/set}`, `UsingXAxis{get/set}`, `UsingYAxis{get}`
- `Teigha.DatabaseServices.OrthographicView` — enum；枚举值：7
- `Teigha.DatabaseServices.OsnapOverrule` — abstract class；构造器：0；方法：`GetObjectSnapPoints`×2, `IsContentSnappable`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`
- `Teigha.DatabaseServices.OsnapPointRef` — class；构造器：1；方法：`EvalPoint`, `GetEntities`, `IntersectEntity`, `IsGeomErased`, `IsXrefObj`, `MainEntity`, `UpdateDueToMirror`, `UpdateSubentPath`, `UpdateXrefSubentPath`；属性：`IdPath{get/set}`, `IntIdPath{get/set}`, `LastPointRef{get/set}`, `NearPointParam{get/set}`, `OsnapType{get/set}`, `Point{get/set}`, `XrefHandles{get/set}`, `XrefIntHandles{get/set}`
- `Teigha.DatabaseServices.PaperOrientationStates` — enum；枚举值：3
- `Teigha.DatabaseServices.ParseOption` — enum；枚举值：3
- `Teigha.DatabaseServices.PasswordOptions` — enum；枚举值：3
- `Teigha.DatabaseServices.PathOption` — enum；枚举值：4
- `Teigha.DatabaseServices.PatternDefinition` — struct；构造器：1；方法：`GetDashes`；属性：`Angle{get}`, `BaseX{get}`, `BaseY{get}`, `OffsetX{get}`, `OffsetY{get}`
- `Teigha.DatabaseServices.PdfDefinition` — class；构造器：1
- `Teigha.DatabaseServices.PdfReference` — class；构造器：1
- `Teigha.DatabaseServices.PhysicalIntensityMethod` — enum；枚举值：3
- `Teigha.DatabaseServices.PlaceHolder` — class；构造器：1
- `Teigha.DatabaseServices.Planarity` — enum；枚举值：3
- `Teigha.DatabaseServices.PlaneSurface` — class；构造器：1；方法：`CreateFromRegion`
- `Teigha.DatabaseServices.PlotPaperUnit` — enum；枚举值：3
- `Teigha.DatabaseServices.PlotRotation` — enum；枚举值：4
- `Teigha.DatabaseServices.PlotSettings` — class；构造器：1；方法：`AddToPlotSettingsDictionary`, `SetShadePlot`；属性：`CanonicalMediaName{get}`, `CurrentStyleSheet{get}`, `CustomPrintScale{get}`, `DrawViewportsFirst{get/set}`, `ModelType{get}`, `PlotAsRaster{get}`, `PlotCentered{get}`, `PlotConfigurationName{get}`, `PlotHidden{get/set}`, `PlotOrigin{get}`, `PlotPaperMargins{get}`, `PlotPaperSize{get}`, `PlotPaperUnits{get}`, `PlotPlotStyles{get/set}`, `PlotRotation{get}`, `PlotSettingsName{get/set}`, `PlotTransparency{get/set}`, `PlotType{get}`, `PlotViewName{get}`, `PlotViewportBorders{get/set}`, `PlotWindowArea{get}`, `PlotWireframe{get}`, `PrintLineweights{get/set}`, `ScaleLineweights{get/set}`, `ShadePlot{get/set}`, `ShadePlotCustomDpi{get/set}`, `ShadePlotId{get}`, `ShadePlotResLevel{get/set}`, `ShowPlotStyles{get/set}`, `StdScale{get}`, `StdScaleType{get}`, `UseStandardScale{get}`
- `Teigha.DatabaseServices.PlotSettingsShadePlotType` — enum；枚举值：6
- `Teigha.DatabaseServices.PlotSettingsValidator` — class；构造器：0；方法：`GetCanonicalMediaNameList`, `GetLocaleMediaName`×2, `GetPlotDeviceList`, `GetPlotStyleSheetList`, `RefreshLists`, `SetCanonicalMediaName`, `SetClosestMediaName`, `SetCurrentStyleSheet`, `SetCustomPrintScale`, `SetDefaultPlotConfig`, `SetPlotCentered`, `SetPlotConfigurationName`, `SetPlotOrigin`, `SetPlotPaperUnits`, `SetPlotRotation`, `SetPlotType`, `SetPlotViewName`, `SetPlotWindowArea`, `SetStdScale`, `SetStdScaleType`, `SetUseStandardScale`, `SetZoomToPaperOnUpdate`；属性：`Current{get}`
- `Teigha.DatabaseServices.PlotStyle` — class；构造器：0；属性：`Data{get/set}`, `Description{get/set}`, `LocalizedName{get/set}`, `Name{get/set}`
- `Teigha.DatabaseServices.PlotStyleData` — struct；构造器：0；方法：`op_Equality`, `op_Inequality`；属性：`AdaptiveLinetype{get/set}`, `Color{get/set}`, `ColorPolicy{get/set}`, `DitherOn{get/set}`, `FillStyle{get/set}`, `GrayScaleOn{get/set}`, `LineEndStyle{get/set}`, `LineJoinStyle{get/set}`, `LinePatternSize{get/set}`, `LineType{get/set}`, `Lineweight{get/set}`, `PhysicalPenNumber{get/set}`, `Screening{get/set}`, `VirtualPenNumber{get/set}`
- `Teigha.DatabaseServices.PlotStyleDescriptor` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Id{get}`, `Type{get}`
- `Teigha.DatabaseServices.PlotStyleNameType` — enum；枚举值：4
- `Teigha.DatabaseServices.PlotStyleTable` — class；构造器：0；方法：`AddNewPlotStyle`, `AddPlotStyle`, `DelPlotStyle`, `GetLineweightAt`, `PlotStyleAt`×2, `SetLineweightAt`, `SetOrdering`；属性：`AciTableAvailable{get/set}`, `ApplyScaleFactor{get/set}`, `Description{get/set}`, `DisplayCustomLineweightUnits{get/set}`, `Lineweights{set}`, `LineweightSize{get}`, `PlotStyleArr{get/set}`, `PlotStyleSize{get}`, `ScaleFactor{get/set}`
- `Teigha.DatabaseServices.PlotStyleTableChangedEventArgs` — class；构造器：0；属性：`Id{get}`, `NewName{get}`
- `Teigha.DatabaseServices.PlotStyleTableChangedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.PlotType` — enum；枚举值：6
- `Teigha.DatabaseServices.Point3AngularDimension` — class；构造器：2；属性：`ArcPoint{get/set}`, `CenterPoint{get/set}`, `XLine1Point{get/set}`, `XLine2Point{get/set}`
- `Teigha.DatabaseServices.PointCloudCrop` — class；构造器：1；方法：`Clear`, `Create`, `Equals`, `IsValid`；属性：`CropPlane{get/set}`, `CropType{get/set}`, `Inside{get/set}`, `Inverted{get/set}`, `Vertices{get/set}`
- `Teigha.DatabaseServices.PointCloudCropType` — enum；枚举值：4
- `Teigha.DatabaseServices.PointCloudDispOptionOutOfRange` — enum；枚举值：3
- `Teigha.DatabaseServices.PointCloudEx` — class；构造器：1；方法：`addCroppingBoundary`, `AttachPointCloud`, `clearCropping`, `GetColorSchemeForStylization`, `getCroppingCount`, `getPointCloudCropping`, `HasProperty`, `removeLastCropping`, `SetColorSchemeForStylization`, `TransformBy`；属性：`ActiveFileName{get}`, `CroppingInverted{get/set}`, `CurrentColorScheme{get/set}`, `ElevationApplyToFixedRange{get/set}`, `ElevationGradient{get/set}`, `ElevationOutOfRangeBehavior{get/set}`, `GeomExtents{get}`, `IntensityGradient{get/set}`, `IntensityOutOfRangeBehavior{get/set}`, `Location{get/set}`, `NativeExtents{get}`, `PointCloudDefExId{get/set}`, `Rotation{get/set}`, `Scale{get/set}`, `ShowCropped{get/set}`, `Stylization{get/set}`
- `Teigha.DatabaseServices.PointCloudProperty` — enum；枚举值：4
- `Teigha.DatabaseServices.PointCloudPropertyState` — enum；枚举值：3
- `Teigha.DatabaseServices.PointCloudStylizationType` — enum；枚举值：6
- `Teigha.DatabaseServices.PointRef` — abstract class；构造器：0；方法：`EvalPoint`, `GetEntities`, `IsGeomErased`, `IsXrefObj`, `MswcsToPswcs`, `UpdateDueToMirror`, `UpdateSubentPath`, `UpdateXrefSubentPath`
- `Teigha.DatabaseServices.Poly2dType` — enum；枚举值：4
- `Teigha.DatabaseServices.Poly3dType` — enum；枚举值：3
- `Teigha.DatabaseServices.PolyFaceMesh` — class；构造器：1；方法：`AppendFaceRecord`, `AppendVertex`, `GetEnumerator`；属性：`NumFaces{get}`, `NumVertices{get}`
- `Teigha.DatabaseServices.PolyFaceMeshVertex` — class；构造器：2；属性：`Position{get/set}`
- `Teigha.DatabaseServices.PolygonMesh` — class；构造器：2；方法：`AppendVertex`, `ConvertToPolyMeshType`, `GetEnumerator`, `MakeMClosed`, `MakeMOpen`, `MakeNClosed`, `MakeNOpen`, `Straighten`, `SurfaceFit`×2；属性：`IsMClosed{get}`, `IsNClosed{get}`, `MSize{get/set}`, `MSurfaceDensity{get/set}`, `NSize{get/set}`, `NSurfaceDensity{get/set}`, `PolyMeshType{get/set}`
- `Teigha.DatabaseServices.PolygonMeshVertex` — class；构造器：2；属性：`Position{get/set}`, `VertexType{get}`
- `Teigha.DatabaseServices.Polyline` — class；构造器：2；方法：`AddVertexAt`, `ConvertFrom`, `ConvertTo`, `GetArcSegment2dAt`, `GetArcSegmentAt`, `GetBulgeAt`, `GetEndWidthAt`, `GetLineSegment2dAt`, `GetLineSegmentAt`, `GetPoint2dAt`, `GetPoint3dAt`, `GetSegmentType`, `GetStartWidthAt`, `MaximizeMemory`, `MinimizeMemory`, `OnSegmentAt`, `RemoveVertexAt`, `Reset`, `SetBulgeAt`, `SetEndWidthAt`, `SetPointAt`, `SetStartWidthAt`；属性：`Closed{get/set}`, `ConstantWidth{get/set}`, `Elevation{get/set}`, `HasBulges{get}`, `HasWidth{get}`, `IsOnlyLines{get}`, `Length{get}`, `Normal{get/set}`, `NumberOfVertices{get}`, `Plinegen{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.Polyline2d` — class；构造器：2；方法：`AppendVertex`, `ConvertToPolyType`, `CurveFit`, `GetEnumerator`, `InsertVertexAt`×2, `NonDBAppendVertex`, `SplineFit`×2, `Straighten`, `VertexPosition`；属性：`Closed{get/set}`, `ConstantWidth{get/set}`, `DefaultEndWidth{get/set}`, `DefaultStartWidth{get/set}`, `Elevation{get/set}`, `Length{get}`, `LinetypeGenerationOn{get/set}`, `Normal{get/set}`, `PolyType{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.Polyline3d` — class；构造器：2；方法：`AppendVertex`, `ConvertToPolyType`, `GetEnumerator`, `InsertVertexAt`×2, `SplineFit`×2, `Straighten`；属性：`Closed{get/set}`, `Length{get}`, `PolyType{get/set}`
- `Teigha.DatabaseServices.PolylineVertex3d` — class；构造器：2；属性：`Position{get/set}`, `VertexType{get}`
- `Teigha.DatabaseServices.PolyMeshType` — enum；枚举值：4
- `Teigha.DatabaseServices.PropertiesOverrule` — abstract class；构造器：0；方法：`GetClassID`, `List`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`
- `Teigha.DatabaseServices.ProxyEntity` — class；构造器：0；方法：`GetReferences`；属性：`ApplicationDescription{get}`, `GraphicsMetafileType{get}`, `OriginalClassName{get}`, `OriginalDxfName{get}`, `ProxyFlags{get}`
- `Teigha.DatabaseServices.ProxyObject` — class；构造器：0；方法：`GetReferences`, `ResurrectMeNow`；属性：`ApplicationDescription{get}`, `OriginalClassName{get}`, `OriginalDxfName{get}`, `ProxyFlags{get}`
- `Teigha.DatabaseServices.ProxyResurrectionCompletedEventArgs` — class；构造器：0；属性：`ApplicationName{get}`, `Ids{get}`
- `Teigha.DatabaseServices.ProxyResurrectionCompletedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.RadialDimension` — class；构造器：2；属性：`Center{get/set}`, `ChordPoint{get/set}`, `LeaderLength{get/set}`
- `Teigha.DatabaseServices.RadialDimensionLarge` — class；构造器：2；属性：`Center{get/set}`, `ChordPoint{get/set}`, `JogAngle{get/set}`, `JogPoint{get/set}`, `OverrideCenter{get/set}`
- `Teigha.DatabaseServices.RasterImage` — class；构造器：1；方法：`AssociateRasterDef`, `EnableReactors`, `GetClipBoundary`, `GetVertices`, `ImageSize`, `SetClipBoundary`×2, `SetClipBoundaryToWholeImage`；属性：`Brightness{get/set}`, `ClipBoundaryType{get}`, `Contrast{get/set}`, `DisplayOptions{get/set}`, `Fade{get/set}`, `Height{get}`, `ImageDefId{get/set}`, `ImageHeight{get}`, `ImageTransparency{get/set}`, `ImageWidth{get}`, `IsClipped{get}`, `Name{get/set}`, `Orientation{get/set}`, `Path{get}`, `PixelToModelTransform{get}`, `Position{get}`, `ReactorId{get/set}`, `Rotation{get/set}`, `Scale{get}`, `ShowImage{get/set}`, `Width{get}`
- `Teigha.DatabaseServices.RasterImageDef` — class；构造器：1；方法：`CloseImage`, `CreateImageDictionary`, `Embed`, `GetEntityCount`, `GetImageDictionary`, `ImageCopy`, `Load`, `LocateActivePath`, `OpenImage`, `SetImage`, `SuggestName`, `Unload`, `UpdateEntities`；属性：`ActiveFileName{get/set}`, `ColorDepth{get}`, `FileDescCopy{get}`, `FileType{get}`, `ImageModified{get/set}`, `IsEmbedded{get}`, `IsLoaded{get}`, `Organization{get}`, `ResolutionMMPerPixel{get/set}`, `ResolutionUnits{get/set}`, `SearchForActivePath{get}`, `Size{get}`, `SourceFileName{get/set}`, `UndoStoreSize{get/set}`
- `Teigha.DatabaseServices.RasterVariables` — class；构造器：1；属性：`ImageFrame{get/set}`, `ImageQuality{get/set}`, `UserScale{get/set}`
- `Teigha.DatabaseServices.Ray` — class；构造器：1；属性：`BasePoint{get/set}`, `SecondPoint{get/set}`, `UnitDir{get/set}`
- `Teigha.DatabaseServices.Rectangle3d` — struct；构造器：1；方法：`ToString`×2；属性：`LowerLeft{get}`, `LowerRight{get}`, `UpperLeft{get}`, `UpperRight{get}`
- `Teigha.DatabaseServices.RegAppTable` — class；构造器：0
- `Teigha.DatabaseServices.RegAppTableRecord` — class；构造器：1
- `Teigha.DatabaseServices.Region` — class；构造器：1；方法：`AreaProperties`, `BooleanOperation`, `CreateFromCurves`；属性：`Area{get}`, `Body{get/set}`, `IsNull{get}`, `Normal{get}`, `NumChanges{get}`, `Perimeter{get}`
- `Teigha.DatabaseServices.RegionAreaProperties` — struct；构造器：0；属性：`Area{get}`, `Centroid{get}`, `Extents{get}`, `MomentsOfInertia{get}`, `Perimeter{get}`, `PrincipalAxes{get}`, `PrincipalMoments{get}`, `ProductOfInertia{get}`, `RadiiOfGyration{get}`
- `Teigha.DatabaseServices.RenderEnvironment` — class；构造器：1；属性：`Distances{get/set}`, `EnvironmentImageEnabled{get/set}`, `EnvironmentImageFileName{get/set}`, `FogBackgroundEnabled{get/set}`, `FogColor{get/set}`, `FogDensity{get/set}`, `FogEnabled{get/set}`
- `Teigha.DatabaseServices.RenderEnvironment+DoubleRangeParameter` — struct；构造器：1；属性：`Far{get}`, `Near{get}`
- `Teigha.DatabaseServices.RenderGlobal` — class；构造器：1；属性：`Dimensions{get/set}`, `ExposureType{get/set}`, `HighInfoLevel{get/set}`, `PredefinedPresetsFirst{get/set}`, `ProcedureAndDestination{get/set}`, `SaveEnabled{get/set}`, `SaveFileName{get/set}`
- `Teigha.DatabaseServices.RenderGlobal+Destination` — enum；枚举值：2
- `Teigha.DatabaseServices.RenderGlobal+DimensionsParameter` — struct；构造器：1；属性：`Height{get}`, `Width{get}`
- `Teigha.DatabaseServices.RenderGlobal+Procedure` — enum；枚举值：3
- `Teigha.DatabaseServices.RenderGlobal+ProcedureAndDestinationParameter` — struct；构造器：1；属性：`Destination{get}`, `Procedure{get}`
- `Teigha.DatabaseServices.RenderMode` — enum；枚举值：7
- `Teigha.DatabaseServices.RenderSettings` — class；构造器：1；属性：`BackFacesEnabled{get/set}`, `Description{get/set}`, `DiagnosticBackgroundEnabled{get/set}`, `DisplayIndex{get/set}`, `MaterialsEnabled{get/set}`, `Name{get/set}`, `PreviewImageFileName{get/set}`, `ShadowsEnabled{get/set}`, `TextureSampling{get/set}`
- `Teigha.DatabaseServices.ResultBuffer` — class；构造器：2；方法：`Add`×2, `AsArray`, `Create`, `Equals`, `GetEnumerator`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×3
- `Teigha.DatabaseServices.ResultBufferEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.RevolvedSurface` — class；构造器：1；方法：`CreateRevolvedSurface`, `SetRevolve`；属性：`AxisDirection{get/set}`, `AxisPoint{get/set}`, `RevolveAngle{get/set}`, `RevolveEntity{get}`, `RevolveOptions{get/set}`, `StartAngle{get}`
- `Teigha.DatabaseServices.RevolveOptions` — class；构造器：2；方法：`CheckRevolveCurve`, `Clone`；属性：`CloseToAxis{get}`, `DraftAngle{get}`, `TwistAngle{get}`
- `Teigha.DatabaseServices.RevolveOptionsBuilder` — class；构造器：2；方法：`ToRevolveOptions`；属性：`CloseToAxis{get/set}`, `DraftAngle{get/set}`, `TwistAngle{get/set}`
- `Teigha.DatabaseServices.RevolveOptionsCheckRevolveCurveOut` — class；构造器：1；属性：`Closed{get}`, `EndPointsOnAxis{get}`, `Planar{get}`
- `Teigha.DatabaseServices.RotatedDimension` — class；构造器：2；属性：`DimLinePoint{get/set}`, `Oblique{get/set}`, `Rotation{get/set}`, `XLine1Point{get/set}`, `XLine2Point{get/set}`
- `Teigha.DatabaseServices.RotatedDimType` — enum；枚举值：3
- `Teigha.DatabaseServices.RotationAngle` — enum；枚举值：5
- `Teigha.DatabaseServices.Row` — class；构造器：0；属性：`Height{get/set}`, `MinimumHeight{get}`
- `Teigha.DatabaseServices.RowsCollection` — class；构造器：0；方法：`GetEnumerator`；属性：`Count{get}`, `Item{get}`
- `Teigha.DatabaseServices.RowType` — enum；枚举值：4
- `Teigha.DatabaseServices.SaveType` — enum；枚举值：4
- `Teigha.DatabaseServices.ScaleEstimationMethod` — enum；枚举值：4
- `Teigha.DatabaseServices.Section` — class；构造器：3；方法：`AddVertex`, `CreateJog`, `GenerateSectionGeometry`, `GetVertex`, `GetVertices`, `Height`, `HitTest`, `RemoveVertex`, `SetHeight`, `SetVertex`；属性：`BottomPlane{get/set}`, `Boundary{get}`, `Elevation{get/set}`, `IndicatorFillColor{get/set}`, `IndicatorTransparency{get/set}`, `IsLiveSectionEnabled{get/set}`, `Name{get/set}`, `Normal{get}`, `NumVertices{get}`, `Settings{get}`, `State{get/set}`, `TopPlane{get/set}`, `VerticalDirection{get/set}`, `Vertices{set}`, `ViewingDirection{get/set}`
- `Teigha.DatabaseServices.SectionGeneration` — enum；枚举值：5
- `Teigha.DatabaseServices.SectionGeometry` — enum；枚举值：5
- `Teigha.DatabaseServices.SectionHeight` — enum；枚举值：2
- `Teigha.DatabaseServices.SectionHitTestInfo` — struct；构造器：0；属性：`Index{get}`, `PtOnSegment{get}`, `SubItem{get}`
- `Teigha.DatabaseServices.SectionManager` — class；构造器：1；方法：`GetEnumerator`, `GetSection`, `GetUniqueSectionName`；属性：`LiveSection{get}`, `NumSections{get}`
- `Teigha.DatabaseServices.SectionSettings` — class；构造器：1；方法：`Color`, `DestinationBlock`, `DestinationFile`, `DivisionLines`, `EdgeTransparency`, `FaceTransparency`, `GenerationOptions`, `GetHatchPatternName`, `GetHatchPatternType`, `GetSourceObjects`, `HatchAngle`, `HatchScale`, `HatchSpacing`, `HatchVisibility`, `HiddenLine`, `Layer`, `Linetype`, `LinetypeScale`, `LineWeight`, `PlotStyleName`, `Reset`×2, `SetColor`, `SetDestinationBlock`, `SetDestinationFile`, `SetDivisionLines`, `SetEdgeTransparency`, `SetFaceTransparency`, `SetGenerationOptions`, `SetHatchAngle`, `SetHatchPatternName`, `SetHatchPatternType`, `SetHatchScale`, `SetHatchSpacing`, `SetHatchVisibility`, `SetHiddenLine`, `SetLayer`, `SetLinetype`, `SetLinetypeScale`, `SetLineWeight`, `SetPlotStyleName`, `SetSourceObjects`, `SetVisibility`, `Visibility`；属性：`CurrentSectionType{get/set}`
- `Teigha.DatabaseServices.SectionState` — enum；枚举值：3
- `Teigha.DatabaseServices.SectionSubItem` — enum；枚举值：9
- `Teigha.DatabaseServices.SectionType` — enum；枚举值：3
- `Teigha.DatabaseServices.SecurityActions` — enum；枚举值：4
- `Teigha.DatabaseServices.SecurityAlgorithm` — enum；枚举值：1
- `Teigha.DatabaseServices.SecurityParameters` — class；构造器：2；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Action{get/set}`, `Algorithm{get/set}`, `Comment{get/set}`, `Issuer{get/set}`, `KeyLength{get/set}`, `Password{get/set}`, `ProviderName{get/set}`, `ProviderType{get/set}`, `SerialNumber{get/set}`, `Subject{get/set}`, `TimeServer{get/set}`
- `Teigha.DatabaseServices.SegmentType` — enum；枚举值：5
- `Teigha.DatabaseServices.SelectType` — enum；枚举值：2
- `Teigha.DatabaseServices.SequenceEnd` — class；构造器：1
- `Teigha.DatabaseServices.ShadePlotResLevel` — enum；枚举值：6
- `Teigha.DatabaseServices.ShadePlotType` — enum；枚举值：6
- `Teigha.DatabaseServices.ShadowSamplingMultiplier` — enum；枚举值：6
- `Teigha.DatabaseServices.Shape` — class；构造器：2；属性：`Name{get/set}`, `Normal{get/set}`, `Oblique{get/set}`, `Position{get/set}`, `Rotation{get/set}`, `ShapeIndex{get/set}`, `ShapeNumber{get/set}`, `Size{get/set}`, `StyleId{get/set}`, `Thickness{get/set}`, `WidthFactor{get/set}`
- `Teigha.DatabaseServices.SkyBackground` — class；构造器：1；方法：`GetDrawableType`；属性：`SunId{get/set}`
- `Teigha.DatabaseServices.Solid` — class；构造器：3；方法：`GetPointAt`, `SetPointAt`；属性：`Normal{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.Solid3d` — class；构造器：1；方法：`BooleanOperation`, `ChamferEdges`, `CheckInterference`, `CleanBody`, `ConvertToBrepAtSubentPaths`, `CopyEdge`, `CopyFace`, `CreateBox`, `CreateExtrudedSolid`×3, `CreateFrom`, `CreateFrustum`, `CreateLoftedSolid`, `CreatePyramid`, `CreateRevolvedSolid`×2, `CreateSculptedSolid`, `CreateSphere`, `CreateSweptSolid`×2, `CreateTorus`, `CreateWedge`, `Extrude`, `ExtrudeAlongPath`, `ExtrudeFaces`, `ExtrudeFacesAlongPath`, `FilletEdges`, `GetSection`, `GetSubentityColor`, `GetSubentityMaterial`, `GetSubentityMaterialMapper`, `ImprintEntity`, `OffsetBody`, `OffsetFaces`, `ProjectOnToSolid`, `RemoveFaces`, `Revolve`, `SeparateBody`, `SetSubentityColor`, `SetSubentityMaterial`, `SetSubentityMaterialMapper`, `ShellBody`, `Slice`×4, `StlOut`, `TaperFaces`, `TransformFaces`；属性：`Area{get}`, `IsNull{get}`, `MassProperties{get}`, `NumChanges{get}`, `RecordHistory{get/set}`, `ShowHistory{get/set}`
- `Teigha.DatabaseServices.Solid3dMassProperties` — struct；构造器：1；属性：`Centroid{get}`, `Extents{get}`, `MomentsOfIntertia{get}`, `PrincipalAxes{get}`, `PrincipalMoments{get}`, `ProductsOfIntertia{get}`, `RadiiOfGyration{get}`, `Volume{get}`
- `Teigha.DatabaseServices.SolidBackground` — class；构造器：1；属性：`Color{get/set}`
- `Teigha.DatabaseServices.Spline` — class；构造器：5；方法：`ElevateDegree`, `GetControlPointAt`, `GetFitPointAt`, `InsertFitPointAt`, `InsertKnot`, `ModifyPositionAndTangent`, `PurgeFitData`, `RemoveFitPointAt`, `SetControlPointAt`, `SetFitPointAt`, `SetWeightAt`, `ToPolyline`×4, `ToPolylineWithPrecision`×2, `UpdateFitData`, `WeightAt`；属性：`Degree{get}`, `EndFitTangent{get}`, `FitData{get/set}`, `FitTolerance{get/set}`, `HasFitData{get}`, `IsNull{get}`, `IsPlanar{get}`, `IsRational{get}`, `NumControlPoints{get}`, `NumFitPoints{get}`, `NurbsData{get/set}`, `StartFitTangent{get}`
- `Teigha.DatabaseServices.StandardScaleType` — enum；枚举值：34
- `Teigha.DatabaseServices.StdScaleType` — enum；枚举值：35
- `Teigha.DatabaseServices.SubDMesh` — class；构造器：1；方法：`ComputeSurfaceArea`, `ComputeVolume`, `ConvertToSolid`, `ConvertToSurface`×2, `ExtrudeFaces`×2, `GetAdjacentSubentPath`, `GetCrease`×2, `GetFacePlane`, `GetNumberOfSubDividedFacesAt`, `GetObjectMesh`, `GetSubDividedVertexAt`×2, `GetSubentColor`, `GetSubentMaterial`, `GetSubentMaterialMapper`, `GetSubentPath`, `GetVertexAt`×2, `Setbox`, `SetCone`, `SetCrease`×2, `SetCylinder`, `SetDragStatus`, `SetPyramid`, `SetSphere`, `SetSubDMesh`, `SetSubentColor`, `SetSubentMaterial`, `SetSubentMaterialMapper`, `SetTorus`, `SetVertexAt`×2, `SetWedge`, `SplitFace`, `SubdDivideDown`, `SubdDivideUp`, `SubdRefine`×2；属性：`EdgeArray{get}`, `FaceArray{get}`, `NormalArray{get}`, `NumberOfEdges{get}`, `NumberOfFaces{get}`, `NumberOfSubDividedFaces{get}`, `NumberOfSubDividedVertices{get}`, `NumberOfVertices{get}`, `SmoothLevel{get}`, `SubDividedFaceArray{get}`, `SubDividedNormalArray{get}`, `SubDividedVertices{get}`, `VertexColorArray{get/set}`, `VertexNormalArray{get/set}`, `VertexTextureArray{get/set}`, `Vertices{get}`, `Watertight{get}`
- `Teigha.DatabaseServices.SubentityId` — struct；构造器：4；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`；属性：`Index{get}`, `IndexPtr{get}`, `Null{get}`, `Type{get}`, `TypeClass{get}`
- `Teigha.DatabaseServices.SubentityOverrule` — abstract class；构造器：0；方法：`AddSubentPaths`, `DeleteSubentPaths`, `GetCompoundObjectTransform`, `GetGripPointsAtSubentPath`, `GetGsMarkersAtSubentPath`, `GetSubentClassId`, `GetSubentPathGeomExtents`, `GetSubentPathsAtGsMarker`, `MoveGripPointsAtSubentPaths`, `OnSubentGripStatusChanged`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`, `SubentPtr`, `TransformSubentPathsBy`
- `Teigha.DatabaseServices.SubentityType` — enum；枚举值：6
- `Teigha.DatabaseServices.Sun` — class；构造器：1；属性：`Altitude{get/set}`, `Azimuth{get/set}`, `DateTime{get/set}`, `Intensity{get/set}`, `IsDaylightSavingsOn{get/set}`, `IsOn{get/set}`, `ShadowParameters{get/set}`, `SunColor{get/set}`, `SunDirection{get/set}`
- `Teigha.DatabaseServices.Surface` — class；构造器：1；方法：`BooleanIntersect`×2, `BooleanSubtract`×2, `BooleanUnion`, `ChamferEdges`, `ConvertToNurbSurface`, `ConvertToRegion`, `CreateFrom`, `CreateInterferenceObjects`, `CreateOffsetSurface`×2, `CreateSectionObjects`, `FilletEdges`, `GetArea`, `GetSubentityColor`, `GetSubentityMaterial`, `GetSubentityMaterialMapper`, `ImprintEntity`, `ProjectOnToSurface`, `RayTest`, `SetSubentityColor`, `SetSubentityMaterial`, `SetSubentityMaterialMapper`, `SliceByPlane`, `SliceBySurface`, `Thicken`, `TrimSurface`；属性：`Perimeter{get}`, `UIsoLineDensity{get/set}`, `VIsoLineDensity{get/set}`
- `Teigha.DatabaseServices.SurfaceSliceResults` — struct；构造器：1；属性：`NegativeHalfSurface{get/set}`, `NewSurface{get/set}`
- `Teigha.DatabaseServices.SweepOptions` — class；构造器：2；方法：`CheckPathCurve`, `CheckSweepCurve`, `Clone`；属性：`Align{get}`, `AlignAngle{get}`, `AlignStart{get}`, `Bank{get}`, `BasePoint{get}`, `CheckIntersections{get}`, `DraftAngle{get}`, `EndDraftDist{get}`, `PathEntityTransform{get}`, `ScaleFactor{get}`, `StartDraftDist{get}`, `SweepEntityTransform{get}`, `TwistAngle{get}`
- `Teigha.DatabaseServices.SweepOptionsAlignOption` — enum；枚举值：4
- `Teigha.DatabaseServices.SweepOptionsBuilder` — class；构造器：2；方法：`SetPathEntityTransform`, `SetSweepEntityTransform`, `ToSweepOptions`；属性：`Align{get/set}`, `AlignAngle{get/set}`, `AlignStart{get/set}`, `Bank{get/set}`, `BasePoint{get/set}`, `CheckIntersections{get/set}`, `DraftAngle{get/set}`, `EndDraftDist{get/set}`, `PathEntityTransform{get/set}`, `ScaleFactor{get/set}`, `StartDraftDist{get/set}`, `SweepEntityTransform{get/set}`, `TwistAngle{get/set}`
- `Teigha.DatabaseServices.SweepOptionsCheckSweepCurveOut` — class；构造器：1；属性：`ApproximateArcLength{get}`, `Closed{get}`, `Planarity{get}`, `Point{get}`, `Vector{get}`
- `Teigha.DatabaseServices.SweptSurface` — class；构造器：1；方法：`CreateSweptSurface`；属性：`Bank{get/set}`, `PathEntity{get}`, `PathLength{get}`, `ProfileRotation{get/set}`, `ScaleAlongPath{get/set}`, `SweepEntity{get}`, `SweepOptions{get/set}`, `TwistAlongPath{get/set}`
- `Teigha.DatabaseServices.SymbolTable` — abstract class；构造器：0；方法：`Add`, `GetEnumerator`, `Has`×2；属性：`IncludingErased{get}`, `Item{get}`
- `Teigha.DatabaseServices.SymbolTableEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.DatabaseServices.SymbolTableRecord` — abstract class；构造器：0；属性：`IsDependent{get}`, `IsResolved{get}`, `Name{get/set}`
- `Teigha.DatabaseServices.SymbolUtilityServices` — class；构造器：1；方法：`GetBlockModelSpaceId`, `GetBlockNameFromInsertPathName`, `GetBlockPaperSpaceId`, `GetInsertPathNameFromBlockName`, `GetLayerDefpointsId`, `GetLayerZeroId`, `GetLinetypeByBlockId`, `GetLinetypeByLayerId`, `GetLinetypeContinuousId`, `GetMaxSymbolNameLength`, `GetPathNameFromSymbolName`, `GetRegAppAcadId`, `GetSymbolNameFromPathName`, `GetTextStyleStandardId`, `IsBlockLayoutName`, `IsBlockModelSpaceName`, `IsBlockPaperSpaceName`, `IsCompatibilityMode`, `IsLayerDefpointsName`, `IsLayerZeroName`, `IsLinetypeByBlockName`, `IsLinetypeByLayerName`, `IsLinetypeContinuousName`, `IsRegAppAcadName`, `IsTextStyleStandardName`, `IsViewportActiveName`, `MakeDependentName`, `PreValidateSymbolName`, `RepairPreExtendedSymbolName`, `RepairSymbolName`, `ValidateCompatibleSymbolName`, `ValidatePreExtendedSymbolName`, `ValidateSymbolName`；属性：`BlockModelSpaceName{get}`, `BlockPaperSpaceName{get}`, `LayerDefpointsName{get}`, `LayerZeroName{get}`, `LinetypeByBlockName{get}`, `LinetypeByLayerName{get}`, `LinetypeContinuousName{get}`, `RegAppAcadName{get}`, `TextStyleStandardName{get}`, `ViewportActiveName{get}`
- `Teigha.DatabaseServices.SystemVariableChangedEventArgs` — class；构造器：0；属性：`Changed{get}`, `Name{get}`
- `Teigha.DatabaseServices.SystemVariableChangedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.SystemVariableChangingEventArgs` — class；构造器：0；属性：`Name{get}`
- `Teigha.DatabaseServices.SystemVariableChangingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.Table` — class；构造器：1；方法：`Alignment`×2, `AttachmentPoint`, `BackgroundColor`×2, `BlockRotation`, `BlockScale`, `BlockTableRecordId`, `CanDeleteColumns`, `CanDeleteRows`, `CanInsertColumn`, `CanInsertRow`, `CellStyleOverrides`, `CellType`, `ClearSubSelection`, `ClearTableStyleOverrides`, `ColumnWidth`, `ContentColor`×2, `CopyFrom`×3, `CreateContent`, `DataType`×2, `DeleteCellContent`, `DeleteColumns`, `DeleteContent`×3, `DeleteRows`, `FieldId`, `Fill`, `Format`×2, `GenerateLayout`, `GetBlockAttributeValue`×2, `GetBlockTableRecordId`, `GetBreakHeight`, `GetBreakOffset`, `GetBreakSpacing`, `GetCellExtents`, `GetCellState`, `GetCellStyle`, `GetColumnName`, `GetContentColor`, `GetContentLayout`, `GetContentTypes`×2, `GetCustomData`×2, `GetDataFormat`×2, `GetDataLink`×3, `GetDataLinkRange`, `GetDataType`, `GetFieldId`, `GetFormula`, `GetGridColor`, `GetGridDoubleLineSpacing`, `GetGridLineStyle`, `GetGridLinetype`, `GetGridLineWeight`, `GetGridProperty`, `GetGridVisibility`, `GetIsAutoScale`, `GetMargin`, `GetMergeAllEnabled`, `GetMergeRange`, `GetNumberOfContents`, `GetOverrides`×2, `GetRotation`, `GetScale`, `GetTextHeight`, `GetTextString`×2, `GetTextStyleId`, `GetToolTip`, `GetValue`×2, `GridColor`×2, `GridLineWeight`×2, `GridVisibility`×2, `HasFormula`, `HitTest`, `InsertColumns`, `InsertColumnsAndInherit`, `InsertRows`, `InsertRowsAndInherit`, `IsAutoScale`, `IsBackgroundColorNone`×2, `IsContentEditable`, `IsEmpty`, `IsFormatEditable`, `IsLinked`, `IsMergedCell`, `MergeCells`, `MinimumColumnWidth`, `MinimumRowHeight`, `MoveContent`, `RecomputeTableBlock`, `RemoveAllOverrides`, `RemoveDataLink`×2, `ReselectSubRegion`, `ResetValue`, `RowHeight`, `RowType`, `Select`, `SelectSubRegion`, `SetAlignment`×2, `SetAutoScale`, `SetBackgroundColor`×2, `SetBackgroundColorNone`×2, `SetBlockAttributeValue`×2, `SetBlockRotation`, `SetBlockScale`, `SetBlockTableRecordId`×2, `SetBreakHeight`, `SetBreakOffset`, `SetBreakSpacing`, `SetCellState`, `SetCellStyle`, `SetCellType`, `SetColumnName`, `SetColumnWidth`×2, `SetContentColor`×3, `SetContentLayout`, `SetCustomData`×2, `SetDataFormat`×2, `SetDataLink`×2, `SetDataType`×3, `SetFieldId`×2, `SetFormat`×2, `SetFormula`, `SetGridColor`×3, `SetGridDoubleLineSpacing`, `SetGridLineStyle`, `SetGridLinetype`, `SetGridLineWeight`×3, `SetGridProperty`×2, `SetGridVisibility`×3, `SetIsAutoScale`, `SetMargin`, `SetMergeAllEnabled`, `SetOverrides`×2, `SetRotation`, `SetRowHeight`×2, `SetScale`, `SetSize`, `SetTextHeight`×3, `SetTextRotation`, `SetTextString`×2, `SetTextStyle`×2, `SetTextStyleId`, `SetToolTip`, `SetValue`×5, `SuppressRegenerateTable`, `TableStyleOverrides`, `TextHeight`×2, `TextRotation`, `TextString`×2, `TextStringConst`, `TextStyle`×2, `UnitType`×2, `UnmergeCells`, `UpdateDataLink`×2, `Value`；属性：`BreakEnabled{get/set}`, `BreakFlowDirection{get/set}`, `BreakOptions{get/set}`, `Cells{get}`, `Columns{get}`, `Direction{get/set}`, `FlowDirection{get/set}`, `HasSubSelection{get}`, `Height{get/set}`, `HorizontalCellMargin{get/set}`, `IsHeaderSuppressed{get/set}`, `IsTitleSuppressed{get/set}`, `MinimumTableHeight{get}`, `MinimumTableWidth{get}`, `NumColumns{get/set}`, `NumRows{get/set}`, `Rows{get}`, `SubSelection{get/set}`, `TableStyle{get/set}`, `TableStyleName{get}`, `VerticalCellMargin{get/set}`, `Width{get/set}`
- `Teigha.DatabaseServices.TableBreakFlowDirection` — enum；枚举值：3
- `Teigha.DatabaseServices.TableBreakOptions` — enum；枚举值：6
- `Teigha.DatabaseServices.TableCellType` — enum；枚举值：4
- `Teigha.DatabaseServices.TableContent` — class；构造器：1；方法：`GetCellStyle`, `GetColumnWidth`, `GetRowHeight`, `SetCellStyle`, `SetColumnWidth`, `SetRowHeight`；属性：`TableStyleId{get/set}`
- `Teigha.DatabaseServices.TableCopyOptions` — enum；枚举值：27
- `Teigha.DatabaseServices.TableEnumerator` — abstract class；构造器：1；方法：`MoveNext`, `Reset`
- `Teigha.DatabaseServices.TableEnumeratorOption` — enum；枚举值：7
- `Teigha.DatabaseServices.TableFillOptions` — enum；枚举值：8
- `Teigha.DatabaseServices.TableHitTestInfo` — struct；构造器：0；方法：`ToString`×2；属性：`Column{get}`, `Row{get}`, `Type{get}`
- `Teigha.DatabaseServices.TableHitTestType` — enum；枚举值：2
- `Teigha.DatabaseServices.TableStyle` — class；构造器：1；方法：`Alignment`, `BackgroundColor`, `CellClass`, `Color`, `DataType`, `Format`, `GridColor`, `GridLineWeight`, `GridVisibility`, `IsBackgroundColorNone`, `Margin`, `PostTableStyleToDatabase`, `SetAlignment`, `SetBackgroundColor`, `SetBackgroundColorNone`, `SetCellClass`, `SetColor`, `SetDataType`, `SetFormat`, `SetGridColor`, `SetGridLineWeight`, `SetGridVisibility`, `SetMargin`, `SetTextHeight`, `SetTextStyle`×2, `TextHeight`×2, `TextStyle`×2, `UnitType`；属性：`BitFlags{get/set}`, `CellStyles{get}`, `Description{get/set}`, `FlowDirection{get/set}`, `HorizontalCellMargin{get/set}`, `IsHeaderSuppressed{get/set}`, `IsTitleSuppressed{get/set}`, `Name{get/set}`, `Template{get}`, `VerticalCellMargin{get/set}`
- `Teigha.DatabaseServices.TableStyleFlags` — enum；枚举值：4
- `Teigha.DatabaseServices.TableStyleOverride` — enum；枚举值：99
- `Teigha.DatabaseServices.TableTemplate` — class；构造器：1；方法：`Capture`, `CreateTable`
- `Teigha.DatabaseServices.TextAlignment` — enum；枚举值：3
- `Teigha.DatabaseServices.TextAlignmentType` — enum；枚举值：3
- `Teigha.DatabaseServices.TextAngleType` — enum；枚举值：3
- `Teigha.DatabaseServices.TextAttachmentDirection` — enum；枚举值：2
- `Teigha.DatabaseServices.TextAttachmentType` — enum；枚举值：9
- `Teigha.DatabaseServices.TextHorizontalMode` — enum；枚举值：6
- `Teigha.DatabaseServices.TextStyleTable` — class；构造器：0
- `Teigha.DatabaseServices.TextStyleTableRecord` — class；构造器：1；属性：`BigFontFileName{get/set}`, `FileName{get/set}`, `FlagBits{get/set}`, `Font{get/set}`, `IsShapeFile{get/set}`, `IsVertical{get/set}`, `ObliquingAngle{get/set}`, `PriorSize{get/set}`, `TextSize{get/set}`, `XScale{get/set}`
- `Teigha.DatabaseServices.TextVerticalMode` — enum；枚举值：4
- `Teigha.DatabaseServices.TimeZone` — enum；枚举值：76
- `Teigha.DatabaseServices.Trace` — class；构造器：2；方法：`GetPointAt`, `SetPointAt`；属性：`Normal{get/set}`, `Thickness{get/set}`
- `Teigha.DatabaseServices.Transaction` — class；构造器：0；方法：`Abort`, `AddNewlyCreatedDBObject`, `Commit`, `GetAllObjects`, `GetObject`×3；属性：`TransactionManager{get}`
- `Teigha.DatabaseServices.TransactionManager` — class；构造器：0；方法：`AddNewlyCreatedDBObject`, `GetAllObjects`, `GetObject`×3, `QueueForGraphicsFlush`, `StartOpenCloseTransaction`, `StartTransaction`；属性：`NumberOfActiveTransactions{get}`, `TopTransaction{get}`
- `Teigha.DatabaseServices.TransformOverrule` — abstract class；构造器：0；方法：`CloneMeForDragging`, `Explode`, `GetTransformedCopy`, `HideMeForDragging`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`, `TransformBy`
- `Teigha.DatabaseServices.TypedValue` — struct；构造器：2；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`TypeCode{get}`, `Value{get}`
- `Teigha.DatabaseServices.TypeOfCoordinates` — enum；枚举值：4
- `Teigha.DatabaseServices.UcsTable` — class；构造器：0
- `Teigha.DatabaseServices.UcsTableRecord` — class；构造器：1；方法：`GetUcsBaseOrigin`, `SetUcsBaseOrigin`；属性：`Origin{get/set}`, `XAxis{get/set}`, `YAxis{get/set}`
- `Teigha.DatabaseServices.UnderlayDefinition` — abstract class；构造器：0；方法：`GetDictionaryKey`, `Load`, `SetUnderlayItem`, `Unload`；属性：`ActiveFileName{get}`, `ItemName{get/set}`, `Loaded{get}`, `SourceFileName{get/set}`, `UnderlayItem{get}`
- `Teigha.DatabaseServices.UnderlayFile` — class；构造器：0；属性：`Items{get}`
- `Teigha.DatabaseServices.UnderlayHost` — class；构造器：0；方法：`GetFile`；属性：`DgnDocHost{get}`, `DgnHost{get}`, `DwfHost{get}`, `PdfHost{get}`
- `Teigha.DatabaseServices.UnderlayItem` — class；构造器：0；属性：`Extents{get}`, `Name{get}`, `Thumbnail{get}`, `Units{get}`, `UsingPartialContent{get}`
- `Teigha.DatabaseServices.UnderlayItemCollection` — class；构造器：0；方法：`CopyTo`, `GetEnumerator`；属性：`Count{get}`, `Item{get}`
- `Teigha.DatabaseServices.UnderlayLayer` — class；构造器：1；属性：`Name{get}`, `State{get/set}`
- `Teigha.DatabaseServices.UnderlayLayerCollection` — class；构造器：0；方法：`CopyTo`, `GetEnumerator`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.DatabaseServices.UnderlayLayerState` — enum；枚举值：2
- `Teigha.DatabaseServices.UnderlayReference` — abstract class；构造器：0；方法：`GenerateClipBoundaryFromPline`, `GetClipBoundary`, `SetClipBoundary`；属性：`AdjustColorForBackground{get/set}`, `Contrast{get/set}`, `ContrastLowerLimit{get}`, `ContrastUpperLimit{get}`, `DefaultContrast{get}`, `DefaultFade{get}`, `DefinitionId{get/set}`, `Fade{get/set}`, `FadeLowerLimit{get}`, `FadeUpperLimit{get}`, `Height{get/set}`, `IsClipped{get/set}`, `IsOn{get/set}`, `Monochrome{get/set}`, `Name{get/set}`, `NameOfSheet{get/set}`, `Normal{get/set}`, `Path{get/set}`, `Position{get/set}`, `Rotation{get/set}`, `ScaleFactors{get/set}`, `Transform{get/set}`, `UnderlayLayerCollection{get}`, `Width{get/set}`
- `Teigha.DatabaseServices.Unit` — enum；枚举值：21
- `Teigha.DatabaseServices.UnitsConverter` — class；构造器：1；方法：`CanConvertFrom`, `ConvertFrom`, `ConvertTo`, `GetConversionFactor`
- `Teigha.DatabaseServices.UnitsValue` — enum；枚举值：25
- `Teigha.DatabaseServices.UnitType` — enum；枚举值：8
- `Teigha.DatabaseServices.UnitTypeAttribute` — class；构造器：1；属性：`UnitType{get}`
- `Teigha.DatabaseServices.UpdateAction` — enum；枚举值：3
- `Teigha.DatabaseServices.UpdateDirection` — enum；枚举值：2
- `Teigha.DatabaseServices.UpdateOption` — enum；枚举值：10
- `Teigha.DatabaseServices.Vertex` — class；构造器：0
- `Teigha.DatabaseServices.Vertex2d` — class；构造器：2；属性：`Bulge{get/set}`, `EndWidth{get/set}`, `Position{get/set}`, `StartWidth{get/set}`, `Tangent{get/set}`, `TangentUsed{get/set}`, `VertexType{get}`
- `Teigha.DatabaseServices.Vertex2dType` — enum；枚举值：4
- `Teigha.DatabaseServices.Vertex3dType` — enum；枚举值：3
- `Teigha.DatabaseServices.Viewport` — class；构造器：1；方法：`FreezeLayersInViewport`, `GetFrozenLayers`, `GetPreviousBackground`, `GetUcs`, `IsLayerFrozenInViewport`, `SetPreviousBackground`, `SetShadePlot`, `SetSun`, `SetUcs`×3, `SetUcsToWorld`, `SetViewDirection`, `ThawAllLayersInViewport`, `ThawLayersInViewport`, `UpdateDisplay`；属性：`AmbientLightColor{get/set}`, `AnnotationScale{get/set}`, `BackClipDistance{get/set}`, `BackClipOn{get/set}`, `Background{get/set}`, `Brightness{get/set}`, `CenterPoint{get/set}`, `CircleSides{get/set}`, `Contrast{get/set}`, `CustomScale{get/set}`, `DefaultLightingOn{get/set}`, `DefaultLightingType{get/set}`, `EffectivePlotStyleSheet{get}`, `Elevation{get/set}`, `FastZoomOn{get/set}`, `FrontClipAtEyeOn{get/set}`, `FrontClipDistance{get/set}`, `FrontClipOn{get/set}`, `GridAdaptive{get/set}`, `GridBoundToLimits{get/set}`, `GridFollow{get/set}`, `GridIncrement{get/set}`, `GridMajor{get/set}`, `GridOn{get/set}`, `GridSubdivisionRestricted{get/set}`, `Height{get/set}`, `HiddenLinesRemoved{get/set}`, `LensLength{get/set}`, `LinkedToSheetView{get}`, `Locked{get/set}`, `NonRectClipEntityId{get/set}`, `NonRectClipOn{get/set}`, `Number{get}`, `On{get/set}`, `PerspectiveOn{get/set}`, `PlotAsRaster{get}`, `PlotStyleSheet{get/set}`, `PlotWireframe{get}`, `RenderMode{get/set}`, `ShadePlot{get/set}`, `ShadePlotId{get}`, `SnapAngle{get/set}`, `SnapBasePoint{get/set}`, `SnapIncrement{get/set}`, `SnapIsometric{get/set}`, `SnapIsoPair{get/set}`, `SnapOn{get/set}`, `StandardScale{get/set}`, `SunId{get}`, `Thumbnail{get/set}`, `Transparent{get/set}`, `TwistAngle{get/set}`, `UcsFollowModeOn{get/set}`, `UcsIconAtOrigin{get/set}`, `UcsIconVisible{get/set}`, `UcsName{get}`, `UcsOrthographic{get}`, `UcsPerViewport{get/set}`, `ViewCenter{get/set}`, `ViewDirection{get/set}`, `ViewHeight{get/set}`, `ViewOrthographic{get}`, `ViewTarget{get/set}`, `VisualStyleId{get/set}`, `Width{get/set}`
- `Teigha.DatabaseServices.ViewportTable` — class；构造器：0
- `Teigha.DatabaseServices.ViewportTableRecord` — class；构造器：1；方法：`GetPreviousBackground`, `SetPreviousBackground`；属性：`CircleSides{get/set}`, `FastZoomsEnabled{get/set}`, `GridAdaptive{get/set}`, `GridBoundToLimits{get/set}`, `GridEnabled{get/set}`, `GridFollow{get/set}`, `GridIncrements{get/set}`, `GridMajor{get/set}`, `GridSubdivisionRestricted{get/set}`, `IconAtOrigin{get/set}`, `IconEnabled{get/set}`, `IsometricSnapEnabled{get/set}`, `LowerLeftCorner{get/set}`, `SnapAngle{get/set}`, `SnapBase{get/set}`, `SnapEnabled{get/set}`, `SnapIncrements{get/set}`, `SnapPair{get/set}`, `UcsFollowMode{get/set}`, `UcsSavedWithViewport{get/set}`, `UpperRightCorner{get/set}`
- `Teigha.DatabaseServices.ViewRepBlockReference` — class；构造器：1；属性：`OwnerViewportId{get}`
- `Teigha.DatabaseServices.ViewTable` — class；构造器：0
- `Teigha.DatabaseServices.ViewTableRecord` — class；构造器：1；方法：`DisassociateUcsFromView`；属性：`AnnotationScale{get/set}`, `CategoryName{get/set}`, `IsPaperspaceView{get/set}`, `IsUcsAssociatedToView{get}`, `LayerState{get/set}`, `Layout{get/set}`, `LiveSection{get/set}`, `Thumbnail{get/set}`, `ViewAssociatedToViewport{get/set}`
- `Teigha.DatabaseServices.ViewTableRecordRenderMode` — enum；枚举值：7
- `Teigha.DatabaseServices.Visibility` — enum；枚举值：2
- `Teigha.DatabaseServices.WblockNoticeEventArgs` — class；构造器：0；属性：`To{get}`
- `Teigha.DatabaseServices.WblockNoticeEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.Wipeout` — class；构造器：1；方法：`SetFrom`；属性：`HasFrame{get/set}`
- `Teigha.DatabaseServices.Xline` — class；构造器：1；属性：`BasePoint{get/set}`, `SecondPoint{get/set}`, `UnitDir{get/set}`
- `Teigha.DatabaseServices.Xrecord` — class；构造器：1；属性：`Data{get/set}`, `MergeStyle{get/set}`, `XlateReferences{get/set}`
- `Teigha.DatabaseServices.XrefBeginOperationEventArgs` — class；构造器：0；属性：`FileName{get}`, `From{get}`
- `Teigha.DatabaseServices.XrefBeginOperationEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefComandeeredEventArgs` — class；构造器：0；属性：`From{get}`, `Id{get}`
- `Teigha.DatabaseServices.XrefComandeeredEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefFullSubentityPath` — class；构造器：0；方法：`AppendObjectId`, `DwgIn`, `DwgOut`, `DxfOut`×2, `GetObjectIds`, `XrefObjHandles`；属性：`SubentId{get/set}`
- `Teigha.DatabaseServices.XrefGraph` — class；构造器：0；方法：`GetXrefNode`×4, `MarkUnresolvedTrees`；属性：`HostDrawing{get}`
- `Teigha.DatabaseServices.XrefGraphNode` — class；构造器：0；属性：`BlockTableRecordId{get}`, `Database{get}`, `IsNested{get}`, `Name{get}`, `XrefNotificationStatus{get}`, `XrefStatus{get}`
- `Teigha.DatabaseServices.XrefNotificationStatus` — enum；枚举值：5
- `Teigha.DatabaseServices.XrefOperation` — enum；枚举值：9
- `Teigha.DatabaseServices.XrefPreXrefLockFileEventArgs` — class；构造器：0；属性：`btrId{get}`
- `Teigha.DatabaseServices.XrefPreXrefLockFileEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefRedirectedEventArgs` — class；构造器：0；属性：`NewId{get}`, `OldId{get}`
- `Teigha.DatabaseServices.XrefRedirectedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefStatus` — enum；枚举值：6
- `Teigha.DatabaseServices.XrefSubCommandAbortedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefSubCommandEndEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefSubCommandEventArgs` — class；构造器：0；属性：`btrIds{get}`, `btrNames{get}`, `paths{get}`, `xrefOp{get}`
- `Teigha.DatabaseServices.XrefSubCommandStartEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.DatabaseServices.XrefVetoableSubCommandEventArgs` — class；构造器：0；属性：`abortOp{get/set}`

#### `Teigha.DatabaseServices.Filters`

- `Teigha.DatabaseServices.Filters.Filter` — abstract class；构造器：0；属性：`IndexClass{get}`
- `Teigha.DatabaseServices.Filters.FilteredBlockIterator` — class；构造器：0；方法：`Accepts`, `AddToBuffer`, `Seek`, `Start`；属性：`BuffersForComposition{get}`, `EstimatedHitFraction{get}`, `Id{get}`, `Next{get}`
- `Teigha.DatabaseServices.Filters.Index` — abstract class；构造器：0；方法：`GetIterator`, `RebuildFull`；属性：`IsUptoDate{get}`, `LastUpdatedAt{get/set}`, `LastUpdatedAtU{get/set}`, `ObjectBeingIndexedId{get}`
- `Teigha.DatabaseServices.Filters.IndexUpdateData` — class；构造器：0；方法：`AddId`, `GetIdData`, `GetIdDataPtr`, `GetIdFlags`, `SetIdData`×2, `SetIdFlags`
- `Teigha.DatabaseServices.Filters.LayerFilter` — class；构造器：1；方法：`Add`, `GetAt`, `Remove`；属性：`IsValid{get}`, `LayerCount{get}`
- `Teigha.DatabaseServices.Filters.LayerIndex` — class；构造器：1；方法：`Compute`
- `Teigha.DatabaseServices.Filters.SpatialFilter` — class；构造器：1；方法：`ClipVolumeIntersectsExtents`, `GetQueryBounds`×2, `GetVolume`, `SetPerspectiveCamera`；属性：`ClipSpaceToWorldCoordinateSystemTransform{get}`, `Definition{get/set}`, `HasPerspectiveCamera{get}`, `OriginalInverseBlockTransform{get}`
- `Teigha.DatabaseServices.Filters.SpatialFilterDefinition` — struct；构造器：1；方法：`GetPoints`；属性：`BackClip{get}`, `Elevation{get}`, `Enabled{get}`, `FrontClip{get}`, `Normal{get}`
- `Teigha.DatabaseServices.Filters.SpatialFilterVolume` — struct；构造器：1；属性：`FromPoint{get}`, `ToPoint{get}`, `UpDirection{get}`, `ViewField{get}`
- `Teigha.DatabaseServices.Filters.SpatialIndex` — class；构造器：1

#### `Teigha.Export_Import`

- `Teigha.Export_Import.ColorPolicy` — enum；枚举值：3
- `Teigha.Export_Import.DwfFormat` — enum；枚举值：4
- `Teigha.Export_Import.DWFImageResource` — class；构造器：2；属性：`ColorDepth{get/set}`, `FileName{get/set}`, `Height{get/set}`, `Width{get/set}`
- `Teigha.Export_Import.DWFImport` — class；构造器：1；方法：`Import`；属性：`Properties{get}`
- `Teigha.Export_Import.DWFImportResult` — enum；枚举值：5
- `Teigha.Export_Import.DWFPageData` — class；构造器：2；属性：`Fonts{get/set}`, `Layout{get/set}`, `PageAuthor{get/set}`, `PageComments{get/set}`, `PageCompany{get/set}`, `PageCopyright{get/set}`, `PageDescription{get/set}`, `PageKeywords{get/set}`, `PageReviewers{get/set}`, `PageSubject{get/set}`, `PageTitle{get/set}`, `Preview{get/set}`, `Thumbnail{get/set}`
- `Teigha.Export_Import.DwfPageDataCollection` — class；构造器：1；方法：`Add`, `Contains`, `CopyTo`, `IndexOf`, `Insert`, `Remove`；属性：`Item{get/set}`
- `Teigha.Export_Import.DwfVersion` — enum；枚举值：4
- `Teigha.Export_Import.Export_Import` — struct；构造器：0；方法：`ExportBitmap`, `ExportDwf`, `ExportPDF`, `ExportSTL`, `Publish3d`
- `Teigha.Export_Import.ExportHatchesType` — enum；枚举值：3
- `Teigha.Export_Import.mDwf3dExportParams` — class；构造器：1；属性：`BackgroundColor{get/set}`, `Database{get/set}`, `FileName{get/set}`, `Palette{get/set}`, `Thumbnail{get/set}`, `Title{get/set}`, `Xsize{get/set}`, `Ysize{get/set}`
- `Teigha.Export_Import.mDwfExportParams` — class；构造器：1；属性：`BackgroundColor{get/set}`, `ColorMapOptimize{get/set}`, `Database{get/set}`, `EmbedAllFonts{get/set}`, `ExportInvisibleLayers{get/set}`, `ExportInvisibleText{get/set}`, `FileName{get/set}`, `ForceInitialViewToExtents{get/set}`, `Format{get/set}`, `InkedArea{get/set}`, `MaxPointsInPolygon{get/set}`, `MaxRasterResolution{get/set}`, `PageData{get/set}`, `Palette{get/set}`, `Password{get/set}`, `Publisher{get/set}`, `RGBToJpeg{get/set}`, `SkipLayerInfo{get/set}`, `SkipNamedViewsInfo{get/set}`, `SourceProductName{get/set}`, `UseHLR{get/set}`, `Version{get/set}`, `WideComments{get/set}`, `Xsize{get/set}`, `Ysize{get/set}`
- `Teigha.Export_Import.mPDFExportParams` — class；构造器：1；属性：`Archived{get/set}`, `ASCIIHEXEncodeStream{get/set}`, `Author{get/set}`, `BackgroundColor{get/set}`, `bwImagesDPI{get/set}`, `Color_Policy{get/set}`, `colorImagesDPI{get/set}`, `Creator{get/set}`, `CropImages{get/set}`, `Database{get/set}`, `DCTCompression{get/set}`, `DCTQuality{get/set}`, `EmbeddedOptimizedTTF{get/set}`, `ExportHyperlinks{get/set}`, `Flags{get/set}`, `FlateCompression{get/set}`, `GradientHatchesExportType{get/set}`, `hatchDPI{get/set}`, `Keywords{get/set}`, `Layouts{get/set}`, `Linearized{get/set}`, `Measuring{get/set}`, `MergeLines{get/set}`, `OtherHatchesExportType{get/set}`, `OutputStream{set}`, `PageParams{get/set}`, `Palette{get/set}`, `PrcBrepCompressionLevel{get/set}`, `PRCContext{get/set}`, `PRCMode{get/set}`, `PrcViewBackgroundColor{get/set}`, `Producer{get/set}`, `SearchTextType{get/set}`, `SolidHatchesExportType{get/set}`, `Subject{get/set}`, `Title{get/set}`, `UseHLR{get/set}`, `UsePrcBrepCompression{get/set}`, `UsePrcTessellationCompression{get/set}`, `UsePrcViewBackground{get/set}`, `vectorDPI{get/set}`, `Versions{get/set}`
- `Teigha.Export_Import.PDF_A_mode` — enum；枚举值：3
- `Teigha.Export_Import.PDFExportFlags` — enum；枚举值：9
- `Teigha.Export_Import.PDFExportVersions` — enum；枚举值：8
- `Teigha.Export_Import.PRCCompressionLevel` — enum；枚举值：3
- `Teigha.Export_Import.PRCSupport` — enum；枚举值：3
- `Teigha.Export_Import.SearchableTextType` — enum；枚举值：3

#### `Teigha.Geometry`

- `Teigha.Geometry.AugmentedPolylineCurve3d` — class；构造器：4；方法：`Create`, `GetD2VectorAt`, `GetPointAt`, `GetVectorAt`, `SetD2VectorAt`, `SetPointAt`, `SetVectorAt`；属性：`ApproximateTolerance{get/set}`, `D1Vectors{get}`, `D2Vectors{get}`, `Points{get}`
- `Teigha.Geometry.BoundBlock2d` — class；构造器：4；方法：`Contains`, `Create`, `Extend`, `GetMaximumPoint`, `GetMinimumPoint`, `IsDisjoint`, `Set`×2, `Swell`；属性：`BasePoint{get}`, `Direction1{get}`, `Direction2{get}`, `IsBox{get/set}`
- `Teigha.Geometry.BoundBlock3d` — class；构造器：2；方法：`center`, `Contains`, `Create`, `Extend`, `GetMaximumPoint`, `GetMinimumPoint`, `IsDisjoint`, `Set`×2, `Swell`, `TransformBy`；属性：`BasePoint{get}`, `Direction1{get}`, `Direction2{get}`, `Direction3{get}`, `IsBox{get/set}`
- `Teigha.Geometry.BoundedPlane` — class；构造器：3；方法：`Create`, `IntersectWith`×4, `Set`×2
- `Teigha.Geometry.CircularArc2d` — class；构造器：5；方法：`Create`, `GetTangent`×2, `IntersectWith`×4, `IsInside`×2, `Set`×6, `SetAngles`, `SetToComplement`；属性：`Center{get/set}`, `EndAngle{get}`, `EndPoint{get}`, `IsClockWise{get}`, `Radius{get/set}`, `ReferenceVector{get/set}`, `StartAngle{get}`, `StartPoint{get}`
- `Teigha.Geometry.CircularArc3d` — class；构造器：4；方法：`ClosestPointToPlane`×2, `Create`, `GetPlane`, `GetTangent`×2, `IntersectWith`×6, `IsInside`×2, `ProjectedIntersectWith`×2, `Set`×5, `SetAngles`, `SetAxes`；属性：`Center{get/set}`, `EndAngle{get}`, `EndPoint{get}`, `Normal{get}`, `Radius{get/set}`, `ReferenceVector{get}`, `StartAngle{get}`, `StartPoint{get}`
- `Teigha.Geometry.ClipBoundary2d` — class；构造器：3；方法：`ClipPolygon`, `ClipPolyline`, `Create`, `Set`×2
- `Teigha.Geometry.ClipBoundary2dData` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`ClipCondition{get}`, `ClippedSegmentSourceLabel{get}`, `ClippedVertices{get}`
- `Teigha.Geometry.ClipCondition` — enum；枚举值：0
- `Teigha.Geometry.ClipError` — enum；枚举值：0
- `Teigha.Geometry.CompositeCurve2d` — class；构造器：1；方法：`Create`, `GetCurves`, `GlobalToLocalParameter`, `LocalToGlobalParameter`, `SetCurves`
- `Teigha.Geometry.CompositeCurve3d` — class；构造器：1；方法：`Create`, `GetCurves`, `GlobalToLocalParameter`, `LocalToGlobalParameter`
- `Teigha.Geometry.CompositeParameter` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`；属性：`LocalParameter{get}`, `SegmentIndex{get}`
- `Teigha.Geometry.Cone` — class；构造器：3；方法：`Create`, `GetAngles`, `GetHalfAngles`, `GetHeightAt`, `IntersectWith`×2, `IsClosed`×2, `Set`×2, `SetAngles`；属性：`Apex{get}`, `AxisOfSymmetry{get}`, `BaseCenter{get}`, `BaseRadius{get/set}`, `HalfAngle{get}`, `Height{get/set}`, `IsOuterNormal{get}`, `ReferenceAxis{get}`
- `Teigha.Geometry.CoordinateSystem2d` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×3；属性：`Origin{get}`, `Xaxis{get}`, `Yaxis{get}`
- `Teigha.Geometry.CoordinateSystem3d` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×3；属性：`Origin{get}`, `Xaxis{get}`, `Yaxis{get}`, `Zaxis{get}`
- `Teigha.Geometry.CubicSplineCurve2d` — class；构造器：7；方法：`Create`, `GetFirstDerivativeAt`, `GetFitPointAt`, `SetFirstDerivativeAt`, `SetFitPointAt`；属性：`NumFitPoints{get}`
- `Teigha.Geometry.CubicSplineCurve3d` — class；构造器：7；方法：`Create`, `FirstDerivativeAt`, `FitPointAt`, `SetFirstDerivativeAt`, `SetFitPointAt`；属性：`NumberOfFitPoints{get}`
- `Teigha.Geometry.Curve2d` — abstract class；构造器：0；方法：`Create`, `EvaluatePoint`, `Explode`, `GetArea`×2, `GetBoundBlockOf`, `GetClosestPointTo`×4, `GetDistanceTo`×4, `GetInterval`, `GetLength`×2, `GetNormalPoint`×2, `GetOrthoBoundBlockOf`, `GetParameterAtLength`×2, `GetParameterOf`×2, `GetReverseParameterCurve`, `GetSamplePoints`×2, `GetSplitCurves`, `GetTrimmedOffset`×2, `IsClosed`×2, `IsDegenerate`×2, `IsLinear`×2, `IsOn`×6, `IsPeriodic`, `SetInterval`；属性：`BoundBlock{get}`, `EndPoint{get}`, `HasEndPoint{get}`, `HasStartPoint{get}`, `OrthoBoundBlock{get}`, `StartPoint{get}`
- `Teigha.Geometry.Curve2dCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `Item{get/set}`
- `Teigha.Geometry.Curve3d` — abstract class；构造器：0；方法：`Create`, `EvaluatePoint`, `Explode`, `GetArea`×2, `GetBoundBlockOf`, `GetClosestPointTo`×4, `GetDistanceTo`×4, `GetInterval`, `GetLength`, `GetNormalPoint`×2, `GetOrthoBoundBlockOf`, `GetOrthoProjectEntity`×2, `GetParameterAtLength`, `GetParameterOf`×2, `GetProjectedClosestPointTo`×4, `GetProjectedEntity`×2, `GetReverseParameterCurve`, `GetSamplePoints`×2, `GetSplitCurves`, `GetTrimmedOffset`×2, `IsClosed`×2, `IsCoplanarWith`×2, `IsDegenerate`×2, `IsLinear`×2, `IsOn`×6, `IsPeriodic`, `IsPlanar`×2, `SetInterval`；属性：`BoundBlock{get}`, `EndPoint{get}`, `HasEndPoint{get}`, `HasStartPoint{get}`, `OrthoBoundBlock{get}`, `StartPoint{get}`
- `Teigha.Geometry.Curve3dCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `Item{get/set}`
- `Teigha.Geometry.CurveBoundary` — class；构造器：2；方法：`Clone`, `Create`, `Set`, `SetToOwnCurves`；属性：`Contour{get/set}`, `DegenerateCurve{get}`, `DegeneratePosition{get}`, `IsDegenerate{get}`, `IsOwnerOfCurves{get}`, `NumElements{get}`
- `Teigha.Geometry.CurveBoundaryData` — struct；构造器：0；方法：`Equals`, `GetCurve2ds`, `GetCurve3ds`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`Orientation2d{get}`, `Orientation3d{get}`
- `Teigha.Geometry.CurveCurveIntersector2d` — class；构造器：6；方法：`ChangeCurveOrder`, `Create`, `GetIntersectionParameters`, `GetIntersectionPoint`, `GetIntersectionPointTolerance`, `GetIntersectionRanges`, `GetOverlapRanges`, `GetPointOnCurve1`, `GetPointOnCurve2`, `IsTangential`, `IsTransversal`, `OrderWithRegardsTo1`, `OrderWithRegardsTo2`, `Set`×4；属性：`Curve1{get}`, `Curve2{get}`, `NumberOfIntersectionPoints{get}`, `OverlapCount{get}`, `OverlapDirection{get}`, `Tolerance{get}`
- `Teigha.Geometry.CurveCurveIntersector3d` — class；构造器：5；方法：`ChangeCurveOrder`, `Create`, `GetIntersectionParameters`, `GetIntersectionPoint`, `GetIntersectionPointTolerance`, `GetIntersectionRanges`, `GetOverlapRanges`, `GetPointOnCurve1`, `GetPointOnCurve2`, `IsTangential`, `IsTransversal`, `OrderWithRegardsTo1`, `OrderWithRegardsTo2`, `OverlapCount`, `OverlapDirection`, `Set`×4；属性：`Curve1{get}`, `Curve2{get}`, `NumberOfIntersectionPoints{get}`, `PlaneNormal{get}`, `Tolerance{get}`
- `Teigha.Geometry.Cylinder` — class；构造器：3；方法：`Create`, `GetAngles`, `GetHeightAt`, `IntersectWith`×2, `IsClosed`×2, `Set`×2, `SetAngles`；属性：`AxisOfSymmetry{get}`, `Height{get/set}`, `IsOuterNormal{get}`, `Origin{get}`, `Radius{get/set}`, `ReferenceAxis{get}`
- `Teigha.Geometry.DoubleCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IEnumerable_GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.DoubleCollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `IEnumerator_Current{get}`
- `Teigha.Geometry.EllipticalArc2d` — class；构造器：4；方法：`Create`, `IntersectWith`×2, `IsCircular`×2, `IsInside`×2, `Set`×3, `SetAngles`, `SetAxes`；属性：`Center{get/set}`, `EndAngle{get}`, `EndPoint{get}`, `IsClockWise{get}`, `MajorAxis{get}`, `MajorRadius{get/set}`, `MinorAxis{get}`, `MinorRadius{get/set}`, `StartAngle{get}`, `StartPoint{get}`
- `Teigha.Geometry.EllipticalArc3d` — class；构造器：3；方法：`ClosestPointToPlane`×2, `Create`, `GetPlane`, `IntersectWith`×4, `IsCircular`×2, `IsInside`×2, `ProjectedIntersectWith`×2, `Set`×2, `SetAngles`, `SetAxes`；属性：`Center{get/set}`, `EndAngle{get}`, `EndPoint{get}`, `MajorAxis{get}`, `MajorRadius{get/set}`, `MinorAxis{get}`, `MinorRadius{get/set}`, `Normal{get}`, `StartAngle{get}`, `StartPoint{get}`
- `Teigha.Geometry.EllipticalCone` — class；构造器：3；方法：`Create`, `GetAngles`, `GetHalfAngles`, `GetHeightAt`, `IsClosed`×2, `Set`×2, `SetAngles`；属性：`Apex{get}`, `AxisOfSymmetry{get}`, `BaseCenter{get}`, `HalfAngle{get}`, `Height{get/set}`, `IsOuterNormal{get}`, `MajorAxis{get}`, `MajorRadius{get/set}`, `MinorAxis{get}`, `MinorRadius{get/set}`, `RadiusRatio{get}`
- `Teigha.Geometry.EllipticalCylinder` — class；构造器：3；方法：`Create`, `GetAngles`, `GetHeightAt`, `IntersectWith`×2, `IsClosed`×2, `Set`×2, `SetAngles`；属性：`Height{get/set}`, `IsOuterNormal{get/set}`, `MajorAxis{get}`, `MajorRadius{get/set}`, `MinorAxis{get}`, `MinorRadius{get/set}`, `Origin{get}`, `RadiusRatio{get}`
- `Teigha.Geometry.Entity2d` — abstract class；构造器：0；方法：`Clone`, `Create`, `IsEqualTo`×2, `IsOn`×2, `Mirror`, `RotateBy`, `ScaleBy`, `TransformBy`, `TranslateBy`
- `Teigha.Geometry.Entity3d` — abstract class；构造器：0；方法：`Clone`, `Create`, `IsEqualTo`×2, `IsOn`×2, `Mirror`, `RotateBy`, `ScaleBy`, `TransformBy`, `TranslateBy`
- `Teigha.Geometry.ExternalBoundedSurface` — class；构造器：2；方法：`Create`, `GetContours`, `Set`, `SetToOwnSurface`；属性：`BaseSurface{get}`, `ExternalBaseSurface{get}`, `ExternalSurfaceDefinition{get}`, `ExternalSurfaceKind{get}`, `IsCone{get}`, `IsCylinder{get}`, `IsDefined{get}`, `IsEllipCone{get}`, `IsEllipCylinder{get}`, `IsExternalSurface{get}`, `IsNurbs{get}`, `IsOwnerOfSurface{get}`, `IsPlane{get}`, `IsSphere{get}`, `IsTorus{get}`, `NumContours{get}`
- `Teigha.Geometry.ExternalCurve2d` — class；构造器：2；方法：`Create`, `Set`, `SetToOwnCurve`；属性：`ExternalCurve{get}`, `ExternalCurveKind{get}`, `IsDefined{get}`, `IsNurbCurve{get}`, `IsOwnerOfCurve{get}`, `NurbCurve{get}`
- `Teigha.Geometry.ExternalCurve3d` — class；构造器：1；方法：`Create`, `Set`, `SetToOwnCurve`；属性：`ExternalCurve{get}`, `ExternalCurveKind{get}`, `IsCircularArc{get}`, `IsDefined{get}`, `IsEllipticalArc{get}`, `IsLine{get}`, `IsLineSegment{get}`, `IsNativeCurve{get}`, `IsNurbCurve{get}`, `IsOwnerOfCurve{get}`, `IsRay{get}`, `NativeCurve{get}`
- `Teigha.Geometry.ExternalEntityKind` — enum；枚举值：4
- `Teigha.Geometry.ExternalSurface` — class；构造器：2；方法：`Create`, `Set`, `SetToOwnSurface`；属性：`ExternalSurfaceDefiniton{get}`, `ExternalSurfaceKind{get}`, `IsCone{get}`, `IsCylinder{get}`, `IsDefined{get}`, `IsEllipCone{get}`, `IsEllipCylinder{get}`, `IsNativeSurface{get}`, `IsNurbSurface{get}`, `IsOwnerOfSurface{get}`, `IsPlane{get}`, `IsSphere{get}`, `IsTorus{get}`, `nativeSurface{get}`
- `Teigha.Geometry.GeoDataLonLatAltInfo` — struct；构造器：1；属性：`Altitude{get/set}`, `Latitude{get/set}`, `Longitude{get/set}`
- `Teigha.Geometry.Int32Collection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IEnumerable_GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.Int32CollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `IEnumerator_Current{get}`
- `Teigha.Geometry.IntegerCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.IntegerCollectionEnumerator` — class；构造器：1；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `IEnumerator_Current{get}`
- `Teigha.Geometry.Interval` — class；构造器：4；方法：`Contains`×2, `GetBounds`, `GetMerge`, `IntersectWith`, `IsContinuousAtUpper`, `IsDisjoint`, `IsEqualAtLower`×2, `IsEqualAtUpper`×2, `IsOverlapAtUpper`, `IsPeriodicallyOn`, `Subtract`；属性：`Element{get}`, `IsBounded{get}`, `IsBoundedAbove{get}`, `IsBoundedBelow{get}`, `IsSingleton{get}`, `IsUnbounded{get}`, `Length{get}`, `LowerBound{get}`, `Tolerance{get}`, `Unbounded{get}`, `UpperBound{get}`
- `Teigha.Geometry.IntPtrCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IEnumerable_GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.IntPtrCollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `IEnumerator_Current{get}`
- `Teigha.Geometry.KnotCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetDistinctKnots`, `GetEnumerator`, `GetInterval`, `GetMultiplicityAt`, `Insert`, `IsOn`, `RemoveAt`, `Reverse`, `SetRange`, `Split`；属性：`Count{get}`, `EndParameter{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `NumberOfIntervals{get}`, `StartParameter{get}`, `SyncRoot{get}`, `Tolerance{get/set}`
- `Teigha.Geometry.KnotParameterizationEnum` — enum；枚举值：4
- `Teigha.Geometry.Line2d` — class；构造器：3；方法：`Create`, `Set`×2
- `Teigha.Geometry.Line2dCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.Geometry.Line3d` — class；构造器：3；方法：`Create`, `Set`×2
- `Teigha.Geometry.LinearEntity2d` — abstract class；构造器：0；方法：`Create`, `GetLine`, `GetPerpendicularLine`, `IntersectWith`×2, `IsColinearTo`×2, `IsParallelTo`×2, `IsPerpendicularTo`×2, `Overlap`×2；属性：`Direction{get}`, `PointOnLine{get}`
- `Teigha.Geometry.LinearEntity3d` — abstract class；构造器：0；方法：`Create`, `GetLine`, `GetPerpendicularPlane`, `IntersectWith`×4, `IsColinearTo`×2, `IsOn`×2, `IsParallelTo`×4, `IsPerpendicularTo`×4, `Overlap`×2, `ProjectedIntersectWith`×2；属性：`Direction{get}`, `PointOnLine{get}`
- `Teigha.Geometry.LineSegment2d` — class；构造器：3；方法：`BaryComb`, `Create`, `GetBisector`, `GetSegmentLength`×2, `Set`×4；属性：`EndPoint{get}`, `Length{get}`, `MidPoint{get}`, `StartPoint{get}`
- `Teigha.Geometry.LineSegment3d` — class；构造器：3；方法：`BaryComb`, `Create`, `GetBisector`, `Set`×4；属性：`EndPoint{get}`, `Length{get}`, `MidPoint{get}`, `StartPoint{get}`
- `Teigha.Geometry.Matrix2d` — struct；构造器：1；方法：`AlignCoordinateSystem`, `Displacement`, `Equals`, `GetDeterminant`, `GetHashCode`, `GetScale`, `Inverse`, `IsConformal`, `IsEqualTo`×2, `IsScaledOrtho`×2, `IsSingular`×2, `IsUniscaledOrtho`×2, `Mirroring`×2, `Multiply`, `op_Equality`, `op_Inequality`, `op_Multiply`, `PostMultiplyBy`, `PreMultiplyBy`, `Rotation`, `Scaling`, `ToArray`, `ToString`×3, `Transpose`；属性：`CoordinateSystem2d{get}`, `ElementAt{get}`, `Translation{get}`
- `Teigha.Geometry.Matrix2dBuilder` — class；构造器：2；方法：`ToMatrix2d`；属性：`ElementAt{get/set}`
- `Teigha.Geometry.Matrix2dInfo` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Angle{get}`, `IsMirror{get}`, `Reflex{get}`, `Scale{get}`
- `Teigha.Geometry.Matrix3d` — struct；构造器：1；方法：`AlignCoordinateSystem`, `Displacement`, `Equals`, `GetDeterminant`, `GetHashCode`, `GetScale`, `Inverse`, `IsEqualTo`×2, `IsInverse`×2, `IsScaledOrtho`×2, `IsSingular`×2, `IsUniscaledOrtho`×2, `Mirroring`×3, `op_Equality`, `op_Inequality`, `op_Multiply`, `PlaneToWorld`×2, `PostMultiplyBy`, `PreMultiplyBy`, `Projection`, `Rotation`, `Scaling`, `ToArray`, `ToString`×3, `Transpose`, `WorldToPlane`×2；属性：`CoordinateSystem3d{get}`, `ElementAt{get}`, `Identity{get}`, `Normal{get}`, `Translation{get}`
- `Teigha.Geometry.Matrix3dBuilder` — class；构造器：2；方法：`ToMatrix3d`；属性：`ElementAt{get/set}`
- `Teigha.Geometry.NurbCurve2d` — class；构造器：14；方法：`AddControlPointAt`, `AddFitPointAt`, `AddKnot`, `Create`, `DeleteControlPointAt`, `DeleteFitPointAt`, `ElevateDegree`, `GetFitPointAt`, `GetFitTangents`, `GetParametersOfC1Discontinuity`×2, `GetParametersOfG1Discontinuity`×2, `GetWeightAt`, `HardTrimByParams`, `InsertKnot`, `JoinWith`, `MakeClosed`, `MakeNonPeriodic`, `MakeOpen`, `MakePeriodic`, `MakeRational`, `PurgeFitData`, `SetEvaluateMode`, `SetFitData`×7, `SetFitPointAt`, `SetFitTangents`, `SetWeightAt`；属性：`DefinitionData{get}`, `EvalMode{get}`, `FitData{get}`, `FitKnotParameterization{get/set}`, `FitTolerance{get/set}`, `NumFitPoints{get}`, `NumWeights{get}`
- `Teigha.Geometry.NurbCurve2dData` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`ControlPoints{get}`, `Degree{get}`, `Knots{get}`, `Periodic{get}`, `Rational{get}`, `Weights{get}`
- `Teigha.Geometry.NurbCurve2dFitData` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`Degree{get}`, `EndTangent{get}`, `FitPoints{get}`, `FitTolerance{get}`, `KnotParam{get}`, `StartTangent{get}`, `TangentsExist{get}`
- `Teigha.Geometry.NurbCurve3d` — class；构造器：14；方法：`AddControlPointAt`, `AddFitPointAt`, `AddKnot`, `Create`, `DeleteControlPointAt`, `DeleteFitPointAt`, `ElevateDegree`, `GetFitPointAt`, `GetFitTangents`, `GetParametersOfC1Discontinuity`×2, `GetParametersOfG1Discontinuity`×2, `GetWeightAt`, `HardTrimByParams`, `InsertKnot`, `JoinWith`, `MakeClosed`, `MakeNonPeriodic`, `MakeOpen`, `MakePeriodic`, `MakeRational`, `PurgeFitData`, `SetEvaluateMode`, `SetFitData`×7, `SetFitPointAt`, `SetFitTangents`, `SetWeightAt`；属性：`DefinitionData{get}`, `EvalMode{get}`, `FitData{get}`, `FitKnotParameterization{get/set}`, `FitTolerance{get/set}`, `NumFitPoints{get}`, `NumWeights{get}`
- `Teigha.Geometry.NurbCurve3dData` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`ControlPoints{get}`, `Degree{get}`, `Knots{get}`, `Periodic{get}`, `Rational{get}`, `Weights{get}`
- `Teigha.Geometry.NurbCurve3dFitData` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`Degree{get}`, `EndTangent{get}`, `FitPoints{get}`, `FitTolerance{get}`, `KnotParam{get}`, `StartTangent{get}`, `TangentsExist{get}`
- `Teigha.Geometry.NurbSurface` — class；构造器：3；方法：`Create`, `GetDefinition`, `Set`×2；属性：`ControlPoints{get}`, `DegreeInU{get}`, `DegreeInV{get}`, `IsPeriodicInU{get}`, `IsPeriodicInV{get}`, `IsRationalInU{get}`, `IsRationalInV{get}`, `NumControlPointsInU{get}`, `NumControlPointsInV{get}`, `NumKnotsInU{get}`, `NumKnotsInV{get}`, `PeriodicInU{get}`, `PeriodicInV{get}`, `SingularityInU{get}`, `SingularityInV{get}`, `UKnots{get}`, `VKnots{get}`, `Weights{get}`
- `Teigha.Geometry.NurbSurfaceDefinition` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`ControlPoints{get}`, `DegreeInU{get}`, `DegreeInV{get}`, `NumberOfControlPointsInU{get}`, `NumberOfControlPointsInV{get}`, `PropertiesInU{get}`, `PropertiesInV{get}`, `UKnots{get}`, `VKnots{get}`, `Weights{get}`
- `Teigha.Geometry.OffsetCurve2d` — class；构造器：1；方法：`Create`；属性：`Curve{get/set}`, `OffsetDistance{get/set}`, `ParameterDirection{get}`, `Transformation{get}`
- `Teigha.Geometry.OffsetCurve3d` — class；构造器：1；方法：`Create`；属性：`Curve{get/set}`, `Normal{get/set}`, `OffsetDistance{get/set}`, `ParameterDirection{get}`, `Transformation{get}`
- `Teigha.Geometry.OffsetCurveExtensionType` — enum；枚举值：3
- `Teigha.Geometry.OffsetSurface` — class；构造器：2；方法：`Create`, `Set`；属性：`ConstructionSurface{get}`, `IsBoundedPlane{get}`, `IsCone{get}`, `IsCylinder{get}`, `IsPlane{get}`, `IsSphere{get}`, `IsTorus{get}`, `OffsetDist{get}`, `OriginalSurface{get}`
- `Teigha.Geometry.PlanarEntity` — abstract class；构造器：0；方法：`ClosestPointToLinearEntity`×2, `ClosestPointToPlanarEntity`×2, `Create`, `Equals`, `GetCoordinateSystem`, `IntersectWith`×2, `IsCoplanarTo`×2, `IsParallelTo`×4, `IsPerpendicularTo`×4；属性：`Coefficients{get}`, `Normal{get}`, `PointOnPlane{get}`
- `Teigha.Geometry.PlanarEquationCoefficients` — struct；构造器：1；属性：`A{get}`, `B{get}`, `C{get}`, `D{get}`
- `Teigha.Geometry.Plane` — class；构造器：6；方法：`Create`, `GetSignedDistanceTo`, `IntersectWith`×4, `Set`×4
- `Teigha.Geometry.Point2d` — struct；构造器：2；方法：`Add`, `DivideBy`, `Equals`, `GetAsVector`, `GetDistanceTo`, `GetHashCode`, `GetVectorTo`, `IsEqualTo`×2, `Mirror`, `MultiplyBy`, `op_Addition`, `op_Division`, `op_Equality`, `op_Inequality`, `op_Multiply`×3, `op_Subtraction`×2, `RotateBy`, `ScaleBy`, `Subtract`, `ToArray`, `ToString`×3, `TransformBy`；属性：`Coordinate{get}`, `Origin{get}`, `X{get}`, `Y{get}`
- `Teigha.Geometry.Point2dCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.Point3d` — struct；构造器：3；方法：`Add`, `Convert2d`, `DistanceTo`, `DivideBy`, `Equals`, `GetAsVector`, `GetHashCode`, `GetVectorTo`, `IsEqualTo`×2, `Mirror`, `MultiplyBy`, `op_Addition`, `op_Division`, `op_Equality`, `op_Inequality`, `op_Multiply`×3, `op_Subtraction`×2, `OrthoProject`, `Project`, `RotateBy`, `ScaleBy`, `Subtract`, `ToArray`, `ToString`×3, `TransformBy`；属性：`Coordinate{get}`, `Origin{get}`, `X{get}`, `Y{get}`, `Z{get}`
- `Teigha.Geometry.Point3dCollection` — class；构造器：2；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`；属性：`Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`
- `Teigha.Geometry.PointEntity2d` — abstract class；构造器：0；方法：`Create`；属性：`Point{get}`
- `Teigha.Geometry.PointEntity3d` — abstract class；构造器：0；方法：`Create`, `GetPoint`
- `Teigha.Geometry.PointOnCurve2d` — class；构造器：3；方法：`Create`, `GetDerivative`×3, `GetPointAtParameter`, `GetPointOnCurve`；属性：`Curve{get/set}`, `Parameter{get/set}`, `Point{get}`
- `Teigha.Geometry.PointOnCurve3d` — class；构造器：2；方法：`Create`, `GetCurvature`×2, `GetDerivative`×3, `GetPointAtParameter`, `GetPointOnCurve`, `IsSingular`×2；属性：`Curve{get/set}`, `Parameter{get/set}`, `Point{get}`
- `Teigha.Geometry.PointOnSurface` — class；构造器：2；方法：`Create`, `GetInverseTangentVector`×3, `GetMixedPartial`×3, `GetNormal`×3, `GetPoint`×2, `GetTangentVector`×3, `GetUDerivative`×3, `GetVDerivative`×3；属性：`Parameter{get/set}`, `Surface{get/set}`
- `Teigha.Geometry.PolylineCurve2d` — class；构造器：4；方法：`Create`, `FitPointAt`, `SetFitPointAt`；属性：`NumberOfFitPoints{get}`
- `Teigha.Geometry.PolylineCurve3d` — class；构造器：4；方法：`Create`, `FitPointAt`, `SetFitPointAt`；属性：`NumberOfFitPoints{get}`
- `Teigha.Geometry.Position2d` — class；构造器：3；方法：`Create`, `Set`×2
- `Teigha.Geometry.Position3d` — class；构造器：3；方法：`Create`, `Set`×2
- `Teigha.Geometry.Ray2d` — class；构造器：3；方法：`Create`, `Set`×2
- `Teigha.Geometry.Ray3d` — class；构造器：3；方法：`Create`, `Set`×2
- `Teigha.Geometry.Scale2d` — struct；构造器：3；方法：`Equals`, `ExtractScale`, `GetHashCode`, `GetMatrix`, `Inverse`, `IsEqualTo`×2, `IsProportional`×2, `MultiplyBy`, `op_Equality`, `op_Inequality`, `op_Multiply`×3, `PostMultiplyBy`, `PreMultiplyBy`, `RemoveScale`, `ToArray`, `ToString`×2；属性：`Coordinate{get}`, `X{get}`, `Y{get}`
- `Teigha.Geometry.Scale3d` — struct；构造器：3；方法：`Equals`, `ExtractScale`, `GetHashCode`, `GetMatrix`, `Inverse`, `IsEqualTo`×2, `IsProportional`×2, `MultiplyBy`, `op_Equality`, `op_Inequality`, `op_Multiply`×3, `PostMultiplyBy`, `PreMultiplyBy`, `RemoveScale`, `ToArray`, `ToString`×2；属性：`Coordinate{get}`, `X{get}`, `Y{get}`, `Z{get}`
- `Teigha.Geometry.Sphere` — class；构造器：3；方法：`Create`, `GetAnglesInU`, `GetAnglesInV`, `IntersectWith`×2, `IsClosed`×2, `Set`×2, `SetAnglesInU`, `SetAnglesInV`；属性：`Center{get}`, `IsOuterNormal{get}`, `NorthAxis{get}`, `NorthPole{get}`, `Radius{get/set}`, `ReferenceAxis{get}`, `SouthPole{get}`
- `Teigha.Geometry.SplineEntity2d` — abstract class；构造器：0；方法：`Create`, `GetContinuityAtKnot`×2, `GetControlPointAt`, `GetKnotAt`, `SetControlPointAt`, `SetKnotAt`；属性：`Degree{get}`, `EndParameter{get}`, `EndPoint{get}`, `HasFitData{get}`, `IsRational{get}`, `Knots{get}`, `NumControlPoints{get}`, `NumKnots{get}`, `Order{get}`, `StartParameter{get}`, `StartPoint{get}`
- `Teigha.Geometry.SplineEntity3d` — abstract class；构造器：0；方法：`ControlPointAt`, `Create`, `GetContinuityAtKnot`×2, `KnotAt`, `SetControlPointAt`, `SetKnotAt`；属性：`Degree{get}`, `EndParameter{get}`, `EndPoint{get}`, `HasFitData{get}`, `IsRational{get}`, `Knots{get}`, `NumberOfControlPoints{get}`, `NumberOfKnots{get}`, `Order{get}`, `StartParameter{get}`, `StartPoint{get}`
- `Teigha.Geometry.Surface` — abstract class；构造器：0；方法：`ClosestPointTo`×2, `Create`, `DistanceTo`×2, `EvaluatePoint`, `GetClosestPointTo`×2, `GetEnvelope`, `IsClosedInU`×2, `IsClosedInV`×2, `IsOn`×2, `ParameterOf`×2；属性：`IsNormalReversed{get}`, `ReverseNormal{get}`
- `Teigha.Geometry.SurfaceCurve2dTo3d` — class；构造器：0；方法：`Create`；属性：`GeometricExtents{get}`
- `Teigha.Geometry.SurfaceSurfaceIntersector` — class；构造器：3；方法：`Create`, `GetDimension`, `GetIntersectionConfigurations`, `GetIntersectPointParameters`, `GetType`, `IntersectCurve`, `IntersectParameterCurve`, `IntersectPoint`, `Set`×2；属性：`NumResults{get}`, `Surface1{get}`, `Surface2{get}`, `Tolerance{get}`
- `Teigha.Geometry.SurfaceSurfaceIntersectorConfiguration` — enum；枚举值：4
- `Teigha.Geometry.SurfaceSurfaceIntersectorConfigurations` — struct；构造器：0；方法：`Equals`, `GetHashCode`, `IsEqualTo`, `op_Equality`, `op_Inequality`；属性：`Dimension{get}`, `IntersectionType{get}`, `Surface1Left{get}`, `Surface1Right{get}`, `Surface2Left{get}`, `Surface2Right{get}`
- `Teigha.Geometry.SurfaceSurfaceIntersectorType` — enum；枚举值：3
- `Teigha.Geometry.Tolerance` — struct；构造器：1；属性：`EqualPoint{get}`, `EqualVector{get}`, `Global{get/set}`
- `Teigha.Geometry.Torus` — class；构造器：3；方法：`Create`, `GetAnglesInU`, `GetAnglesInV`, `IntersectWith`×2, `Set`×2, `SetAnglesInU`, `SetAnglesInV`；属性：`AxisOfSymmetry{get}`, `Center{get}`, `IsApple{get}`, `IsDegenerate{get}`, `IsDoughnut{get}`, `IsHollow{get}`, `IsLemon{get}`, `IsOuterNormal{get}`, `IsVortex{get}`, `MajorRadius{get/set}`, `MinorRadius{get/set}`, `ReferenceAxis{get}`
- `Teigha.Geometry.UInt32Collection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IEnumerable_GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.UInt32CollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `IEnumerator_Current{get}`
- `Teigha.Geometry.Vector2d` — struct；构造器：2；方法：`Add`, `DivideBy`, `DotProduct`, `Equals`, `GetAngleTo`, `GetHashCode`, `GetNormal`×2, `GetPerpendicularVector`, `IsCodirectionalTo`×2, `IsEqualTo`×2, `IsParallelTo`×2, `IsPerpendicularTo`×2, `IsUnitLength`×2, `IsZeroLength`×2, `Mirror`, `MultiplyBy`, `Negate`, `op_Addition`, `op_Division`, `op_Equality`, `op_Inequality`, `op_Multiply`×3, `op_Subtraction`, `op_UnaryNegation`, `RotateBy`, `Subtract`, `ToArray`, `ToString`×3, `TransformBy`；属性：`Angle{get}`, `Coordinate{get}`, `Length{get}`, `LengthSqrd{get}`, `X{get}`, `XAxis{get}`, `Y{get}`, `YAxis{get}`
- `Teigha.Geometry.Vector2dCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.Vector2dCollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`
- `Teigha.Geometry.Vector3d` — struct；构造器：3；方法：`Add`, `AngleOnPlane`, `Convert2d`, `CrossProduct`, `DivideBy`, `DotProduct`, `Equals`, `GetAngleTo`×2, `GetHashCode`, `GetNormal`×2, `GetPerpendicularVector`, `IsCodirectionalTo`×2, `IsEqualTo`×2, `IsParallelTo`×2, `IsPerpendicularTo`×2, `IsUnitLength`×2, `IsZeroLength`×2, `Mirror`, `MultiplyBy`, `Negate`, `op_Addition`, `op_Division`, `op_Equality`, `op_Inequality`, `op_Multiply`×3, `op_Subtraction`, `op_UnaryNegation`, `OrthoProjectTo`, `ProjectTo`, `RotateBy`, `Subtract`, `ToArray`, `ToString`×3, `TransformBy`；属性：`Coordinate{get}`, `LargestElement{get}`, `Length{get}`, `LengthSqrd{get}`, `X{get}`, `XAxis{get}`, `Y{get}`, `YAxis{get}`, `Z{get}`, `ZAxis{get}`
- `Teigha.Geometry.Vector3dCollection` — class；构造器：3；方法：`Add`, `AddRange`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`, `ToArray`, `TrimToSize`；属性：`Capacity{get/set}`, `Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `IsSynchronized{get}`, `Item{get/set}`, `SyncRoot{get}`；字段：`DefaultSize`
- `Teigha.Geometry.Vector3dCollectionEnumerator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`

#### `Teigha.GraphicsInterface`

- `Teigha.GraphicsInterface.AbstractClipBoundary` — class；构造器：1；属性：`BoundaryType{get}`
- `Teigha.GraphicsInterface.ArcType` — enum；枚举值：3
- `Teigha.GraphicsInterface.AttenuationType` — enum；枚举值：3
- `Teigha.GraphicsInterface.AttributesFlags` — enum；枚举值：11
- `Teigha.GraphicsInterface.AutoTransform` — enum；枚举值：4
- `Teigha.GraphicsInterface.BoundaryType` — enum；枚举值：3
- `Teigha.GraphicsInterface.ChannelFlags` — enum；枚举值：9
- `Teigha.GraphicsInterface.ClipBoundary` — class；构造器：1；属性：`BackClipZ{get/set}`, `ClippingBack{get/set}`, `ClippingFront{get/set}`, `DrawBoundary{get/set}`, `FrontClipZ{get/set}`, `NormalVector{get/set}`, `Point{get/set}`, `TransformInverseBlockRefXForm{get/set}`, `TransformToClipSpace{get/set}`
- `Teigha.GraphicsInterface.ColorRGB` — struct；构造器：1；属性：`Blue{get/set}`, `Green{get/set}`, `Red{get/set}`
- `Teigha.GraphicsInterface.CommonDraw` — abstract class；构造器：0；方法：`Deviation`；属性：`Context{get}`, `IsDragging{get}`, `NumberOfIsolines{get}`, `RawGeometry{get}`, `RegenAbort{get}`, `RegenType{get}`, `SubEntityTraits{get}`
- `Teigha.GraphicsInterface.Context` — abstract class；构造器：0；方法：`DisableFastMoveDrag`；属性：`ByBlockLineWeight{get}`, `ByBlockPlotStyleNameId{get}`, `Database{get}`, `EffectiveColor{get}`, `IsBoundaryClipping{get}`, `IsNesting{get}`, `IsPlotGeneration{get}`, `IsPostScriptOut{get}`, `SupportsTrueTypeText{get}`
- `Teigha.GraphicsInterface.ContextForDbDatabase` — class；构造器：1；方法：`LoadPlotStyleTable`, `SetPlotGeneration`；属性：`Database{get}`, `EnableConstantModelSpaceLineweights{get/set}`, `IsBoundaryClipping{get}`, `IsPlotGeneration{get}`, `IsPostScriptOut{get}`, `PaletteBackground{get/set}`, `UseGsModel{get/set}`
- `Teigha.GraphicsInterface.DefaultLightingType` — enum；枚举值：2
- `Teigha.GraphicsInterface.DeviationType` — enum；枚举值：5
- `Teigha.GraphicsInterface.DiagnosticBSPMode` — enum；枚举值：2
- `Teigha.GraphicsInterface.DiagnosticGridMode` — enum；枚举值：3
- `Teigha.GraphicsInterface.DiagnosticMode` — enum；枚举值：5
- `Teigha.GraphicsInterface.DiagnosticPhotonMode` — enum；枚举值：2
- `Teigha.GraphicsInterface.DisplaySettings` — enum；枚举值：5
- `Teigha.GraphicsInterface.DisplayStyle` — class；构造器：1；方法：`Clone`, `Set`；属性：`Brightness{get/set}`, `DisplaySettings{get/set}`, `ShadowType{get/set}`
- `Teigha.GraphicsInterface.DistantLightTraits` — abstract class；构造器：1；属性：`IsSunlight{get/set}`, `LightDirection{get/set}`
- `Teigha.GraphicsInterface.Drawable` — abstract class；构造器：0；方法：`RegenSupportFlags`, `SetAttributes`, `ViewportDraw`, `ViewportDrawLogicalFlags`, `WorldDraw`；属性：`Bounds{get}`, `DrawableType{get}`, `Id{get}`, `IsPersistent{get}`
- `Teigha.GraphicsInterface.DrawableOverrule` — abstract class；构造器：0；方法：`RegenSupportFlags`, `SetAttributes`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`, `ViewportDraw`, `ViewportDrawLogicalFlags`, `WorldDraw`
- `Teigha.GraphicsInterface.DrawableTraits` — abstract class；构造器：0；方法：`AddLight`, `SetupForEntity`
- `Teigha.GraphicsInterface.DrawableType` — enum；枚举值：13
- `Teigha.GraphicsInterface.EdgeData` — class；构造器：1；方法：`GetColors`, `GetLayers`, `GetLineTypes`, `GetSelectionMarkers`, `GetTrueColors`, `GetVisibility`, `SetColors`, `SetLayers`, `SetLineTypes`, `SetSelectionMarkers`, `SetTrueColors`, `SetVisibility`
- `Teigha.GraphicsInterface.EdgeModel` — enum；枚举值：3
- `Teigha.GraphicsInterface.EdgeModifiers` — enum；枚举值：9
- `Teigha.GraphicsInterface.EdgeStyle` — class；构造器：1；方法：`Clone`, `Set`；属性：`CreaseAngle{get/set}`, `EdgeColor{get/set}`, `EdgeModel{get/set}`, `EdgeModifiers{get/set}`, `EdgeStyleApply{get/set}`, `EdgeVisibility{get/set}`, `EdgeWidth{get/set}`, `HaloGap{get/set}`, `HidePrecision{get/set}`, `IntersectionColor{get/set}`, `IntersectionLinetype{get/set}`, `Isolines{get/set}`, `Jitter{get/set}`, `ObscuredColor{get/set}`, `ObscuredLinetype{get/set}`, `Opacity{get/set}`, `Overhang{get/set}`, `SilhouetteColor{get/set}`, `SilhouetteWidth{get/set}`
- `Teigha.GraphicsInterface.EdgeStyleApply` — enum；枚举值：2
- `Teigha.GraphicsInterface.EdgeVisibilityModes` — enum；枚举值：5
- `Teigha.GraphicsInterface.ExposureType` — enum；枚举值：2
- `Teigha.GraphicsInterface.ExtendedLightShape` — enum；枚举值：5
- `Teigha.GraphicsInterface.FaceColorMode` — enum；枚举值：6
- `Teigha.GraphicsInterface.FaceData` — class；构造器：1；方法：`GetColors`, `GetLayers`, `GetMappers`, `GetMaterials`, `GetNormalVectors`, `GetSelectionMarkers`, `GetTransparency`, `GetTrueColors`, `GetVisibility`, `SetColors`, `SetLayers`, `SetMappers`, `SetMaterials`, `SetNormalVectors`, `SetSelectionMarkers`, `SetTransparency`, `SetTrueColors`, `SetVisibility`
- `Teigha.GraphicsInterface.FaceModifiers` — enum；枚举值：3
- `Teigha.GraphicsInterface.FaceStyle` — class；构造器：1；方法：`Clone`, `Set`；属性：`FaceColorMode{get/set}`, `FaceModifiers{get/set}`, `LightingModel{get/set}`, `LightingQuality{get/set}`, `MonoColor{get/set}`, `Opacity{get/set}`, `SpecularHighlight{get/set}`
- `Teigha.GraphicsInterface.FillType` — enum；枚举值：2
- `Teigha.GraphicsInterface.Filter` — enum；枚举值：5
- `Teigha.GraphicsInterface.FinalGatheringMode` — enum；枚举值：3
- `Teigha.GraphicsInterface.FinalGatherMode` — enum；枚举值：4
- `Teigha.GraphicsInterface.FontDescriptor` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Bold{get}`, `CharacterSet{get}`, `Italic{get}`, `PitchAndFamily{get}`, `TypeFace{get}`
- `Teigha.GraphicsInterface.FrontAndBackClipping` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `IsEqualTo`×2, `op_Equality`, `op_Inequality`；属性：`Back{get}`, `ClipBack{get}`, `ClipFront{get}`, `Front{get}`
- `Teigha.GraphicsInterface.GdiDrawObject` — abstract class；构造器：0；方法：`Draw`；属性：`Height{get/set}`, `Width{get/set}`
- `Teigha.GraphicsInterface.GenericTexture` — class；构造器：1；方法：`Clone`, `CopyFrom`, `Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `Set`；属性：`Definition{get/set}`
- `Teigha.GraphicsInterface.Geometry` — abstract class；构造器：0；方法：`Circle`×2, `CircularArc`×2, `Draw`, `EllipticalArc`, `Image`×2, `Mesh`, `OwnerDraw`, `Polygon`, `Polyline`×3, `Polypoint`×3, `PolyPolygon`, `PolyPolyline`, `PopClipBoundary`, `PopModelTransform`, `PushClipBoundary`×2, `PushModelTransform`×2, `PushOrientationTransform`, `PushPositionTransform`×2, `PushScaleTransform`×2, `Ray`, `RowOfDots`, `Shell`, `Text`×2, `WorldLine`, `Xline`；属性：`ModelToWorldTransform{get}`, `WorldToModelTransform{get}`
- `Teigha.GraphicsInterface.GIRasterImage` — class；构造器：0；方法：`CalcBMPScanLineSize`, `ChangeImageSource`, `ChangeTransparencyMode`, `Convert`×8, `Crop`, `DefaultResolution`, `getColor`, `PaletteData`, `pixelFormat`, `ScanLines`×2；属性：`ColorDepth{get}`, `imageSource{get}`, `ImgTransparencyMode{get}`, `NumColors{get}`, `PaletteDataSize{get}`, `PixelHeight{get}`, `PixelWidth{get}`, `ScanLinesAlignment{get}`, `ScanLineSize{get}`, `TransparentColor{get}`
- `Teigha.GraphicsInterface.GIRasterImageDesc` — class；构造器：3；方法：`SetColorDepth`, `SetImageSource`, `SetPalette`, `SetPixelHeight`, `SetPixelWidth`, `SetScanLinesAlignment`, `SetTransparencyMode`, `SupportedParams`
- `Teigha.GraphicsInterface.GlobalIlluminationMode` — enum；枚举值：4
- `Teigha.GraphicsInterface.GradientBackgroundTraits` — abstract class；构造器：0；属性：`ColorBottom{get/set}`, `ColorMiddle{get/set}`, `ColorTop{get/set}`, `Height{get/set}`, `Horizon{get/set}`, `Rotation{get/set}`
- `Teigha.GraphicsInterface.GroundPlaneBackgroundTraits` — abstract class；构造器：0；属性：`ColorGroundPlaneFar{get/set}`, `ColorGroundPlaneNear{get/set}`, `ColorSkyHorizon{get/set}`, `ColorSkyZenith{get/set}`, `ColorUndergroundAzimuth{get/set}`, `ColorUndergroundHorizon{get/set}`
- `Teigha.GraphicsInterface.IlluminationModel` — enum；枚举值：2
- `Teigha.GraphicsInterface.ImageBackgroundTraits` — abstract class；构造器：0；属性：`FitToScreen{get/set}`, `ImageFilename{get/set}`, `MaintainAspectRatio{get/set}`, `UseTiling{get/set}`, `XOffset{get/set}`, `XScale{get/set}`, `YOffset{get/set}`, `YScale{get/set}`
- `Teigha.GraphicsInterface.ImageBGRA32` — class；构造器：2；属性：`Height{get/set}`, `Image{get/set}`, `Width{get/set}`
- `Teigha.GraphicsInterface.ImageFileTexture` — class；构造器：1；方法：`Clone`, `Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`；属性：`SourceFileName{get/set}`
- `Teigha.GraphicsInterface.ImageOrg` — enum；枚举值：9
- `Teigha.GraphicsInterface.ImageSource` — enum；枚举值：3
- `Teigha.GraphicsInterface.ImageTexture` — class；构造器：1
- `Teigha.GraphicsInterface.JitterAmount` — enum；枚举值：3
- `Teigha.GraphicsInterface.LightAttenuation` — class；构造器：1；方法：`Equals`, `GetHashCode`, `SetLimits`；属性：`AttenuationType{get/set}`, `EndLimit{get}`, `StartLimit{get}`, `UseLimits{get/set}`
- `Teigha.GraphicsInterface.LightingModel` — enum；枚举值：4
- `Teigha.GraphicsInterface.LightingQuality` — enum；枚举值：3
- `Teigha.GraphicsInterface.LightTraits` — abstract class；构造器：1；属性：`On{get/set}`
- `Teigha.GraphicsInterface.Linetype` — enum；枚举值：11
- `Teigha.GraphicsInterface.LinetypeCollection` — class；构造器：1；方法：`Add`, `Clear`, `Contains`, `GetEnumerator`, `IndexOf`, `Insert`, `Remove`, `RemoveAt`；属性：`Count{get}`, `IsFixedSize{get}`, `IsReadOnly{get}`, `Item{get/set}`
- `Teigha.GraphicsInterface.LuminanceMode` — enum；枚举值：2
- `Teigha.GraphicsInterface.MapChannel` — enum；枚举值：2
- `Teigha.GraphicsInterface.MapFilter` — enum；枚举值：2
- `Teigha.GraphicsInterface.Mapper` — class；构造器：2；方法：`Equals`, `GetHashCode`；属性：`AutoTransform{get/set}`, `Projection{get/set}`, `Transform{get/set}`, `UTiling{get/set}`, `VTiling{get/set}`
- `Teigha.GraphicsInterface.MaterialColor` — class；构造器：2；方法：`Equals`, `GetHashCode`；属性：`Color{get}`, `Factor{get}`, `Method{get}`
- `Teigha.GraphicsInterface.MaterialDiffuseComponent` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Color{get}`, `Map{get}`
- `Teigha.GraphicsInterface.MaterialMap` — class；构造器：4；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`；属性：`BlendFactor{get}`, `Filter{get}`, `Mapper{get}`, `Source{get}`, `SourceFileName{get}`, `Texture{get}`
- `Teigha.GraphicsInterface.MaterialNormalMapComponent` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Map{get}`, `Method{get}`, `Strength{get}`
- `Teigha.GraphicsInterface.MaterialOpacityComponent` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Map{get}`, `Percentage{get}`
- `Teigha.GraphicsInterface.MaterialRefractionComponent` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Index{get}`, `Map{get}`
- `Teigha.GraphicsInterface.MaterialSpecularComponent` — struct；构造器：1；方法：`Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`, `ToString`×2；属性：`Color{get}`, `Gloss{get}`, `Map{get}`
- `Teigha.GraphicsInterface.MaterialTexture` — class；构造器：1
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraits` — abstract class；构造器：0；属性：`DiagnosticBSPMode{get/set}`, `DiagnosticGridMode{get/set}`, `DiagnosticMode{get/set}`, `DiagnosticPhotonMode{get/set}`, `EnergyMultiplier{get/set}`, `ExportMIEnabled{get/set}`, `ExportMIFileName{get/set}`, `FGRayCount{get/set}`, `FGSampleRadius{get/set}`, `FGSampleRadiusState{get/set}`, `FinalGatheringEnabled{get/set}`, `GIPhotonsPerLight{get/set}`, `GISampleCount{get/set}`, `GISampleRadius{get/set}`, `GISampleRadiusEnabled{get/set}`, `GlobalIlluminationEnabled{get/set}`, `LightLuminanceScale{get/set}`, `MemoryLimit{get/set}`, `PhotonTraceDepth{get/set}`, `ProgressMonitor{get/set}`, `RayTraceDepth{get/set}`, `RayTraceEnabled{get/set}`, `Sampling{get/set}`, `SamplingContrastColor{get/set}`, `SamplingFilter{get/set}`, `ShadowMapEnabled{get/set}`, `ShadowMode{get/set}`, `TileOrder{get/set}`, `TileSize{get/set}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraits2` — abstract class；构造器：0；属性：`ExposureType{get/set}`, `FinalGatheringMode{get/set}`, `ShadowSamplingMultiplier{get/set}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsBoolParameter` — struct；构造器：1；属性：`Max{get}`, `Min{get}`, `Pixels{get}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsDiagnosticGridModeParameter` — struct；构造器：1；属性：`Mode{get}`, `Size{get}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsDoubleRangeParameter` — struct；构造器：1；属性：`Max{get}`, `Min{get}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsFloatParameter` — struct；构造器：1；属性：`A{get}`, `B{get}`, `G{get}`, `R{get}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsIntegerRangeParameter` — struct；构造器：1；属性：`Max{get}`, `Min{get}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsSamplingParameter` — struct；构造器：1；属性：`Filter{get}`, `Height{get}`, `Width{get}`
- `Teigha.GraphicsInterface.MentalRayRenderSettingsTraitsTraceParameter` — struct；构造器：1；属性：`Reflection{get}`, `Refraction{get}`, `Sum{get}`
- `Teigha.GraphicsInterface.Method` — enum；枚举值：2
- `Teigha.GraphicsInterface.Mode` — enum；枚举值：2
- `Teigha.GraphicsInterface.NonEntityTraits` — class；构造器：0；方法：`AddLight`, `SetSelectionMarker`, `SetupForEntity`；属性：`Color{get/set}`, `DrawFlags{get/set}`, `FillType{get/set}`, `Layer{get/set}`, `LineType{get/set}`, `LineTypeScale{get/set}`, `LineWeight{get/set}`, `Mapper{get/set}`, `Material{get/set}`, `PlotStyleDescriptor{get/set}`, `Sectionable{get/set}`, `SelectionFlags{get/set}`, `SelectionOnlyGeometry{get/set}`, `ShadowFlags{get/set}`, `Thickness{get/set}`, `Transparency{get/set}`, `TrueColor{get/set}`, `VisualStyle{get/set}`
- `Teigha.GraphicsInterface.NormalMapMethod` — enum；枚举值：1
- `Teigha.GraphicsInterface.OrientationBehavior` — enum；枚举值：3
- `Teigha.GraphicsInterface.OrientationType` — enum；枚举值：3
- `Teigha.GraphicsInterface.PathNode` — class；构造器：0；属性：`Parent{get}`, `PersistentDrawableId{get}`, `SelectionMarker{get}`, `TransientDrawable{get}`
- `Teigha.GraphicsInterface.PixelBGRA32` — struct；构造器：3；方法：`init`；属性：`Alpha{get/set}`, `Blue{get/set}`, `Green{get/set}`, `Red{get/set}`
- `Teigha.GraphicsInterface.PixelFormatInfo` — struct；构造器：0；方法：`is16bitBGR`, `isBGR`, `isBGRA`, `isRGB`, `isRGBA`, `op_Equality`, `set16bitBGR`, `setBGR`, `setBGRA`, `setRGB`, `setRGBA`；属性：`AlphaOffset{get/set}`, `BitsPerPixel{get/set}`, `BlueOffset{get/set}`, `GreenOffset{get/set}`, `NumAlphaBits{get/set}`, `NumBlueBits{get/set}`, `NumGreenBits{get/set}`, `NumRedBits{get/set}`, `RedOffset{get/set}`
- `Teigha.GraphicsInterface.Polyline` — class；构造器：2；属性：`BaseSubEntMarker{get/set}`, `Normal{get/set}`, `Points{get/set}`
- `Teigha.GraphicsInterface.PolylineCollection` — class；构造器：2；方法：`Add`, `Clear`, `RemoveAt`；属性：`Count{get}`, `Item{get/set}`
- `Teigha.GraphicsInterface.PositionBehavior` — enum；枚举值：5
- `Teigha.GraphicsInterface.ProceduralTexture` — class；构造器：1
- `Teigha.GraphicsInterface.Projection` — enum；枚举值：5
- `Teigha.GraphicsInterface.RasterImageSource` — enum；枚举值：8
- `Teigha.GraphicsInterface.RegenType` — enum；枚举值：7
- `Teigha.GraphicsInterface.RenderSettingsTraits` — abstract class；构造器：0；属性：`BackFacesEnabled{get/set}`, `DiagnosticBackgroundEnabled{get/set}`, `MaterialEnabled{get/set}`, `ModelScaleFactor{get/set}`, `ShadowsEnabled{get/set}`, `TextureSampling{get/set}`
- `Teigha.GraphicsInterface.ScaleBehavior` — enum；枚举值：5
- `Teigha.GraphicsInterface.SelectionFlags` — enum；枚举值：3
- `Teigha.GraphicsInterface.ShadowDisplayType` — enum；枚举值：4
- `Teigha.GraphicsInterface.ShadowFlags` — enum；枚举值：4
- `Teigha.GraphicsInterface.ShadowMode` — enum；枚举值：3
- `Teigha.GraphicsInterface.ShadowParameters` — class；构造器：1；方法：`Equals`, `GetHashCode`；属性：`ExtendedLightLength{get/set}`, `ExtendedLightRadius{get/set}`, `ExtendedLightShape{get/set}`, `ExtendedLightWidth{get/set}`, `ShadowMapSize{get/set}`, `ShadowMapSoftness{get/set}`, `ShadowSamples{get/set}`, `ShadowsOn{get/set}`, `ShadowType{get/set}`, `ShapeVisibility{get/set}`
- `Teigha.GraphicsInterface.ShadowType` — enum；枚举值：3
- `Teigha.GraphicsInterface.Source` — enum；枚举值：3
- `Teigha.GraphicsInterface.StandardLightTraits` — abstract class；构造器：1；属性：`Intensity{get/set}`, `LightColor{get/set}`, `Shadow{get/set}`
- `Teigha.GraphicsInterface.SubEntityTraits` — abstract class；构造器：0；方法：`SetSelectionMarker`；属性：`Color{get/set}`, `DrawFlags{get/set}`, `FillType{get/set}`, `Layer{get/set}`, `LineType{get/set}`, `LineTypeScale{get/set}`, `LineWeight{get/set}`, `Mapper{get/set}`, `Material{get/set}`, `PlotStyleDescriptor{get/set}`, `Sectionable{get/set}`, `SelectionFlags{get/set}`, `SelectionOnlyGeometry{get/set}`, `ShadowFlags{get/set}`, `Thickness{get/set}`, `Transparency{get/set}`, `TrueColor{get/set}`, `VisualStyle{get/set}`
- `Teigha.GraphicsInterface.TextStyle` — class；构造器：2；方法：`Create`, `ExtentsBox`, `FromTextStyleTableRecord`×2, `SetTrackKerning`；属性：`Backward{get/set}`, `BigFontFileName{get/set}`, `FileName{get/set}`, `Font{get/set}`, `LoadStyleRec{get}`, `ObliquingAngle{get/set}`, `Overlined{get/set}`, `PreLoaded{get/set}`, `StyleName{get/set}`, `TextSize{get/set}`, `TrackingPercent{get/set}`, `Underlined{get/set}`, `UpsideDown{get/set}`, `Vertical{get/set}`, `XScale{get/set}`
- `Teigha.GraphicsInterface.TileOrder` — enum；枚举值：6
- `Teigha.GraphicsInterface.Tiling` — enum；枚举值：5
- `Teigha.GraphicsInterface.TransientDrawingMode` — enum；枚举值：7
- `Teigha.GraphicsInterface.TransientManager` — class；构造器：0；方法：`AddChildTransient`, `AddTransient`, `EraseChildTransient`, `EraseTransient`, `EraseTransients`, `GetFreeSubDrawingMode`, `UpdateChildTransient`, `UpdateTransient`；属性：`CurrentTransientManager{get/set}`
- `Teigha.GraphicsInterface.TransparencyMode` — enum；枚举值：4
- `Teigha.GraphicsInterface.TtfDescriptor` — class；构造器：1
- `Teigha.GraphicsInterface.Units` — enum；枚举值：21
- `Teigha.GraphicsInterface.Variant` — class；构造器：6；方法：`CopyFrom`, `DeleteElem`, `ElemAt`, `ElemCount`, `Equals`, `get_Elem`×2, `set_Elem`；属性：`Boolean{get/set}`, `Char{get/set}`, `Color{get/set}`, `Double{get/set}`, `Float{get/set}`, `Int{get/set}`, `Long{get/set}`, `Short{get/set}`, `String{get/set}`, `Type{get}`, `Uchar{get/set}`, `Uint{get/set}`, `Ulong{get/set}`, `Ushort{get/set}`
- `Teigha.GraphicsInterface.VariantType` — enum；枚举值：7
- `Teigha.GraphicsInterface.VertexData` — class；构造器：1；方法：`get_MappingCoords`, `GetNormalVectors`, `GetTrueColors`, `set_MappingCoords`, `SetNormalVectors`, `SetTrueColors`；属性：`OrientationFlag{get/set}`
- `Teigha.GraphicsInterface.Viewport` — abstract class；构造器：0；方法：`DoInversePerspective`, `DoPerspective`, `GetNumPixelsInUnitSquare`, `LayerVisible`；属性：`AcadWindowId{get}`, `CameraLocation{get}`, `CameraTarget{get}`, `CameraUpVector{get}`, `DeviceContextViewportCorners{get}`, `EyeToModelTransform{get}`, `EyeToWorldTransform{get}`, `FrontAndBackClipping{get}`, `IsPerspective{get}`, `LinetypeGenerationCriteria{get}`, `LinetypeScaleMultiplier{get}`, `ModelToEyeTransform{get}`, `ViewDirection{get}`, `ViewportId{get}`, `WorldToEyeTransform{get}`
- `Teigha.GraphicsInterface.ViewportDraw` — abstract class；构造器：0；方法：`IsValidId`；属性：`Geometry{get}`, `SequenceNumber{get}`, `Viewport{get}`, `ViewportObjectId{get}`
- `Teigha.GraphicsInterface.ViewportGeometry` — abstract class；构造器：0；方法：`DeviceContextPolygon`, `DeviceContextPolyline`, `DeviceContextRasterImage`, `PolygonEye`, `PolylineEye`
- `Teigha.GraphicsInterface.ViewportTraits` — abstract class；构造器：1；属性：`AmbientLightColor{get/set}`, `Background{get/set}`, `Brightness{get/set}`, `Contrast{get/set}`, `DefaultLightingOn{get/set}`, `DefaultLightingType{get/set}`, `RenderEnvironment{get/set}`, `RenderSettings{get/set}`
- `Teigha.GraphicsInterface.VisualStyle` — class；构造器：2；方法：`ConfigureForType`；属性：`DisplayStyle{get/set}`, `EdgeStyle{get/set}`, `FaceStyle{get/set}`
- `Teigha.GraphicsInterface.VisualStyleOperation` — enum；枚举值：5
- `Teigha.GraphicsInterface.VisualStyleProperty` — enum；枚举值：60
- `Teigha.GraphicsInterface.VisualStyleTraits` — abstract class；构造器：0；属性：`OdGiVisualStyle{get/set}`
- `Teigha.GraphicsInterface.VisualStyleType` — enum；枚举值：17
- `Teigha.GraphicsInterface.WorldDraw` — abstract class；构造器：0；属性：`Geometry{get}`
- `Teigha.GraphicsInterface.WorldGeometry` — abstract class；构造器：0；方法：`SetExtents`, `StartAttributesSegment`

#### `Teigha.GraphicsSystem`

- `Teigha.GraphicsSystem.ClearColor` — enum；枚举值：3
- `Teigha.GraphicsSystem.ClientViewInfo` — struct；构造器：0；属性：`AcadWindowId{get}`, `ViewportFlags{get}`, `ViewportId{get}`, `ViewportObjectId{get}`
- `Teigha.GraphicsSystem.DefaultLightingType` — enum；枚举值：3
- `Teigha.GraphicsSystem.Device` — abstract class；构造器：1；方法：`Add`, `CreateModel`, `CreateView`×3, `Erase`×2, `EraseAll`, `GetSize`, `GetSizeExt`, `GetSizeRect`, `GetSnapshot`, `InsertView`, `Invalidate`×2, `OnDisplayChange`, `OnRealizeBackgroundPalette`, `OnRealizeForegroundPalette`, `OnSize`×3, `SetLogicalPalette`, `Update`×2, `ViewAt`；属性：`BackgroundColor{get/set}`, `DarkPalette{get}`, `IsValid{get}`, `LightPalette{get}`, `LogicalPalette{get/set}`, `NumViews{get}`, `Properties{get}`, `UserGiContext{get/set}`
- `Teigha.GraphicsSystem.DrawableDesc` — struct；构造器：0；属性：`DrawableDescFlags{get/set}`, `DrawableFlags{get/set}`, `MarkedByGeometry{get/set}`, `MarkedBySelection{get/set}`, `MarkedBySubGeometry{get/set}`, `MarkedBySubSelection{get/set}`, `MarkedToBreak{get/set}`, `MarkedToSkip{get/set}`, `Parent{get}`, `PersistId{get}`, `TransientDrawable{get}`
- `Teigha.GraphicsSystem.DrawableDescFlags` — enum；枚举值：0
- `Teigha.GraphicsSystem.GsModule` — class；构造器：0；方法：`CreateBitmapDevice`, `CreateDevice`；事件：`GsToBeUnloaded`, `ViewToBeDestroyed`, `ViewWasCreated`
- `Teigha.GraphicsSystem.GsToBeUnloadedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.GraphicsSystem.ImpDevice` — class；构造器：0；方法：`Add`, `CreateModel`, `CreateView`×3, `Erase`×2, `EraseAll`, `GetSize`, `GetSizeExt`, `GetSizeRect`, `GetSnapshot`, `InsertView`, `Invalidate`×2, `OnDisplayChange`, `OnRealizeBackgroundPalette`, `OnRealizeForegroundPalette`, `OnSize`×3, `SetLogicalPalette`, `Update`×2, `ViewAt`；属性：`BackgroundColor{get/set}`, `IsValid{get}`, `LogicalPalette{get/set}`, `NumViews{get}`, `Properties{get}`, `UserGiContext{get/set}`
- `Teigha.GraphicsSystem.InvalidationHint` — enum；枚举值：5
- `Teigha.GraphicsSystem.LayoutHelperDevice` — class；构造器：0；方法：`ActivateViewport`×2, `MakeViewActive`, `SetupActiveLayoutViews`, `SetupLayoutViews`；属性：`ActiveView{get}`, `LayoutId{get}`, `Model{get}`, `UnderlyingDevice{get}`
- `Teigha.GraphicsSystem.Model` — class；构造器：0；方法：`Highlight`, `Invalidate`×2, `OnAdded`×2, `OnErased`×2, `OnModified`×2, `OnUnerased`×2, `setSectioning`×2；属性：`Background{get/set}`, `EnableLightsInBlocks{get/set}`, `EnableLinetypes{get/set}`, `EnableSectioning{get/set}`, `EnableViewExtentsCalculation{get/set}`, `RenderModeOverride{get/set}`, `RenderType{get/set}`, `SectioningVisualStyle{set}`, `Selectable{get/set}`, `Transform{get/set}`, `ViewClippingOverride{get/set}`, `ViewSectioningOverride{get/set}`, `VisualStyle{get/set}`, `VisualStyleId{get/set}`
- `Teigha.GraphicsSystem.ModuleEventArgs` — class；构造器：0；属性：`Module{get/set}`
- `Teigha.GraphicsSystem.PageParams` — class；构造器：2；方法：`scale`, `setParams`×2；属性：`BottomMargin{get}`, `LeftMargin{get}`, `PaperHeight{get}`, `PaperWidth{get}`, `RightMargin{get}`, `TopMargin{get}`
- `Teigha.GraphicsSystem.PageParamsCollection` — class；构造器：1；方法：`Add`, `Contains`, `CopyTo`, `IndexOf`, `Insert`, `Remove`；属性：`Item{get/set}`
- `Teigha.GraphicsSystem.Projection` — enum；枚举值：2
- `Teigha.GraphicsSystem.RenderMode` — enum；枚举值：9
- `Teigha.GraphicsSystem.RenderType` — enum；枚举值：14
- `Teigha.GraphicsSystem.SelectionMode` — enum；枚举值：6
- `Teigha.GraphicsSystem.SelectionReactor` — class；构造器：1；方法：`Selected`×2
- `Teigha.GraphicsSystem.SelectionReactorResult` — enum；枚举值：4
- `Teigha.GraphicsSystem.StereoParameters` — struct；构造器：1；属性：`Magnitude{get}`, `Parallax{get}`
- `Teigha.GraphicsSystem.View` — class；构造器：1；方法：`Add`×2, `BeginInteractivity`, `ClearFrozenLayers`, `CloneView`×3, `Dolly`×2, `EnableDefaultLighting`×2, `EndInteractivity`, `Erase`, `EraseAll`, `ExtentsInView`, `Flush`, `FreezeLayer`, `GetModel`, `GetModelList`, `GetNumPixelsInUnitSquare`×2, `GetSnapshot`, `Hide`, `InitLights`, `Invalidate`×2, `InvalidateCachedViewportGeometry`, `Orbit`, `Pan`, `PointInView`, `PointInViewport`, `RemoveViewportClipRegion`, `Roll`, `Select`, `SetLineweights`, `SetView`×2, `Show`, `ThawLayer`, `Update`, `ViewParameters`, `Zoom`, `ZoomExtents`, `ZoomWindow`；属性：`BackClip{get/set}`, `Background{get/set}`, `ClearColor{set}`, `ClientViewInfo{get}`, `Device{get}`, `EnableBackClip{get/set}`, `EnableFrontClip{get/set}`, `EnableStereo{get/set}`, `ExceededBounds{get}`, `FieldHeight{get}`, `FieldWidth{get}`, `FrontClip{get/set}`, `IsPerspective{get}`, `IsValid{get}`, `IsVisible{get}`, `LensLength{get/set}`, `LinetypeScaleMultiplier{set}`, `LineweightToDcScale{get/set}`, `Mode{get/set}`, `ObjectToDeviceMatrix{get}`, `Position{get}`, `ProjectionMatrix{get}`, `ScreenMatrix{get}`, `StereoParameters{get/set}`, `Target{get}`, `UpVector{get}`, `UserGiContext{get/set}`, `ViewingMatrix{get}`, `Viewport{get/set}`, `ViewportBorderProperties{get/set}`, `ViewportBorderVisibility{get/set}`, `ViewportClipRegion{get/set}`, `VisualStyle{get/set}`, `VisualStyleId{get/set}`, `WorldToDeviceMatrix{get}`
- `Teigha.GraphicsSystem.ViewEventArgs` — class；构造器：0；属性：`View{get/set}`
- `Teigha.GraphicsSystem.ViewportBorderProperties` — struct；构造器：1；属性：`Color{get}`, `Weight{get}`
- `Teigha.GraphicsSystem.ViewportFlags` — enum；枚举值：2
- `Teigha.GraphicsSystem.ViewToBeDestroyedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.GraphicsSystem.ViewWasCreatedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`

#### `Teigha.Internal.DatabaseServices`

- `Teigha.Internal.DatabaseServices.EvalGraph` — class；构造器：0；方法：`GetAllNodes`, `GetNode`

#### `Teigha.LayerManager`

- `Teigha.LayerManager.AndExpression` — class；构造器：0；方法：`GetRelationalExpressions`
- `Teigha.LayerManager.DialogResult` — enum；枚举值：3
- `Teigha.LayerManager.LayerCollection` — class；构造器：0；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `Remove`；属性：`Count{get}`, `Item{get}`
- `Teigha.LayerManager.LayerFilter` — class；构造器：1；方法：`CompareTo`, `Filter`, `GenerateNested`, `GetFilterExpressionTree`；属性：`AllowDelete{get}`, `AllowNested{get}`, `AllowRename{get}`, `DynamicallyGenerated{get}`, `FilterExpression{get/set}`, `IsIdFilter{get}`, `IsProxy{get}`, `Name{get/set}`, `NestedFilters{get}`, `Parent{get}`
- `Teigha.LayerManager.LayerFilterCollection` — class；构造器：0；方法：`Add`, `Clear`, `Contains`, `CopyTo`, `GetEnumerator`, `Remove`；属性：`Count{get}`, `Item{get}`
- `Teigha.LayerManager.LayerFilterTree` — struct；构造器：1；属性：`Current{get}`, `Root{get}`
- `Teigha.LayerManager.LayerGroup` — class；构造器：1；属性：`LayerIds{get}`
- `Teigha.LayerManager.RelationalExpression` — class；构造器：0；属性：`Constant{get}`, `Variable{get}`

#### `Teigha.ModelerGeometry`

- `Teigha.ModelerGeometry.ModelerModule` — class；构造器：0；方法：`GetTriangulationParams`, `SetTriangulationParams`
- `Teigha.ModelerGeometry.TriangulationParams` — class；构造器：1；方法：`DeleteUnmanagedObject`, `Equals`；属性：`BetweenKnots{get/set}`, `FastMode{get/set}`, `GridAspectRatio{get/set}`, `MaxFacetEdgeLength{get/set}`, `MaxNumGridLines{get/set}`, `NormalTolerance{get/set}`, `PointsPerEdge{get/set}`, `RecalculateSurfaceTolerance{get/set}`, `SurfaceTolerance{get/set}`, `UseTesselation{get/set}`

#### `Teigha.Runtime`

- `Teigha.Runtime.AdvancedSupportFlags` — enum；枚举值：7
- `Teigha.Runtime.AngularUnitFormat` — enum；枚举值：6
- `Teigha.Runtime.CommandClassAttribute` — class；构造器：1；属性：`Type{get}`
- `Teigha.Runtime.CommandFlags` — enum；枚举值：24
- `Teigha.Runtime.CommandMethodAttribute` — class；构造器：7；属性：`ContextMenuExtensionType{get}`, `Flags{get}`, `GlobalName{get}`, `GroupName{get}`, `HelpFileName{get}`, `HelpTopic{get}`, `LocalizedNameId{get}`
- `Teigha.Runtime.Converter` — class；构造器：1；方法：`AngleToString`×2, `DistanceToString`×2, `RawAngleToString`×2, `StringToAngle`×2, `StringToDistance`×2, `StringToRawAngle`×2
- `Teigha.Runtime.Dictionary` — class；构造器：0；方法：`At`×2, `AtKeyAndIdPut`, `AtPut`×3, `Contains`×2, `CopyTo`, `GetEnumerator`, `IdAt`, `KeyAt`, `Remove`×2, `ResetKey`×2；属性：`Count{get}`, `DeletesObjects{get}`, `IsCaseSensitive{get}`, `IsSorted{get}`, `Item{get/set}`
- `Teigha.Runtime.DictionaryIterator` — class；构造器：0；方法：`MoveNext`, `Reset`；属性：`Current{get}`, `Entry{get}`, `Key{get}`, `Value{get}`
- `Teigha.Runtime.DisposableRef<Teigha::DatabaseServices::DBObject>` — class；构造器：1；方法：`Dispose`, `op_Implicit`
- `Teigha.Runtime.DisposableWrapper` — abstract class；构造器：0；方法：`Create`, `Dispose`, `Equals`, `GetHashCode`, `op_Equality`, `op_Inequality`；属性：`AutoDelete{get}`, `IsDisposed{get}`, `UnmanagedObject{get}`
- `Teigha.Runtime.DistanceUnitFormat` — enum；枚举值：6
- `Teigha.Runtime.DynamicLinker` — class；构造器：0；方法：`GetLoadedModules`, `IsAppBusy`, `IsApplicationLocked`, `IsAppMdiAware`, `IsModuleLoaded`, `LoadApp`, `LoadModule`, `SetAppBusy`, `UnloadApp`, `UnloadModule`；属性：`ProductKey{get}`, `ProductLcid{get}`；事件：`ModuleLoadAborted`, `ModuleLoaded`, `ModuleLoading`, `ModuleUnloadAborted`, `ModuleUnloaded`, `ModuleUnloading`
- `Teigha.Runtime.DynamicLinkerEventArgs` — class；构造器：1；属性：`FileName{get}`
- `Teigha.Runtime.ErrorStatus` — enum；枚举值：497
- `Teigha.Runtime.Exception` — class；构造器：4；方法：`GetObjectData`；属性：`ErrorStatus{get/set}`
- `Teigha.Runtime.ExtensionApplicationAttribute` — class；构造器：1；属性：`Type{get}`
- `Teigha.Runtime.FileCreationDisposition` — enum；枚举值：5
- `Teigha.Runtime.FilerSeekType` — enum；枚举值：3
- `Teigha.Runtime.FileShareMode` — enum；枚举值：4
- `Teigha.Runtime.FileStreamBuf` — class；构造器：4；方法：`CopyTo`, `Read`×2, `Rewind`, `Seek`, `Truncate`, `Write`×2；属性：`FileName{get}`, `IsEof{get}`, `Length{get}`, `ShareMode{get}`, `Tell{get}`
- `Teigha.Runtime.ICommandLineCallable` — interface；构造器：0；属性：`ContextMenuExtensionType{get}`, `Flags{get}`, `GlobalName{get}`, `GroupName{get}`, `HelpFileName{get}`, `HelpTopic{get}`, `LocalizedNameId{get}`
- `Teigha.Runtime.IExtensionApplication` — interface；构造器：0；方法：`Initialize`, `Terminate`
- `Teigha.Runtime.IMenuItem` — interface；构造器：0；方法：`OnClicked`；属性：`Checked{get/set}`, `Enabled{get/set}`, `Icon{get/set}`, `Items{get}`, `Text{get/set}`, `Visible{get/set}`；事件：`Click`
- `Teigha.Runtime.ImpModule` — class；构造器：0；方法：`Initialize`, `Uninitialize`, `Unload`；属性：`Handle{get}`, `Name{get}`
- `Teigha.Runtime.Interop` — static class；构造器：0；方法：`AttachUnmanagedObject`, `Check`, `CheckAds`, `CheckAdsForCancel`, `CheckBool`, `CheckBoolean`, `CheckCPPErrName`, `CheckNull`, `DetachUnmanagedObject`, `SetAutoDelete`, `ThrowExceptionForErrorStatus`
- `Teigha.Runtime.LispFunctionAttribute` — class；构造器：4；属性：`ContextMenuExtensionType{get}`, `Flags{get}`, `GlobalName{get}`, `GroupName{get}`, `HelpFileName{get}`, `HelpTopic{get}`, `LocalizedNameId{get}`
- `Teigha.Runtime.Marshaler` — static class；构造器：0；方法：`BitmapInfoToBitmap`, `BitmapToBitmapInfo`, `CopyToManagedFullSubentityPath`, `CopyToUnmanagedFullSubentityPath`, `ViewportDraw`, `WorldDraw`
- `Teigha.Runtime.Module` — abstract class；构造器：1；方法：`Initialize`, `Uninitialize`, `Unload`；属性：`Handle{get}`, `Name{get}`
- `Teigha.Runtime.ModuleLoadAbortedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.Runtime.ModuleLoadedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.Runtime.ModuleLoadingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.Runtime.ModuleUnloadAbortedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.Runtime.ModuleUnloadedEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.Runtime.ModuleUnloadingEventHandler` — delegate；构造器：1；方法：`BeginInvoke`, `EndInvoke`, `Invoke`
- `Teigha.Runtime.Overrule` — abstract class；构造器：0；方法：`AddOverrule`, `HasOverrule`, `IsApplicable`, `RemoveOverrule`, `SetCustomFilter`, `SetExtensionDictionaryEntryFilter`, `SetIdFilter`, `SetNoFilter`, `SetXDataFilter`；属性：`Overruling{get/set}`
- `Teigha.Runtime.PlotStyleServices` — class；构造器：0；方法：`CreatePlotStyleTable`, `LoadPlotStyleTable`, `SavePlotStyleTable`
- `Teigha.Runtime.ProgressMeter` — class；构造器：1；方法：`MeterProgress`, `SetLimit`, `Start`×2, `Stop`
- `Teigha.Runtime.RXClass` — class；构造器：0；方法：`AddX`, `Create`, `DelX`, `GetX`, `IsDerivedFrom`, `QueryX`；属性：`AppName{get}`, `ClassVersion{get}`, `DxfName{get}`, `MyParent{get}`, `Name{get}`, `ProxyFlags{get}`, `SupportFlags{get}`
- `Teigha.Runtime.RXObject` — abstract class；构造器：0；方法：`Clone`, `CompareTo`, `CopyFrom`, `Create`, `GetClass`, `GetRXClass`, `QueryX`, `X`
- `Teigha.Runtime.RxVariant` — class；构造器：12；属性：`Boolean{get/set}`, `Double{get/set}`, `Int16{get/set}`, `Int32{get/set}`, `Int64{get/set}`, `Int8{get/set}`, `IntPtr{get/set}`, `Str{get/set}`, `Type{get}`, `UInt16{get/set}`, `UInt32{get/set}`, `UInt8{get/set}`
- `Teigha.Runtime.RxVariantType` — enum；枚举值：18
- `Teigha.Runtime.Services` — class；构造器：1；方法：`AccessFileRead`, `Dispose`, `LoadArchitecture`, `odActivate`；属性：`Current{get/set}`
- `Teigha.Runtime.StreamBuf` — abstract class；构造器：1；方法：`CopyTo`×3, `Read`×2, `Rewind`, `Seek`, `Truncate`, `Write`×2；属性：`FileName{get}`, `IsEof{get}`, `Length{get}`, `ShareMode{get}`, `Tell{get}`
- `Teigha.Runtime.SystemObjects` — class；构造器：0；属性：`ClassDictionary{get}`, `DynamicLinker{get}`, `ServiceDictionary{get}`
- `Teigha.Runtime.Utilities` — class；构造器：1；方法：`GetSystemVariables`, `SetPSTYLEMODE`, `SetSystemVariables`, `ThumbnailBitmap`
- `Teigha.Runtime.WrapperAttribute` — class；构造器：1；属性：`WrappedClass{get/set}`

### TD_MgdBrep

#### `Teigha.BoundaryRepresentation`

- `Teigha.BoundaryRepresentation.BoundaryLoop` — class；构造器：1；方法：`GetEdgesStartingFrom`, `GetVerticesStartingFrom`；属性：`Edges{get}`, `Face{get}`, `LoopType{get}`, `Vertices{get}`
- `Teigha.BoundaryRepresentation.Brep` — class；构造器：3；方法：`GetComplexsStartingFrom`, `GetEdgesStartingFrom`, `GetFacesStartingFrom`, `GetShellsStartingFrom`, `GetVerticesStartingFrom`, `HasTransformation`；属性：`Complexes{get}`, `Edges{get}`, `Faces{get}`, `Shells{get}`, `Solid{get}`, `Surf{get}`, `Vertices{get}`
- `Teigha.BoundaryRepresentation.BrepComplexCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.BrepComplexEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.BrepEdgeCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.BrepEdgeEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.BrepEntity` — abstract class；构造器：0；方法：`CheckEntity`, `Equals`, `GetLineContainment`, `GetMassProperties`×4, `GetPerimeterLength`×3, `GetPointContainment`, `GetSurfaceArea`×3, `GetVolume`×3；属性：`BoundBlock{get}`, `Brep{get}`, `IsNull{get}`, `SubentityPath{get}`, `ValidationLevel{get/set}`
- `Teigha.BoundaryRepresentation.BrepFaceCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.BrepFaceEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.BrepShellCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.BrepShellEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.BrepVertexCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.BrepVertexEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.Complex` — class；构造器：1；方法：`GetShellsStartingFrom`；属性：`Shells{get}`
- `Teigha.BoundaryRepresentation.ComplexShellCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.ComplexShellEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.Edge` — class；构造器：1；方法：`GetCurveAsNurb`, `GetLoopsStartingFrom`；属性：`Curve{get}`, `IsOrientToCurve{get}`, `Loops{get}`, `Vertex1{get}`, `Vertex2{get}`
- `Teigha.BoundaryRepresentation.EdgeLoopCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.EdgeLoopEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.Element` — abstract class；构造器：0
- `Teigha.BoundaryRepresentation.Element2d` — class；构造器：1；方法：`GetNodesStartingFrom`；属性：`Nodes{get}`, `Normal{get}`
- `Teigha.BoundaryRepresentation.Element2dNodeCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.Element2dNodeEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.Element2dShape` — enum；枚举值：4
- `Teigha.BoundaryRepresentation.EnumeratorBase` — abstract class；构造器：0；方法：`MoveNext`, `Reset`；属性：`isNull{get}`, `ValidationLevel{get/set}`
- `Teigha.BoundaryRepresentation.ErrorStatus` — enum；枚举值：20
- `Teigha.BoundaryRepresentation.Exception` — class；构造器：5；方法：`GetObjectData`；属性：`ErrorStatus{get/set}`
- `Teigha.BoundaryRepresentation.Face` — class；构造器：1；方法：`GetArea`×3, `GetLoopsStartingFrom`, `GetSurfaceAsNurb`, `GetSurfaceAsTrimmedNurbs`；属性：`IsOrientToSurface{get}`, `Loops{get}`, `Surface{get}`
- `Teigha.BoundaryRepresentation.FaceLoopCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.FaceLoopEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.Hit` — class；构造器：0；方法：`Equals`, `GetHashCode`；属性：`EntityAssociated{get}`, `EntityEntered{get}`, `EntityHit{get}`, `IsBrepChanged{get}`, `IsNull{get}`, `Point{get}`, `ValidationLevel{get/set}`
- `Teigha.BoundaryRepresentation.LoopEdgeCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.LoopEdgeEnumerator` — class；构造器：0；属性：`Current{get}`, `IsEdgeOrientToLoop{get}`, `OrientedCurve{get}`, `ParamCurve{get}`, `ParamCurveAsNurb{get}`
- `Teigha.BoundaryRepresentation.LoopType` — enum；枚举值：4
- `Teigha.BoundaryRepresentation.LoopVertexCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.LoopVertexEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.MassProperties` — struct；构造器：0；属性：`Centroid{get}`, `Mass{get}`, `MomentsOfIntertia{get}`, `PrincipalMoments{get}`, `ProductsOfIntertia{get}`, `RadiiOfGyration{get}`, `Volume{get}`
- `Teigha.BoundaryRepresentation.Mesh` — abstract class；构造器：0
- `Teigha.BoundaryRepresentation.Mesh2d` — class；构造器：1；方法：`GetElement2dsStartingFrom`；属性：`Element2ds{get}`
- `Teigha.BoundaryRepresentation.Mesh2dControl` — class；构造器：1；属性：`ElementShape{get/set}`, `MaxAspectRatio{get/set}`
- `Teigha.BoundaryRepresentation.Mesh2dElement2dCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.Mesh2dElement2dEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.Mesh2dFilter` — class；构造器：1；方法：`Insert`
- `Teigha.BoundaryRepresentation.MeshControl` — abstract class；构造器：0；方法：`Equals`, `GetHashCode`；属性：`AngleTolerance{get/set}`, `DistanceTolerance{get/set}`, `MaxNodeSpacing{get/set}`, `MaxSubdivisions{get/set}`
- `Teigha.BoundaryRepresentation.MeshEntity` — abstract class；构造器：0；方法：`Equals`, `GetHashCode`；属性：`EntityAssociated{get}`, `IsBrepChanged{get}`, `IsNull{get}`, `ValidationLevel{get/set}`
- `Teigha.BoundaryRepresentation.Node` — class；构造器：1；属性：`Point{get}`
- `Teigha.BoundaryRepresentation.PointContainment` — enum；枚举值：3
- `Teigha.BoundaryRepresentation.Shell` — class；构造器：1；方法：`GetFacesStartingFrom`；属性：`Complex{get}`, `Faces{get}`, `ShellType{get}`
- `Teigha.BoundaryRepresentation.ShellFaceCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.ShellFaceEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.ShellType` — enum；枚举值：3
- `Teigha.BoundaryRepresentation.ValidationLevel` — enum；枚举值：2
- `Teigha.BoundaryRepresentation.Vertex` — class；构造器：1；方法：`GetEdgesStartingFrom`, `GetLoopsStartingFrom`；属性：`Edges{get}`, `Loops{get}`, `Point{get}`
- `Teigha.BoundaryRepresentation.VertexEdgeCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.VertexEdgeEnumerator` — class；构造器：0；属性：`Current{get}`
- `Teigha.BoundaryRepresentation.VertexLoopCollection` — class；构造器：0；方法：`GetEnumerator`
- `Teigha.BoundaryRepresentation.VertexLoopEnumerator` — class；构造器：0；属性：`Current{get}`

### TD_MgdDbConstraints

#### `Teigha.DatabaseServices`

- `Teigha.DatabaseServices.Assoc2dConstraintCallback` — class；构造器：2；方法：`CanBeRelaxed`, `ConstraintDeactivated`
- `Teigha.DatabaseServices.Assoc2dConstraintGroup` — class；构造器：1；方法：`DeleteConstrainedGeometry`, `DeleteConstraint`, `RegenDimensionSystem`, `SolutionStatus`, `TransformActionBy`；属性：`ConstrainedGeometries{get}`, `Constraints{get}`, `GetDOF{get}`, `WorkPlane{get/set}`
- `Teigha.DatabaseServices.AssocAction` — class；构造器：1；方法：`AddDependency`, `AddMoreObjectsToDeepClone`, `AreDependenciesEqual`, `AreDependenciesOnTheSameThing`, `DependentObjectCloned`, `DragStatus`, `EvaluateDependencies`, `EvaluateDependency`, `EvaluationPriority`, `GetActionBody`, `GetActionsDependentOnObject`×2, `GetDependencies`, `GetDependentObjects`, `HasDependencyCachedValue`, `IsEqualTo`, `IsExternalDependency`, `IsOwnedDependency`, `IsRelevantDependencyChange`, `ObjectThatOwnsNetworkInstance`, `OwnedDependencyStatusChanged`, `PostProcessAfterDeepClone`, `PostProcessAfterDeepCloneCancel`, `RemoveActionsControllingObject`×3, `RemoveAllDependencies`, `RemoveDependency`, `SetOwningNetwork`, `SetStatus`, `TransformActionBy`；属性：`ActionBody{get/set}`, `IsActionBodyAProxy{get}`, `IsActionEvaluationInProgress{get}`, `OwningNetwork{get}`, `Status{get/set}`
- `Teigha.DatabaseServices.AssocArray` — class；构造器：0；方法：`AddSourceEntity`, `CreateArray`, `DeleteItem`, `Explode`, `GetAssociativeArray`, `getItemLocators`, `getItems`, `GetItemTransform`, `GetParameters`, `IsAssociativeArray`, `IsErased`, `RemoveSourceEntity`, `ReplaceItems`, `ResetItems`, `TransformItemBy`；属性：`EntityId{get}`, `SourceEntities{get}`
- `Teigha.DatabaseServices.AssocArrayCommonParameters` — abstract class；构造器：0；方法：`GetLevelCount`, `GetLevelSpacing`, `GetRowCount`, `GetRowElevation`, `GetRowSpacing`, `SetLevelCount`, `SetLevelSpacing`, `SetRowCount`, `SetRowElevation`, `SetRowSpacing`；属性：`BaseNormal{get/set}`, `BasePlane{get/set}`, `BasePoint{get/set}`, `LevelCount{get/set}`, `LevelSpacing{get/set}`, `RowCount{get/set}`, `RowElevation{get/set}`, `RowSpacing{get/set}`
- `Teigha.DatabaseServices.AssocArrayParameters` — abstract class；构造器：0；方法：`Commit`；属性：`Owner{get}`
- `Teigha.DatabaseServices.AssocArrayPathParameters` — class；构造器：2；方法：`GetEndOffset`, `GetItemCount`, `GetItemSpacing`, `GetStartOffset`, `SetEndOffset`, `SetItemCount`, `SetItemSpacing`, `SetStartOffset`；属性：`AlignItems{get/set}`, `EndOffset{get/set}`, `ItemCount{get/set}`, `ItemSpacing{get/set}`, `Method{get/set}`, `Path{get/set}`, `PathDirection{set}`, `StartOffset{get/set}`
- `Teigha.DatabaseServices.AssocArrayPathParameters+MethodType` — enum；枚举值：2
- `Teigha.DatabaseServices.AssocArrayPolarParameters` — class；构造器：2；方法：`GetAngleBetweenItems`, `GetFillAngle`, `GetItemCount`, `GetRadius`, `GetStartAngle`, `SetAngleBetweenItems`, `SetFillAngle`, `SetItemCount`, `SetRadius`, `SetStartAngle`；属性：`AngleBetweenItems{get/set}`, `Direction{get/set}`, `FillAngle{get/set}`, `ItemCount{get/set}`, `Radius{get/set}`, `RotateItems{get/set}`, `StartAngle{get/set}`
- `Teigha.DatabaseServices.AssocArrayPolarParameters+ArcDirection` — enum；枚举值：2
- `Teigha.DatabaseServices.AssocArrayRectangularParameters` — class；构造器：2；方法：`GetAxesAngle`, `GetColumnCount`, `GetColumnSpacing`, `SetAxesAngle`, `SetColumnCount`, `SetColumnSpacing`；属性：`AxesAngle{get/set}`, `ColumnCount{get/set}`, `ColumnSpacing{get/set}`, `XAxisDirection{get/set}`, `YAxisDirection{get/set}`
- `Teigha.DatabaseServices.AssocDependency` — class；构造器：1；方法：`AttachToObject`, `DetachFromObject`, `Evaluate`, `GetDependenciesOnObject`, `GetFirstDependencyOnObject`, `NotifyDependenciesOnObject`, `SetDependentOnObject`, `SetStatus`, `UpdateDependentOnObject`；属性：`DependencyBody{get/set}`, `DependentOnCompoundObject{get}`, `DependentOnObject{get}`, `DependentOnObjectStatus{get}`, `HasCachedValue{get}`, `IsActionEvaluationInProgress{get}`, `IsAttachedToObject{get}`, `IsDelegatingToOwningAction{get/set}`, `IsDependentOnCompoundObject{get}`, `IsObjectStateDependent{get/set}`, `IsReadDependency{get/set}`, `IsRelevantChange{get}`, `IsWriteDependency{get/set}`, `NextDependencyOnObject{get}`, `Order{get/set}`, `OwningAction{get/set}`, `PrevDependencyOnObject{get}`, `Status{get/set}`
- `Teigha.DatabaseServices.AssocDraggingState` — enum；枚举值：4
- `Teigha.DatabaseServices.AssocEvaluationCallback` — abstract class；构造器：0；方法：`BeginActionEvaluation`, `BeginActionEvaluationUsingObject`, `CancelActionEvaluation`, `DeleteUnmanagedObject`, `EndActionEvaluation`, `EndActionEvaluationUsingObject`
- `Teigha.DatabaseServices.AssocEvaluationMode` — enum；枚举值：2
- `Teigha.DatabaseServices.AssocManager` — class；构造器：1；方法：`AddGlobalEvaluationCallback`, `AuditAssociativeData`, `EvaluateTopLevelNetwork`, `HasAssocNetwork`, `Initialize`, `RemoveGlobalEvaluationCallback`
- `Teigha.DatabaseServices.AssocNetwork` — class；构造器：1；方法：`AddAction`, `AddActions`, `GetInstanceFromDatabase`, `GetInstanceFromObject`, `OwnedActionStatusChanged`, `RemoveAction`, `RemoveAllActions`, `RemoveInstanceFromDatabase`, `RemoveInstanceFromObject`；属性：`GetActions{get}`
- `Teigha.DatabaseServices.AssocTransformationType` — enum；枚举值：4
- `Teigha.DatabaseServices.AssocVariable` — class；构造器：1；方法：`AddGlobalCallback`, `EvaluateExpression`×2, `FindObjectByName`, `globalCallback`, `SetExpression`, `SetName`, `ValidateNameAndExpression`；属性：`Description{get/set}`, `EvaluatorId{get/set}`, `Expression{get}`, `Name{get}`, `Value{get/set}`
- `Teigha.DatabaseServices.AssocVariableCallback` — abstract class；构造器：1；方法：`CanBeErased`, `ValidateNameAndExpression`
- `Teigha.DatabaseServices.ConstrainedGeometry` — class；构造器：0；属性：`ConnectedConstraints{get}`, `ConnectedGeometries{get}`
- `Teigha.DatabaseServices.ConstraintGroupNode` — class；构造器：0；属性：`NodeId{get}`, `OwningConstraintGroupId{get}`
- `Teigha.DatabaseServices.EdgeRef` — class；构造器：8；属性：`Curve{get/set}`, `FaceSubentity{get/set}`
- `Teigha.DatabaseServices.ExplicitConstraint` — class；构造器：0；方法：`get`；属性：`DimDependencyId{get/set}`, `MeasuredValue{get}`
- `Teigha.DatabaseServices.FaceRef` — class；构造器：3
- `Teigha.DatabaseServices.GeometricalConstraint` — class；构造器：0；属性：`ConnectedGeometries{get}`
- `Teigha.DatabaseServices.GeometricalConstraint+ConstraintType` — enum；枚举值：14
- `Teigha.DatabaseServices.GeomRef` — abstract class；构造器：0；方法：`Reset`；属性：`IsEmpty{get}`, `IsValid{get}`
- `Teigha.DatabaseServices.ItemLocator` — struct；构造器：1；属性：`ItemIndex{get/set}`, `LevelIndex{get/set}`, `RowIndex{get/set}`
- `Teigha.DatabaseServices.SubentRef` — abstract class；构造器：0；方法：`CopyFrom`, `CreateEntity`；属性：`Entity{get}`, `SubentId{get}`
- `Teigha.DatabaseServices.VertexRef` — class；构造器：7；属性：`Point{get}`

## 6. 完整性检查

- 托管程序集：7
- 公开类型：1647
- 公开方法重载：5601
- 公开属性：5087
- 公开事件：222
- 公开构造器：1196
- 公开字段：7885
- 反射/成员读取错误：0
