# AutoCAD 2024 DWG extractor (dev-test)

本机 PoC：AutoCAD 2024 进程内 C# 插件，遍历整库（BlockTable / 符号表 / XData / Dictionary / Proxy），写出 JSON/JSONL。

- 目标框架：**.NET Framework 4.8** / **x64**
- 宿主：`D:\autocad2024\AutoCAD 2024`
- 引用：`accoremgd.dll`、`acdbmgd.dll`，**Copy Local = False**（不引用 `acmgd.dll`，才能给 `accoreconsole` 用）
- 命令：`SHBEXTRACT`
- 产出：`dev-test/visualstudionetframework/out/<图纸名>/`（不写 `client-data/`）

## 编译

Visual Studio 打开 `ClassLibrary1.slnx`，平台选 x64 后生成。或：

```powershell
cd D:\dev\dsh-engineer\dev-test\visualstudionetframework
.\run-extract.ps1 -Drawing "D:\dev\dsh-engineer\client-data\transformer-design-drawings\5TBC.384.A110050.2_1.DWG"
```

不带 `-Drawing` 会跑 drop 里全部 DWG。

## 在 AutoCAD 里手动加载

1. 打开图纸（只读，不要另存）
2. `NETLOAD` → `ClassLibrary1\ClassLibrary1\bin\x64\Debug\Shb.AutoCAD.Extractor.dll`
3. 命令行输入 `SHBEXTRACT`

输出目录默认 `dev-test/visualstudionetframework/out`。可设环境变量 `SHB_EXTRACT_OUT`，或在 DLL 同目录放 `output-root.txt`。

`accoreconsole` 批跑需要先把 `SECURELOAD` 设为 0（脚本已做），否则会“加载成功”但命令不注册。退出时用 `QUIT` + `N`，避免把 DWG 写回去。

## THCAD V24 抽取（对照）

插件：`ThcadExtractor\bin\x64\Debug\Shb.Thcad.Extractor.dll`  
产出：`out-thcad/<图纸名>/`  
命令：`SHBEXTRACT`（当前图）、`SHBEXTRACTSELECTED`（当前预选择集）和 `SHBEXTRACTALL`（批量，旁数据库读 drop 里全部 DWG，不在编辑器打开，不写回源文件；已有 `extraction-report.json` 的跳过，`SHB_EXTRACT_FORCE=1` 强制重抽）。批量进度看 `out-thcad/_batch-log.txt`，完成哨兵 `_batch-done.txt`。

天河没有 accoreconsole 等价物，批跑走 COM 驱动已启动的 GUI 实例（`BricscadApp.AcadApplication`）：

```powershell
.\trigger-thcad-batch.ps1   # 对运行中的 THCAD SendCommand: NETLOAD + SHBEXTRACTALL
```

11–20 共用一个独立命名的只读压力回归插件（命令名因兼容仍保留 `1112`），避免正式抽取 DLL 已被 CLR 锁定时覆盖程序集：

```powershell
.\trigger-thcad-11-12-verifier.ps1 -Scope One    # 最小样图
.\trigger-thcad-11-12-verifier.ps1 -Scope Medium # 中等样图
.\trigger-thcad-11-12-verifier.ps1 -Scope Large1 # 709.1_1 单图
.\trigger-thcad-11-12-verifier.ps1 -Scope Large2 # 709.1_2 单图
.\trigger-thcad-11-12-verifier.ps1 -Scope All    # 七图旁数据库回归
```

产物在 `out-thcad-11-12/`，日志为 `_verify-log.txt`。它只旁读源 DWG，但仍在 THCAD 进程内运行；运行前先保存当前编辑图。2026-08-29 曾定位并修复通用反射创建 `HyperLinkCollection` 原生包装器导致的连续旁数据库终结器崩溃；修复后已在新 THCAD 进程完成最小图单图回归，最终连续七图仍待复验，详见 `local-dev/cad/validation-and-risk-notes.md`。

若只验证最新版 12–20 Core，可在 THCAD 未启动时重放上述目录中已保存的 09 尺寸拓扑和 11 世界坐标事实；它还会读取已保存的图框、文字、BOM、技术要求和标题栏证据，输出 13–20 的每图派生 JSON、19 自差分不变量、20 项目图及总摘要。它不重新读取 DWG，不能替代宿主复验：

```powershell
.\..\..\local-dev\cad\core\12-planar-topology-kernel\replay-saved-instance-facts.ps1
```

### 抓取当前框选实体

先在活动图纸中框选，再运行：

```powershell
.\trigger-thcad-selection.ps1
```

脚本会保存当前句柄、按需加载插件、恢复因 `NETLOAD` 清掉的 Pickfirst，最后触发进程内 .NET 命令。COM 只负责连接与触发；实体的几何、文字、XData、扩展字典和 TH 专业对象反射包仍由 `DrawingExtractor` 读取。`TH_XuHaoEntity` 还会通过 .NET `ExplodeGeometry` 在 `geometry` 中记录 `pointing_position` 与 `number_position`。输出位于 `out-thcad-selection/<图纸名>/<UTC 时间>/`：

- `selection.json`：选择顺序和句柄核对
- `entities.jsonl`：所选顶层实体的完整记录
- `errors.jsonl` / `proxies.jsonl`：逐实体失败和 proxy
- `selection-report.json`：数量、类型、图层、耗时

命令结束后会恢复同一选择集。块参照目前按一个顶层实体记录，不自动展开成块定义内的子实体。

可复用能力源码已按依赖边界整理到 `local-dev/cad/`：全量实体抽取位于 THCAD Adapter，02–20 的识别、拓扑、scope、关系、身份约束、轮廓、接口邻接、尺寸—几何绑定、语义差分和跨图项目关系分析位于宿主无关 Core。当前插件通过 MSBuild linked file 编译这些唯一源码，不在 `dev-test` 复制实现。整图抽取另写：

