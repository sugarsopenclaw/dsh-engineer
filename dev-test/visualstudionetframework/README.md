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
命令同样是 `SHBEXTRACT`（在天河里加载这份 DLL，不要加载 AutoCAD 那份）。

天河里：

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
