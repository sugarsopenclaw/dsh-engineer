# 20 · 跨图工程接口与项目关系

20 把一组图纸沿标题栏图样代号、页码/版次、BOM 代号、文字引用、外参路径和 17/18 的接口证据连成项目图。它回答“哪些图纸可能互相引用、哪个构件引用可落到哪组图、哪些接口签名可比较”，不把企业规范、设计意图或单纯几何相似写成事实。

## 两阶段产物

1. `CrossDrawingProjectInputBuilder` 把每张 19 语义快照压成 `cross-drawing-observation.json/.md`：图纸身份、`component_ref`、`interface_ref`、视图区局部坐标、形态/孔系/间距/包络签名、绑定尺寸和源 ID/handle。THCAD Adapter 还把块表中已声明的外参路径加入该单图观察。
2. `CrossDrawingInterfaceGraphAnalyzer` 消费多张 observation，输出 drawing/component/interface 节点、引用边、跨文件身份、接口比较、库存缺口候选、版本多解和证据冲突。项目汇聚不要求 CAD 正在运行。

同图号的不同页组成一个合法多页图集；同图号且同页出现多份快照时保留为版本/副本多解。BOM 代号在输入集合中找不到标题栏目标，只表示“本次提供的集合中没有”，不能证明企业文件真的缺失。

## 身份等级

- `SUPPORTED`：结构化作者引用精确命中唯一标题身份（或无重复页的多页图集）；接口身份还必须同时具备明确接口上下文、唯一最佳候选及至少两项相容签名。
- `POSSIBLE`：文字引用、引线端点近接、纯几何相似、候选平局、版本未选定或比例尚未证明。
- `CONFLICTED`：引用身份和接口上下文都已支持，但唯一接口候选的作者尺寸或已证明同单位/同比例量值互相矛盾。
- `UNRESOLVED`：目标不在输入集合、限定页/版本不匹配，或没有足够接口上下文。

原始世界几何的比例在跨文件间默认未证明，因此几何尺寸不同只产生复核候选；方向差也只描述局部坐标差，没有跨视图变换时不判朝向错误。该边界防止详图比例、镜像视图和不同画法被误判成接口冲突。

## 确定性审计候选

- 同一图号/页在项目集中出现多个版本或副本；
- 结构化代号在本次项目集合中没有标题栏目标；
- 已支持的构件/接口身份出现作者尺寸或单位可比量值冲突；
- 同族接口仅有几何差异，但比例或具体接口身份仍未证明。

这些是从图纸集合派生的事实或复核候选；“孔数必须多少、哪个版本应生效、缺某图是否违规”等企业规则仍应由后续规范侧单独判定。

## 使用

整图 THCAD 抽取会为每张图生成 `cross-drawing-observation.json/.md`。汇聚某个目录下的观察文件：

```powershell
.\local-dev\cad\core\20-cross-drawing-interface-graph\build-cross-drawing-interface-graph.ps1 `
  -InputRoot <多个图纸抽取目录的共同根目录>
```

保存事实重放产物使用：

```powershell
.\local-dev\cad\core\20-cross-drawing-interface-graph\build-cross-drawing-interface-graph.ps1 `
  -InputRoot .\dev-test\visualstudionetframework\out-thcad-11-12 `
  -ObservationFileName cross-drawing-observation-replay.json
```

合成回归：

```powershell
.\local-dev\cad\core\20-cross-drawing-interface-graph\test-cross-drawing-interface-graph.ps1
```

## 当前七图证据

2026-08-29 对七张保存事实离线重放，得到 7 个 drawing 节点、179 条有代号的 BOM 构件引用和 13,568 个接口引用。七张样图的 179 条代号没有一条精确命中另一张样图的标题栏图样代号，因此结果是 133 个按代号去重的“目标不在本次集合”候选、179 个 `UNRESOLVED` 身份、0 个接口比较；算法没有拿几何相似硬凑跨图关系。项目汇聚约 19 ms，上游四张 `unsupported_partial` 状态按契约传播，所以总状态为 `unsupported_partial`。

这组负样本只验证“无关系时不乱连”。合成回归另外覆盖：结构化引用命中、多页图集、同页多版本、文字引用降级、唯一接口 `SUPPORTED`、绑定作者尺寸 `CONFLICTED`、缺目标以及局部坐标/引线端点投影。要评价真实跨图召回率，仍需把某张总图及其 BOM 实际引用的部件/零件图一起纳入样本。