- `drawing-frames.json`、`drawing-zones.json`：图框及字母数字分区证据；
- `bom-knowledge.json`：机械明细表八列、结构化行、句柄证据、每行对应的图面 `TH_XuHaoEntity` 序号标注、标注指向侧/序号侧坐标及序号质量报告；
- `technical-requirements.json`：技术要求原始文字、合并正文、句柄、位置和编号诊断；
- `technical-requirements.md`：面向人和 LLM 的技术要求正文。
- `layer-analysis.json`：图层定义、实体归属、空间分账、显示状态和引用诊断；
- `layer-analysis.md`：面向人和 LLM 的图层清单及主要实体类型。
- `centerline-identification.json`：文字/样式并集后的 Line、Arc、Circle、Polyline、Spline，直线角度、中心形态、交点视觉锚点及所属坐标空间；
- `centerline-identification.md`：面向人和 LLM 的方向、形态、交点、带文字结果和完整中心几何清单。
- `annotation-identification.json`：全图尺寸、引线、序号、粗糙度、基准、符号箭头及字母方向标记的分类、文字、几何定义、证据和成组移除候选句柄；
- `annotation-identification.md`：面向人和 LLM 的标注分类摘要、重叠口径和删除边界。
- `dimension-topology.json`：线性尺寸的局部站位图、连续链、共基准剖面、闭合式、派生距离和参考轴偏置；
- `dimension-topology.md`：面向人和 LLM 的尺寸链、闭合残差与偏心摘要。
- `engineering-line-semantics.json`：全部颜色/线型/线宽画像、未知样式清单、图线角色、连通闭环、包络关系、重复拓扑和参考轴对称评估；
- `engineering-line-semantics.md`：面向人和 LLM 的工程图线角色、开放词汇与偏置对称摘要。
- `block-instance-coordinate-facts.json/.md`：definition/occurrence、世界坐标、镜像与有效样式事实；
- `planar-topology.json/.md`：切节点 arrangement、连通分量、DCEL 面、Euler 对账与诊断；
- `engineering-view-regions.json/.md`：纸张结构、文档区、视图候选、局部几何及完整证据回链；
- `representation-correspondence.json/.md`：重复几何和正投影候选，并显式区分同型与同一对象。
- `representation-identity-resolution.json/.md`：可追溯身份断言、保守物理对象簇、可能同一对象组、同型组及硬约束冲突；14 的几何关系不会直接合并对象。
- `manufacturing-profile-features.json/.md`：视图内闭合轮廓、内嵌边界、共享边/包含关系、重复特征、开放拓扑和按 15 对象簇建立的不融合摘要；圆形候选不会直接写成孔。
- `mechanical-interface-adjacency.json/.md`：内嵌接口特征、同轴/对齐/重复模式、共享边分级、多源重合边、开放端近接及对象簇摘要；二维关系不会直接写成配合、连接或物理接触。
- `dimension-geometry-binding.json/.md`：尺寸 occurrence 的世界坐标定义点、结构锚点候选、轮廓/接口/对象回链、实体/显示/几何量值核对，以及显式 `DIMLFAC` 和重复显示比例候选；残差不直接写成图纸错误。
- `semantic-drawing-snapshot.json/.md`：当前版本的跨快照稳定输入，保存图纸身份、04/05/08/11/13/16/17/18 语义元素、源 handle、关系、状态和预算；单次抽取不生成无基线的版本差分。
- `cross-drawing-observation.json/.md`：20 的单图项目输入，保存标题栏身份、BOM/文字/外参引用、接口签名、局部坐标和绑定尺寸；多图项目关系由离线汇聚器或 Agent 另行生成，单图不会伪造跨文件结论。

重新编译 DLL 后，当前 THCAD 进程中已经 `NETLOAD` 的旧程序集通常无法真正卸载。需要先保存要保留的图纸状态，退出并重启 THCAD，再加载新 DLL；仅重复执行 `NETLOAD` 不应当作可靠热更新。

手动方式（在天河里加载这份 DLL，不要加载 AutoCAD 那份）：

1. 只读打开图纸，不要另存
2. 必要时 `SECURELOAD` 设为 `0`
3. `NETLOAD` → 上面的 `Shb.Thcad.Extractor.dll`
4. `SHBEXTRACT`

对比：

```powershell
.\compare-hosts.ps1 -DrawingId "5TBC.384.A110050.2_1"
```

## 这不是「全部数据」

这是文档里的第三层：标准 DWG 数据库。天河标题栏/明细表/算单要等 THCAD/PCCAD。Proxy 会记在 `proxies.jsonl`，`decode_status` 为 `proxy`。

## 已知问题（PoC 不打算修，产品化时再说）

- `entities.jsonl` 里 `drawing_handle` 字段名是误导：取的是实体自己的 handle，和 `handle` 永远相等（`DrawingExtractor.cs:162`）。
- XData 里同一 RegApp 名出现两次时后一段会覆盖前一段（`DrawingExtractor.cs:540`，`result[app] = cur`）。这批图没踩到。
- 整库单事务到底（`DrawingExtractor.cs:55`）。几万实体没问题，大图（几十万实体）内存会涨，复用时按块分批 Commit。
- `AtomicWrite` 不是真原子（先 Delete 再 Move，`DrawingExtractor.cs:1031`），中途失败会新旧文件都丢；.NET Framework 应改用 `File.Replace`。
- `block_path` 目前只有单层 `[owner.Name]`，没做嵌套块路径；`semantic_type` 恒为 null（输出里被 JsonUtil 跳过，不出现）。
