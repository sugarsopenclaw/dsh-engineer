# 2026-08-24 THCAD V24 vs AutoCAD 2024 抽取对比

图纸：`5TBC.384.A110050.2_1.DWG`（用户在天河里打开并成功 `SHBEXTRACT` 的那张）。

**结论：同一张图、同一套 handle，天河把 AutoCAD 里的 56 个 proxy 解出了 53 个专业对象；proxy 清零。还没有读到标题栏/明细表字段值。**

## 环境

| 项 | AutoCAD 基线 | THCAD 本次 |
| --- | --- | --- |
| 宿主 | AutoCAD 2024 R24.3 | THCAD V24 二维机械设计 V1.3（内核 23.2.4.0） |
| 插件 | `Shb.AutoCAD.Extractor` | `Shb.Thcad.Extractor` |
| `source` | `autocad2024_dotnet` | `thcad_v24_dotnet` |
| 产物 | `dev-test/visualstudionetframework/out/` | `dev-test/visualstudionetframework/out-thcad/` |
| 对比脚本 | `dev-test/visualstudionetframework/compare-hosts.ps1` | 同左 |

## 数量

| | AutoCAD | THCAD | 差 |
| --- | ---: | ---: | ---: |
| 图元 | 3573 | 3570 | −3 |
| proxy | 56 | **0** | −56 |
| 失败 | 0 | 0 | 0 |
| 共有 handle | 3570 | 3570 | |
| 仅 AutoCAD | 3 | | 三个 `TH_WaterMark` |
| 仅 THCAD | 0 | | |
| runtime_class 变化 | 53 | | 全是 Zombie → 天河类 |

53 个变化全部是：

| AutoCAD | THCAD | 数量 |
| --- | --- | ---: |
| `AcDbZombieEntity` | `TH_DimLeaderUA` | 24 |
| `AcDbZombieEntity` | `TH_XuHaoEntity` | 24 |
| `AcDbZombieEntity` | `TH_ParaBasePntUA` | 3 |
| `AcDbZombieEntity` | `TH_CVArrowLine` | 2 |

标准线、弧、圆、块、文字数量两边一致。例如 `AcDbLine=1865`、`AcDbBlockReference=77`。

三个 `TH_WaterMark`（handle `4567/4568/4569`）只出现在 AutoCAD 抽取里，天河 BlockTable 未枚举到。水印多半是显示层，不是零件数据。

## 解出来但仍浅的地方

天河里 `TH_XuHaoEntity` 的 `runtime_class` 已是真类，`decode_status=full`，但几何仍是 `unparsed` / `ImpEntity`：知道「这是序号」，**还没有序号值、指向哪条明细**。引出、基准同样。标题栏/明细表要走 `PCCADMgdV24` / 天河 COM，不是这次 Database 遍历。

## 源文件被改写

THCAD 打开后磁盘上的 DWG 变大了（226774 → 243768 字节），同目录留下 `.bak` 为打开前原件。handle 仍能对上，但 **client-data 原文已被宿主写过**。对比完成后应从 `.bak` 恢复，之后只读打开、禁止保存。

## 下一步

1. 恢复 `5TBC.384.A110050.2_1.DWG`（用 `.bak`）。
2. 用 `PCCADMgdV24` / 机械 COM 抽标题栏、明细表、序号关联。
3. 其余 6 张图用同样方式抽 THCAD 侧，再跑 `compare-hosts.ps1`。
