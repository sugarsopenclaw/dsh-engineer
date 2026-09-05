# ACadSharp 与 THCAD 全量实体对照

日期：2026-09-05

## 结论

有必要引入 ACadSharp，但定位应是**宿主外的离线事实适配器**，不是 THCAD 的替代品。

七张现有客户图的逐句柄实测表明：ACadSharp 3.7.1 能覆盖 THCAD 全量抽取中的全部 91,605 个实体句柄，普通几何和原始文字高度一致；它还能把 450 个已知天河专业实体识别成带真实类名的代理实体，并解析出用于显示的代理几何。与此同时，它不能把这些代理还原成天河业务对象，也不能提供 BOM、序号、图幅等私有对象的权威语义和可靠回写。

推荐分工：

- ACadSharp：离线目录扫描、普通图元索引、原始文字检索、XData/字典入口发现、代理显示图形、缩略图和预览输入；
- THCAD：`TH_*` 专业对象解释、天河业务字典读取、权威几何/范围、业务动作和写回；
- 两者通过 DWG 指纹、句柄、块记录和统一的中性事实模型汇合，不能形成两套互相竞争的权威业务数据。

## 对照范围与方法

输入是 `client-data/transformer-design-drawings/` 下七张 DWG。客户原文保持只读，实验代码和派生结果分别位于：

- `dev-test/acadsharp-compare/`：可复现实验代码；
- `dev-test/acadsharp-compare/out/`：逐图 JSONL、比较结果和总汇总；该目录被 git 忽略；
- `dev-test/visualstudionetframework/out-thcad/`：既有 THCAD 全量实体抽取基线。

本次默认使用 ACadSharp 3.7.1，并采用尽量不丢数据的配置：

- `Failsafe = false`，读取异常不静默降级；
- 保留未知实体与未知非图形对象；
- `IgnoreProxyGraphics = false`，解析代理显示数据；
- 遍历全部 BlockRecord，而不只遍历当前模型空间；
- 以 DWG handle 对齐 ACadSharp 与 THCAD 实体；
- 对 OCS/WCS、文字原始内容、尺寸平面距离和包围盒分别核验，避免只比较类型数量。

