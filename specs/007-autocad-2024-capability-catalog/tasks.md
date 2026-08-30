# 007 — 任务

勾选只对应当前捕获日志，不是预期。

- [x] 确认当前活动宿主和安装范围确为 AutoCAD 2024
- [x] 建立五个隔离 inventory 工作目录
- [x] 记录 THCAD 原始库存保护哈希
- [x] 导出并验证 AutoCAD 2024 COM 原始原子
- [x] 完成 COM 原子属性分类与完整归账
- [x] 导出并验证 AutoCAD 2024 .NET 原始原子
- [x] 完成 .NET 原子属性分类与完整归账
- [x] 导出并验证 AutoCAD 2024 LISP 原始原子
- [x] 完成 LISP 原子属性分类与完整归账
- [x] 导出并验证 AutoCAD 2024 Command/CUI 原始原子
- [x] 完成 Command/CUI 原子属性分类与完整归账
- [x] 导出并验证 AutoCAD 2024 Native PE 候选原子
- [x] 连续复跑并确认五个库存确定性
- [x] 运行公共与新增测试，确认 THCAD 产物未被改写
- [x] 写实测结果报告并停止在数据库前

## 勾选依据（与捕获日志对齐）

宿主：`autocad-2024-host.json`，`confirmed=true`，产品 AutoCAD 2024，`R24.3.61.0.0`，路径 `D:\autocad2024\AutoCAD 2024\acad.exe`。五个隔离目录均有 `inventory-manifest.json` 与 `capability-atoms.jsonl`。

THCAD 保护：`thcad-protection-baseline.json` 与 `thcad-protection-final.json` 五组 manifest/atoms SHA-256 一致；`thcad-protection-compare.json` 全部 `manifest_match/atoms_match/bytes_match=true`。

| 库存 | 导出日志 | 两次导出 equal_12 | validate pending |
| --- | --- | --- | ---: |
| autocad-2024.com | export-autocad-2024.com.log | True `c95b0f4432…` | 0（classified 19836） |
| autocad-2024.dotnet | export-autocad-2024.dotnet.log | True `11d12df55d…` | 0（classified 26778） |
| autocad-2024.lisp | export-autocad-2024.lisp.log | True `0b4c3a66cd…` | 0（classified 1077，deferred 4149） |
| autocad-2024.command | export-autocad-2024.command.log（与 LISP 同一导出入口的副本） | True `4e0476364a…` | 0（classified 9059，deferred 137） |
| autocad-2024.native | export-autocad-2024.native.log | True `cab044644f…` | 193464（raw_total 193464；规格允许未知签名保持 pending） |

validate 文件：`validate-autocad-2024.{com,dotnet,lisp,command,native}.log`（COM/.NET/LISP/Command 带 `--require-complete`）。确定性文件：`determinism-autocad-2024.*.txt`，五条 `equal_12=True` 且 `equal_final=True`。

测试：仓库根 `uv run --project backend python -m unittest discover -s data/pipelines/cad_capabilities/tests -v` 连续两次。`cad-capabilities-tests-1.log`：65 tests，0.217s，OK，含 `test_emit_rejects_thcad_inventory_and_output_directory` 与 `test_classify_autocad_atom_never_attaches_thcad_runtime_evidence`。`cad-capabilities-tests-2.log`：65 tests，0.201s，OK。

报告：`docs/dev/2026-08-28-AutoCAD-2024-原子能力采集结果.md`。未生成关系、curated、入库、后端或前端。
