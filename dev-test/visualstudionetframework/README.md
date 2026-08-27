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

### 抓取当前框选实体

先在活动图纸中框选，再运行：

```powershell
.\trigger-thcad-selection.ps1
```

脚本会保存当前句柄、按需加载插件、恢复因 `NETLOAD` 清掉的 Pickfirst，最后触发进程内 .NET 命令。COM 只负责连接与触发；实体的几何、文字、XData、扩展字典和 TH 专业对象反射包仍由 `DrawingExtractor` 读取。输出位于 `out-thcad-selection/<图纸名>/<UTC 时间>/`：

- `selection.json`：选择顺序和句柄核对
- `entities.jsonl`：所选顶层实体的完整记录
- `errors.jsonl` / `proxies.jsonl`：逐实体失败和 proxy
- `selection-report.json`：数量、类型、图层、耗时

命令结束后会恢复同一选择集。块参照目前按一个顶层实体记录，不自动展开成块定义内的子实体。

可复用能力源码已按依赖边界整理到 `local-dev/cad/`：全量实体抽取位于 THCAD Adapter，图框检测、图框分区检测、机械明细表知识化、技术要求提取、图层分析和器身中心线候选分析位于宿主无关 Core。当前插件通过 MSBuild linked file 编译这些唯一源码，不在 `dev-test` 复制实现。整图抽取另写：

- `drawing-frames.json`、`drawing-zones.json`：图框及字母数字分区证据；
- `bom-knowledge.json`：机械明细表八列、结构化行、句柄证据及序号质量报告；
- `technical-requirements.json`：技术要求原始文字、合并正文、句柄、位置和编号诊断；
- `technical-requirements.md`：面向人和 LLM 的技术要求正文。
- `layer-analysis.json`：图层定义、实体归属、空间分账、显示状态和引用诊断；
- `layer-analysis.md`：面向人和 LLM 的图层清单及主要实体类型。
- `body-centerline-analysis.json`：中心线轴/正交轴系候选、源句柄、证据、歧义和对称几何操作契约；
- `body-centerline-analysis.md`：明确区分几何候选与已确认器身轴的简明报告。

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