官方文档确认 ACadSharp 可直接读取 DWG/DXF；当前支持面和读取示例见 [项目功能说明](https://github.com/DomCR/ACadSharp/wiki/) 与 [官方读取示例](https://github.com/DomCR/ACadSharp/blob/master/docs/articles/samples/reading.md)。本次使用的 3.7.1 包见 [NuGet 3.7.1](https://www.nuget.org/packages/ACadSharp/3.7.1)。

## 总体结果

- 七张图全部严格读取成功；源文件总计约 5.18 MB。
- ACadSharp 实体：91,626。
- THCAD 基线实体：91,605。
- 共有句柄：91,605，即 THCAD 基线中的实体句柄全部能在 ACadSharp 结果中找到。
- 只在 ACadSharp 结果中出现：21；每张图固定 3 个，全部是模型空间中的 `TH_WaterMark` 代理实体。
- 只在 THCAD 基线中出现：0。
- ACadSharp 代理实体：471；其中 471 个都有代理显示图形，共 3,400 条显示命令。
- 读取器通知：62 条，主要是关联网络、视图样式、Sun/渲染设置等对象被保留为未知非图形对象，以及少量样式引用警告；没有图纸读取失败。
- 当前机器复跑七图纯读取累计约 1.6 秒。该数字受磁盘/系统缓存影响，且不含 JSON 序列化与逐句柄比较，只能说明批量离线读取没有明显性能阻碍，不能作为正式性能基准。

逐图结果：

- `5TBC.384.A110050.1_1`：ACadSharp 25,535；THCAD 25,532；共有 25,532；代理 110；代理显示命令 762。
- `5TBC.384.A110050.2_1`：ACadSharp 3,573；THCAD 3,570；共有 3,570；代理 56；代理显示命令 448。
- `5TBC.426.A110050.1_1`：ACadSharp 26,041；THCAD 26,038；共有 26,038；代理 75；代理显示命令 445。
- `5TBC.457.A110050.1_1`：ACadSharp 15,625；THCAD 15,622；共有 15,622；代理 144；代理显示命令 1,131。
- `5TBC.709.A110050.1_1`：ACadSharp 15,420；THCAD 15,417；共有 15,417；代理 64；代理显示命令 461。
- `5TBC.709.A110050.1_2`：ACadSharp 4,016；THCAD 4,013；共有 4,013；代理 10；代理显示命令 72。
- `8TBC.312.A110050.101_1`：ACadSharp 1,416；THCAD 1,413；共有 1,413；代理 12；代理显示命令 81。

这里的 21 个 `TH_WaterMark` 只说明 ACadSharp 读取到的 DWG 记录视图与当前 THCAD 抽取器输出存在差异，不能在没有进一步宿主实验时简单归因为“THCAD 漏抽”或“ACadSharp 多造了实体”。对产品层最稳妥的处理是保存来源、句柄、宿主视图和类信息，不把水印计入业务构件。

## 普通图元能拿到什么

### 共同元数据

PoC 对每个实体保留：句柄、所属 BlockRecord/空间、图层、线型、线宽、颜色、透明度、可见性、XData、扩展字典入口、运行时类型以及类型专有公开属性。

覆盖计数与 THCAD 基线基本对齐：

- 块属性：两边都是 229 个；
- 扩展字典：两边都是 564 个；
- 文字类事实：两边都是 3,218 个；
- XData：ACadSharp 25,463，THCAD 25,457；多出的 6 个记录来自宿主视图差异，不能直接当作业务增量；
- ACadSharp 为全部 91,626 个实体保存了类型专有公开属性快照。

### 几何与文字一致性

对共有句柄进行坐标系归一后：

- 62,866 条 Line 的起终点全部一致；
- 4,727 个 Circle 的中心和半径全部一致；
- 11,445 个 Arc 的中心、半径、起止角全部一致；
- 2,276 个 Point 的位置全部一致；
- 1,498 个 Insert 的插入点全部一致；
- 1,220 个 DBText 的文字内容全部一致；
- 940 个 MText 的原始 Contents 全部一致。

ACadSharp 的 MText `PlainText` 不是可靠的跨宿主对照字段：940 个中只有 767 个大小写敏感完全一致，792 个忽略大小写后一致。产品索引应先保存原始 Contents，再由我们自己的确定性规范化器生成检索文本。

734 个尺寸对象的库级 `Measurement` 有 732 个与 THCAD 一致。两个差异对象是平面标注点带不同 Z 值时，ACadSharp 取了三维距离，而 THCAD 结果是对象平面距离。PoC 用定义点和对象平面独立重算后，29 个 Aligned Dimension 全部一致。因此尺寸值应由原始定义几何和维度平面复算，不应盲信库的派生属性。

## 天河专业对象能拿到什么

THCAD 基线中的 450 个专业实体在 ACadSharp 中全部按相同 handle 对齐，但类型均为 `ProxyEntity`：

- `TH_XuHaoEntity`：178；
- `TH_DimLeaderUA`：177；
- `TH_ParaBasePntUA`：87；
- `TH_DimRough2010`：5；
- `TH_CVArrowLine`：2；
- `TH_DimRoughA`：1。

ACadSharp 仍保存了它们的 DxfClass，包括天河 C++ 类名、DXF 名、应用名和代理标志。3.7.1 还能解析 3,400 条代理显示命令，其中包括圆、折线、带法向折线、颜色、变换栈和 Unicode 文字。

例如 handle `377E` 的 `TH_DimRough2010` 在 THCAD 当前抽取中 `ExplodeGeometry` 返回 `eNotApplicable`；ACadSharp 的代理显示数据却包含四段折线、颜色和显示文字 `25`。这对预览、OCR 前置和空间候选很有价值，但 `25` 只是绘图时缓存的显示文字，不能自动等同于对象内部的权威粗糙度字段。

字典层也能看到 `PC_BOM_DIC`、`PC_BOMXHRELATEDIC`、`PC_MXBSORTDIC`、`PC_PAPER_DIC` 等入口；其中 `TH_CSLRecorder`、`TH_PaperRecorder`、`TH_PaperSizeRecorder` 仍只是 `ProxyObject` 外壳。也就是说，ACadSharp 能证明对象/字典存在并保留标识，但目前不能解释其私有业务载荷。

## 不能直接相信的派生结果

### 包围盒

ACadSharp 3.7.1 的内置 `GetBoundingBox` 不适合直接成为我们的空间索引真值：

- Line 和 Point 对齐良好；
- Arc 只有 7,827 / 11,445 与 THCAD 包围盒一致；
- Insert 只有 877 / 1,491 个可比较对象一致；
- DBText 的 1,219 个可用包围盒全部退化为插入点；
- MText 的 940 个包围盒全部退化；
- 普通尺寸、Wipeout 和所有天河代理对象也不能直接得到与 THCAD 一致的范围。

因此离线索引必须另设范围计算器：先做 OCS/WCS 归一，递归展开块变换，按文字字体/对齐规则求范围，并把代理显示命令纳入范围计算。无法可靠求值时应明确标为 unavailable，不能用零面积范围悄悄代替。

### 专业语义与写回

本实验没有尝试写 DWG，也没有证明代理实体可安全修改。代理显示图形是 presentation cache，不是天河对象模型。序号、BOM 绑定、图幅记录、专业标注参数、对象反应器和准确回写继续以 THCAD 公开能力与真机验证为准。

## 版本差异

使用 stock ACadSharp 3.4.9 重跑时，实体数量和句柄对齐结果与 3.7.1 相同：91,626 / 91,605 / 91,605，共有 471 个代理实体；但公共 API 没有 `IgnoreProxyGraphics` 和 `Entity.ProxyGeometries`，所以得到的已解析代理显示命令为 0。

官方发布记录显示后续版本才补入 mechanical entities 和 proxy graphics；参见 [ACadSharp Releases](https://github.com/DomCR/ACadSharp/releases)。当前本机 ReadCAD 3.5.2 捆绑的 `ACadSharp.dll` 文件/程序集版本也是 3.4.9。`ReadCAD.dll` 内存在自己的代理图形访问/解析逻辑，但它不是 ACadSharp 公共契约，本实验也没有把这条私有实现当成 stock 3.4.9 的能力。因此：

- 评估 ACadSharp 本身时，以可固定、可测试的 3.7.1 公共 API 为准；
- 评估 ReadCAD 产品时，要单独做 ReadCAD 运行时样图验证，不能从其捆绑 DLL 版本或私有类名直接推导行为；
- 正式引入必须固定包版本，并把代理图形与普通几何回归测试纳入升级门禁。

## 推荐落法

第一阶段不必先复制 ReadCAD 的 WPF 工作台。先做一个无 UI 的 ACadSharp sidecar/adapter，产出中性、可追溯的离线事实：

1. 记录 DWG 内容哈希、解析器版本、读取通知和失败；
2. 输出 handle、BlockRecord、普通几何、原始文字、属性、XData、字典入口和 proxy class；
3. 自己实现 OCS/WCS、尺寸平面和范围归一；
4. 将代理显示图形只标为 `presentation_geometry`，不冒充专业业务属性；
5. THCAD 适配器按 handle 补充 `authoritative_professional_data`，所有专业动作和写回只走 THCAD；
6. 先用这七张图建立逐句柄回归，再扩展到更多 THCAD/AutoCAD 版本和损坏/缺字体/外部参照样本。

只有当后台离线事实层稳定后，再接 Skia 预览和批量缩略图；WPF 是产品交互选择，不是验证 ACadSharp 价值的前置条件。

## 复现

从仓库根运行：

```powershell
dotnet run --project dev-test/acadsharp-compare/AcadSharpProbe.csproj -- `
  client-data/transformer-design-drawings `
  dev-test/visualstudionetframework/out-thcad `
  dev-test/acadsharp-compare/out
```

关键产物：

- `dev-test/acadsharp-compare/out/aggregate.json`：七图汇总；
- `out/<drawing>/entities.jsonl`：ACadSharp 实体与代理显示命令；
- `out/<drawing>/dictionary-entries.jsonl`：命名字典遍历；
- `out/<drawing>/comparison.json`：逐句柄、类型、几何与包围盒对照；
- `out/<drawing>/notifications.jsonl`：读取器通知；
- `out/stock-3.4.9/aggregate.json`：stock 3.4.9 版本对照。

## 适用边界

这次结论只由当前七张客户图、本机文件版本和两版 ACadSharp 的真实输出支持，不外推为所有 DWG、所有天河版本和所有第三方自定义对象的普遍事实。新对象类型和新版本仍需按“元数据存在、运行时可达、业务语义已验证”三层继续记录。
